import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completeImportRun,
  createImportRun,
  recordImportError,
  updateImportRunProgress,
} from "../import-runs-repository.ts";
import { createFakeSupabaseClient } from "./fakes.ts";

test("createImportRun inserts a row with status running and returns its id", async () => {
  const supabase = createFakeSupabaseClient();
  const runId = await createImportRun(supabase);

  assert.equal(supabase.tables.lead_import_runs.length, 1);
  assert.equal(supabase.tables.lead_import_runs[0].id, runId);
  assert.equal(supabase.tables.lead_import_runs[0].status, "running");
});

test("updateImportRunProgress updates counts without changing status", async () => {
  const supabase = createFakeSupabaseClient();
  const runId = await createImportRun(supabase);

  await updateImportRunProgress(supabase, runId, { totalProcessed: 50, createdCount: 40, updatedCount: 8, failedCount: 2 });

  const row = supabase.tables.lead_import_runs[0];
  assert.equal(row.total_processed, 50);
  assert.equal(row.created_count, 40);
  assert.equal(row.updated_count, 8);
  assert.equal(row.failed_count, 2);
  assert.equal(row.status, "running");
});

test("completeImportRun sets status, completed_at and final counts", async () => {
  const supabase = createFakeSupabaseClient();
  const runId = await createImportRun(supabase);

  await completeImportRun(supabase, runId, {
    status: "completed",
    counts: { totalProcessed: 100, createdCount: 90, updatedCount: 10, failedCount: 0 },
  });

  const row = supabase.tables.lead_import_runs[0];
  assert.equal(row.status, "completed");
  assert.ok(row.completed_at);
  assert.equal(row.total_processed, 100);
});

test("completeImportRun with status failed records the error message", async () => {
  const supabase = createFakeSupabaseClient();
  const runId = await createImportRun(supabase);

  await completeImportRun(supabase, runId, {
    status: "failed",
    counts: { totalProcessed: 5, createdCount: 5, updatedCount: 0, failedCount: 0 },
    errorMessage: "Monday board 111 was not found",
  });

  assert.equal(supabase.tables.lead_import_runs[0].status, "failed");
  assert.equal(supabase.tables.lead_import_runs[0].error_message, "Monday board 111 was not found");
});

test("recordImportError inserts a row linked to the run", async () => {
  const supabase = createFakeSupabaseClient();
  const runId = await createImportRun(supabase);

  await recordImportError(supabase, runId, { mondayItemId: "999", errorMessage: "bad column value", mondayColumnId: "status" });

  assert.equal(supabase.tables.lead_import_errors.length, 1);
  assert.equal(supabase.tables.lead_import_errors[0].import_run_id, runId);
  assert.equal(supabase.tables.lead_import_errors[0].monday_item_id, 999);
  assert.equal(supabase.tables.lead_import_errors[0].monday_column_id, "status");
});
