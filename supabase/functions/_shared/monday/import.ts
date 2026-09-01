// Bulk initial import: pulls every item from the configured Monday Leads
// board (all groups) and upserts each as a CRM lead, via the exact same
// mapper + repository the webhook uses — see pipeline.ts's header comment
// for the shared-pipeline rationale. This is the "future/initial import
// script" that pipeline.ts's comments have referred to since Phase 1.
//
//   Monday API (client.ts: fetchBoardMetadata + fetchAllBoardItems)
//     -> Normalizer/Transformer (mapper.ts)
//     -> CRM Lead Upsert (leads-repository.ts)
//     -> Database
//
// One failed item never stops the run — it's recorded to
// lead_import_errors and counted, and the loop continues. A fatal error
// (can't reach the board at all, etc.) marks the run "failed" and
// rethrows, but any items already processed before that point are safely
// persisted (upsert is idempotent, so re-running afterward picks up
// exactly where it left off — nothing is duplicated).

import type { MondayClient } from "./client.ts";
import { mapMondayItemToLead } from "./mapper.ts";
import { fetchExistingItemIds, countActiveLeadsForBoard, upsertLead } from "./leads-repository.ts";
import { upsertMondayBoard, upsertMondayBoardColumns } from "./board-repository.ts";
import { completeImportRun, createImportRun, recordImportError, updateImportRunProgress } from "./import-runs-repository.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

/** Thrown on a fatal (non-per-item) failure — carries the run id so the caller can still look up what was recorded. */
export class ImportRunFailedError extends Error {
  importRunId: string;
  constructor(message: string, importRunId: string, cause?: unknown) {
    super(message);
    this.importRunId = importRunId;
    this.cause = cause;
  }
}

export interface ImportSummary {
  importRunId: string;
  boardId: string;
  boardName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  status: "completed" | "completed_with_errors";
  mondayTotal: number;
  crmTotal: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  missingCount: number;
  duplicateCount: number;
  pagesProcessed: number;
  durationMs: number;
}

export async function runLeadImport(deps: {
  mondayClient: MondayClient;
  supabase: SupabaseClientLike;
  boardId: string;
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
    console.log(`monday-import: board "${meta.boardName}" (${meta.boardId}) in workspace "${meta.workspaceName}" — ${meta.columns.length} columns`);

    // Fetched once, up front: lets each item be classified created/updated
    // in O(1) without a query per item.
    const existingIds = await fetchExistingItemIds(deps.supabase, deps.boardId);

    const { totalItems, totalPages } = await deps.mondayClient.fetchAllBoardItems(deps.boardId, {
      pageSize: deps.pageSize,
      onPage: async (page, pageNumber) => {
        console.log(`monday-import: page ${pageNumber} — ${page.items.length} items`);

        for (const item of page.items) {
          totalProcessed++;
          try {
            const normalized = mapMondayItemToLead(item, deps.boardId, deps.columnIdMapJson);
            const wasExisting = existingIds.has(Number(item.id));
            await upsertLead(deps.supabase, normalized, "initial_import");
            if (wasExisting) {
              updatedCount++;
            } else {
              createdCount++;
              existingIds.add(Number(item.id));
            }
          } catch (err) {
            failedCount++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`monday-import: failed to import item ${item.id}:`, message);
            await recordImportError(deps.supabase, runId, { mondayItemId: item.id, errorMessage: message });
          }
        }

        await updateImportRunProgress(deps.supabase, runId, { totalProcessed, createdCount, updatedCount, failedCount });
        console.log(`monday-import: processed=${totalProcessed} created=${createdCount} updated=${updatedCount} failed=${failedCount}`);
      },
    });

    const crmTotal = await countActiveLeadsForBoard(deps.supabase, deps.boardId);
    // Structurally can't be negative or non-zero-duplicate: the unique
    // constraint on (monday_board_id, monday_item_id) makes a duplicate
    // CRM lead for the same Monday item impossible.
    const missingCount = Math.max(0, totalItems - createdCount - updatedCount - failedCount);
    const status = failedCount > 0 ? "completed_with_errors" : "completed";

    await completeImportRun(deps.supabase, runId, {
      status,
      counts: { totalProcessed, createdCount, updatedCount, failedCount },
    });

    if (missingCount > 0) {
      console.error(
        `monday-import: ${missingCount} item(s) fetched from Monday were neither created, updated, nor recorded as failed — investigate.`,
      );
    }

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
