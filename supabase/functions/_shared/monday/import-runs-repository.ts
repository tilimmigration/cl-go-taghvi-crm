// Supabase-side persistence for public.lead_import_runs and
// public.lead_import_errors — the audit trail for bulk import runs
// (distinct from monday_webhook_logs, which is per-webhook-event, not
// per-batch-run).

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

export interface ImportRunCounts {
  totalProcessed: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
}

export async function createImportRun(supabase: SupabaseClientLike): Promise<string> {
  const { data, error } = await supabase
    .from("lead_import_runs")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateImportRunProgress(supabase: SupabaseClientLike, runId: string, counts: ImportRunCounts) {
  const { error } = await supabase
    .from("lead_import_runs")
    .update({
      total_processed: counts.totalProcessed,
      created_count: counts.createdCount,
      updated_count: counts.updatedCount,
      failed_count: counts.failedCount,
    })
    .eq("id", runId);
  if (error) throw error;
}

export async function completeImportRun(
  supabase: SupabaseClientLike,
  runId: string,
  args: { status: "completed" | "completed_with_errors" | "failed"; counts: ImportRunCounts; errorMessage?: string | null },
) {
  const { error } = await supabase
    .from("lead_import_runs")
    .update({
      status: args.status,
      completed_at: new Date().toISOString(),
      total_processed: args.counts.totalProcessed,
      created_count: args.counts.createdCount,
      updated_count: args.counts.updatedCount,
      failed_count: args.counts.failedCount,
      error_message: args.errorMessage ?? null,
    })
    .eq("id", runId);
  if (error) throw error;
}

export async function recordImportError(
  supabase: SupabaseClientLike,
  runId: string,
  args: { mondayItemId: string | null; errorMessage: string; mondayColumnId?: string | null },
) {
  // Logging failures must never crash the import — swallow after printing.
  try {
    const { error } = await supabase.from("lead_import_errors").insert({
      import_run_id: runId,
      monday_item_id: args.mondayItemId ? Number(args.mondayItemId) : null,
      error_message: args.errorMessage,
      monday_column_id: args.mondayColumnId ?? null,
    });
    if (error) console.error("monday-import: failed to record import error:", error.message);
  } catch (err) {
    console.error("monday-import: failed to record import error:", err instanceof Error ? err.message : err);
  }
}
