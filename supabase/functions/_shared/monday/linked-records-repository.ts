// Supabase-side persistence for crm_calls / crm_deals — records synced
// from a board other than the Leads board, but linked back to a lead.
// Structurally identical to leads-repository.ts's upsertLead, plus
// resolving the related lead's local uuid (best-effort — a call or deal
// still imports successfully even when its linked lead hasn't been
// imported yet, or the link can't be resolved at all).

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

import type { NormalizedLead } from "./types.ts";

export type LinkedRecordTable = "crm_calls" | "crm_deals";

async function resolveRelatedLeadId(
  supabase: SupabaseClientLike,
  leadsBoardId: string,
  relatedLeadMondayItemId: string | null,
): Promise<string | null> {
  if (!relatedLeadMondayItemId) return null;

  const { data } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("monday_board_id", Number(leadsBoardId))
    .eq("monday_item_id", Number(relatedLeadMondayItemId))
    .maybeSingle();

  return data?.id ?? null;
}

/** Shapes a crm_calls/crm_deals row from a normalized record — shared by the single and batch upsert paths so both persist identical columns. */
function buildLinkedRecordRow(
  record: NormalizedLead,
  relatedLeadMondayItemId: string | null,
  relatedLeadId: string | null,
  eventType: string,
) {
  return {
    monday_board_id: Number(record.mondayBoardId),
    monday_item_id: Number(record.mondayItemId),
    monday_group_id: record.mondayGroupId,
    monday_group_title: record.mondayGroupTitle,
    name: record.name,
    status: record.status,
    owner_name: record.ownerName,
    owner_monday_user_id: record.ownerMondayUserId ? Number(record.ownerMondayUserId) : null,
    email: record.email,
    phone: record.phone,
    company: record.company,
    related_lead_monday_item_id: relatedLeadMondayItemId ? Number(relatedLeadMondayItemId) : null,
    related_lead_id: relatedLeadId,
    custom_fields: record.customFields,
    raw_column_values: record.rawColumnValues,
    monday_created_at: record.mondayCreatedAt,
    monday_updated_at: record.mondayUpdatedAt,
    is_archived: false,
    archived_at: null,
    is_deleted: false,
    deleted_at: null,
    last_synced_at: new Date().toISOString(),
    last_synced_event_type: eventType,
  };
}

/**
 * Upserts a call/deal record keyed on (monday_board_id, monday_item_id) —
 * same idempotency guarantee as upsertLead. Reuses the NormalizedLead
 * shape (name/status/owner/email/phone/company/custom_fields) since
 * mapMondayItemToLead's field set applies equally to these boards' common
 * columns; anything board-specific still lands in custom_fields.
 */
export async function upsertLinkedRecord(
  supabase: SupabaseClientLike,
  table: LinkedRecordTable,
  record: NormalizedLead,
  opts: { relatedLeadMondayItemId: string | null; leadsBoardId: string; eventType: string },
) {
  const relatedLeadId = await resolveRelatedLeadId(supabase, opts.leadsBoardId, opts.relatedLeadMondayItemId);
  const row = buildLinkedRecordRow(record, opts.relatedLeadMondayItemId, relatedLeadId, opts.eventType);

  const { data, error } = await supabase
    .from(table)
    .upsert(row, { onConflict: "monday_board_id,monday_item_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Resolves many related-lead Monday item ids to their crm_leads uuids in
 * as few queries as possible (chunked `in (...)` lookups), returning a
 * map keyed by the Monday item id (as a string). The per-item
 * resolveRelatedLeadId above issues one query per record, which is the
 * dominant cost when importing a large board; the bulk import uses this
 * instead so a whole page resolves in a single round trip.
 */
export async function resolveRelatedLeadIds(
  supabase: SupabaseClientLike,
  leadsBoardId: string,
  relatedLeadMondayItemIds: (string | null)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = [...new Set(relatedLeadMondayItemIds.filter((v): v is string => Boolean(v)).map((v) => Number(v)))];
  if (ids.length === 0) return result;

  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("crm_leads")
      .select("id, monday_item_id")
      .eq("monday_board_id", Number(leadsBoardId))
      .in("monday_item_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) result.set(String(r.monday_item_id), r.id);
  }
  return result;
}

/**
 * Upserts many already-built rows in one request (keyed on the same
 * conflict target as upsertLinkedRecord). Rows come from
 * buildLinkedRecordRow via prepareLinkedRecordRow so the batch and
 * single-item paths stay identical.
 */
export async function batchUpsertLinkedRecords(
  supabase: SupabaseClientLike,
  table: LinkedRecordTable,
  rows: ReturnType<typeof buildLinkedRecordRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "monday_board_id,monday_item_id" });
  if (error) throw error;
}

/** Builds one row for the batch path, resolving related_lead_id from a pre-fetched map. */
export function prepareLinkedRecordRow(
  record: NormalizedLead,
  relatedLeadMondayItemId: string | null,
  relatedLeadIdByMondayItemId: Map<string, string>,
  eventType: string,
) {
  const relatedLeadId = relatedLeadMondayItemId
    ? relatedLeadIdByMondayItemId.get(String(relatedLeadMondayItemId)) ?? null
    : null;
  return buildLinkedRecordRow(record, relatedLeadMondayItemId, relatedLeadId, eventType);
}

/**
 * After a COMPLETE board import (every current Monday item was fetched and
 * upserted this run), soft-deletes any still-active row for the board that
 * was NOT refreshed — i.e. its last_synced_at predates the run start, so
 * the item no longer exists on Monday (deleted, or archived out of the
 * board view). This is what keeps counts honest as deals leave the board.
 *
 * MUST only be called after a genuinely complete, error-free pass — never
 * after a truncated or partially-failed run, or it would delete live rows
 * that simply weren't reached. Callers gate on both conditions and on a
 * sanity check that the fetched item count isn't implausibly low.
 * Returns the number of rows reconciled.
 */
export async function reconcileRemovedLinkedRecords(
  supabase: SupabaseClientLike,
  table: LinkedRecordTable,
  boardId: string,
  runStartedAtIso: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("monday_board_id", Number(boardId))
    .eq("is_deleted", false)
    .lt("last_synced_at", runStartedAtIso)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Count of active (non-deleted) records for a board in the given table — for post-import validation. */
export async function countActiveLinkedRecordsForBoard(
  supabase: SupabaseClientLike,
  table: LinkedRecordTable,
  boardId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("monday_board_id", Number(boardId))
    .eq("is_deleted", false);
  if (error) throw error;
  return count ?? 0;
}

/** All monday_item_id values already present for a board in the given table — for created/updated classification. */
export async function fetchExistingLinkedRecordItemIds(
  supabase: SupabaseClientLike,
  table: LinkedRecordTable,
  boardId: string,
): Promise<Set<number>> {
  const { data, error } = await supabase.from(table).select("monday_item_id").eq("monday_board_id", Number(boardId));
  if (error) throw error;
  return new Set((data ?? []).map((row: { monday_item_id: number }) => row.monday_item_id));
}
