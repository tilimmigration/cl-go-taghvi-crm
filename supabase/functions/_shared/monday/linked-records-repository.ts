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

  const row = {
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
    related_lead_monday_item_id: opts.relatedLeadMondayItemId ? Number(opts.relatedLeadMondayItemId) : null,
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
    last_synced_event_type: opts.eventType,
  };

  const { data, error } = await supabase
    .from(table)
    .upsert(row, { onConflict: "monday_board_id,monday_item_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
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
