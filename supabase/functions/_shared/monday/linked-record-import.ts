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
  countActiveLinkedRecordsForBoard,
  fetchExistingLinkedRecordItemIds,
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

    const { totalItems, totalPages } = await deps.mondayClient.fetchAllBoardItems(deps.boardId, {
      pageSize: deps.pageSize,
      onPage: async (page, pageNumber) => {
        console.log(`monday-import: [${deps.table}] page ${pageNumber} — ${page.items.length} items`);

        for (const item of page.items) {
          totalProcessed++;
          try {
            const normalized = mapMondayItemToLead(item, deps.boardId, deps.columnIdMapJson);
            const relatedLeadMondayItemId = extractRelatedLeadMondayItemId(item);
            const wasExisting = existingIds.has(Number(item.id));

            await upsertLinkedRecord(deps.supabase, deps.table, normalized, {
              relatedLeadMondayItemId,
              leadsBoardId: deps.leadsBoardId,
              eventType: "initial_import",
            });

            if (wasExisting) {
              updatedCount++;
            } else {
              createdCount++;
              existingIds.add(Number(item.id));
            }
          } catch (err) {
            failedCount++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`monday-import: [${deps.table}] failed to import item ${item.id}:`, message);
            await recordImportError(deps.supabase, runId, { mondayItemId: item.id, errorMessage: message });
          }
        }

        await updateImportRunProgress(deps.supabase, runId, { totalProcessed, createdCount, updatedCount, failedCount });
      },
    });

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
