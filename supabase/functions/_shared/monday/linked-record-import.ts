// Bulk import for a board OTHER than the Leads board — Call Log Tracker
// or Deals — into crm_calls / crm_deals respectively. Mirrors import.ts's
// runLeadImport shape exactly (fetch board metadata -> paginate items ->
// map -> upsert -> track progress/errors -> validate), reusing the same
// Monday client and mapper; only the target table and the extra
// related-lead resolution differ, via linked-records-repository.ts.
//
// Kept as a separate function from runLeadImport rather than a shared
// generic, so the well-tested Leads import path is never at risk of a
// regression from this addition.

import type { MondayClient } from "./client.ts";
import { extractRelatedLeadMondayItemId, mapMondayItemToLead } from "./mapper.ts";
import {
  batchUpsertLinkedRecords,
  countActiveLinkedRecordsForBoard,
  fetchExistingLinkedRecordItemIds,
  prepareLinkedRecordRow,
  reconcileRemovedLinkedRecords,
  resolveRelatedLeadIds,
  upsertLinkedRecord,
  type LinkedRecordTable,
} from "./linked-records-repository.ts";
import { upsertMondayBoard, upsertMondayBoardColumns } from "./board-repository.ts";
import { completeImportRun, createImportRun, recordImportError, updateImportRunProgress } from "./import-runs-repository.ts";
import { ImportRunFailedError, type ImportSummary } from "./import.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

export async function runLinkedRecordImport(deps: {
  mondayClient: MondayClient;
  supabase: SupabaseClientLike;
  table: LinkedRecordTable;
  boardId: string;
  leadsBoardId: string;
  columnIdMapJson?: string;
  pageSize?: number;
}): Promise<ImportSummary> {
  const startedAt = Date.now();
  // Captured before the first write: every row upserted this run gets a
  // last_synced_at strictly after this, so reconciliation can tell a
  // refreshed row from a stale one by timestamp alone.
  const runStartedAtIso = new Date().toISOString();
  const runId = await createImportRun(deps.supabase);

  let totalProcessed = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  try {
    const meta = await deps.mondayClient.fetchBoardMetadata(deps.boardId);
    await upsertMondayBoard(deps.supabase, meta);
    await upsertMondayBoardColumns(deps.supabase, meta);
    console.log(`monday-import: [${deps.table}] board "${meta.boardName}" (${meta.boardId}) — ${meta.columns.length} columns`);

    const existingIds = await fetchExistingLinkedRecordItemIds(deps.supabase, deps.table, deps.boardId);
    const activeBefore = await countActiveLinkedRecordsForBoard(deps.supabase, deps.table, deps.boardId);

    const { totalItems, totalPages } = await deps.mondayClient.fetchAllBoardItems(deps.boardId, {
      pageSize: deps.pageSize,
      onPage: async (page, pageNumber) => {
        console.log(`monday-import: [${deps.table}] page ${pageNumber} — ${page.items.length} items`);

        // Transform the whole page first so the DB work can be batched:
        // one related-lead lookup and one upsert per page instead of two
        // round trips per item — the difference between finishing a large
        // board inside the function time limit and being cut off partway.
        const prepared: {
          itemId: number;
          normalized: ReturnType<typeof mapMondayItemToLead>;
          relatedLeadMondayItemId: string | null;
        }[] = [];
        for (const item of page.items) {
          totalProcessed++;
          try {
            prepared.push({
              itemId: Number(item.id),
              normalized: mapMondayItemToLead(item, deps.boardId, deps.columnIdMapJson),
              relatedLeadMondayItemId: extractRelatedLeadMondayItemId(item),
            });
          } catch (err) {
            failedCount++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`monday-import: [${deps.table}] failed to map item ${item.id}:`, message);
            await recordImportError(deps.supabase, runId, { mondayItemId: item.id, errorMessage: message });
          }
        }

        const leadIdByItemId = await resolveRelatedLeadIds(
          deps.supabase,
          deps.leadsBoardId,
          prepared.map((p) => p.relatedLeadMondayItemId),
        );
        const rows = prepared.map((p) =>
          prepareLinkedRecordRow(p.normalized, p.relatedLeadMondayItemId, leadIdByItemId, "initial_import"),
        );

        const countPrepared = () => {
          for (const p of prepared) {
            if (existingIds.has(p.itemId)) {
              updatedCount++;
            } else {
              createdCount++;
              existingIds.add(p.itemId);
            }
          }
        };

        try {
          await batchUpsertLinkedRecords(deps.supabase, deps.table, rows);
          countPrepared();
        } catch (batchErr) {
          // A batch upsert is all-or-nothing, so on failure fall back to
          // per-item upserts — one bad row must never cost the whole page.
          const message = batchErr instanceof Error ? batchErr.message : String(batchErr);
          console.error(`monday-import: [${deps.table}] page ${pageNumber} batch upsert failed, retrying per-item:`, message);
          for (const p of prepared) {
            try {
              await upsertLinkedRecord(deps.supabase, deps.table, p.normalized, {
                relatedLeadMondayItemId: p.relatedLeadMondayItemId,
                leadsBoardId: deps.leadsBoardId,
                eventType: "initial_import",
              });
              if (existingIds.has(p.itemId)) {
                updatedCount++;
              } else {
                createdCount++;
                existingIds.add(p.itemId);
              }
            } catch (err) {
              failedCount++;
              const itemMessage = err instanceof Error ? err.message : String(err);
              console.error(`monday-import: [${deps.table}] failed to import item ${p.itemId}:`, itemMessage);
              await recordImportError(deps.supabase, runId, { mondayItemId: String(p.itemId), errorMessage: itemMessage });
            }
          }
        }

        await updateImportRunProgress(deps.supabase, runId, { totalProcessed, createdCount, updatedCount, failedCount });
      },
    });

    // fetchAllBoardItems only returns once Monday's cursor is exhausted, so
    // reaching here means every current board item was fetched this run.
    // Reconcile rows that weren't refreshed (deleted/archived on Monday) —
    // but only on a clean pass, and guard against a suspiciously small
    // fetch (a Monday hiccup) mass-deleting live rows.
    let reconciledCount = 0;
    const fetchLooksComplete = totalItems >= Math.floor(activeBefore * 0.5);
    if (failedCount === 0 && fetchLooksComplete) {
      reconciledCount = await reconcileRemovedLinkedRecords(deps.supabase, deps.table, deps.boardId, runStartedAtIso);
      if (reconciledCount > 0) {
        console.log(`monday-import: [${deps.table}] reconciled ${reconciledCount} row(s) no longer on the board`);
      }
    } else if (!fetchLooksComplete) {
      console.warn(
        `monday-import: [${deps.table}] skipped reconciliation — fetched ${totalItems} item(s) vs ${activeBefore} active; too few to trust as complete.`,
      );
    }

    const crmTotal = await countActiveLinkedRecordsForBoard(deps.supabase, deps.table, deps.boardId);
    const missingCount = Math.max(0, totalItems - createdCount - updatedCount - failedCount);
    const status = failedCount > 0 ? "completed_with_errors" : "completed";

    await completeImportRun(deps.supabase, runId, {
      status,
      counts: { totalProcessed, createdCount, updatedCount, failedCount },
    });

    return {
      importRunId: runId,
      boardId: deps.boardId,
      boardName: meta.boardName,
      workspaceId: meta.workspaceId,
      workspaceName: meta.workspaceName,
      status,
      mondayTotal: totalItems,
      crmTotal,
      createdCount,
      updatedCount,
      failedCount,
      missingCount,
      duplicateCount: 0,
      pagesProcessed: totalPages,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await completeImportRun(deps.supabase, runId, {
      status: "failed",
      counts: { totalProcessed, createdCount, updatedCount, failedCount },
      errorMessage: message,
    });
    throw new ImportRunFailedError(message, runId, err);
  }
}
