// Supabase-side persistence for synced Monday.com leads. This is the only
// module allowed to write to public.crm_leads — both the webhook pipeline
// and any future import script should call these functions rather than
// issuing their own upserts, so the idempotency key and column list stay
// in exactly one place.

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

import type { NormalizedLead } from "./types.ts";

const TABLE = "crm_leads";

/**
 * All monday_item_id values already present for a board, as a Set, fetched
 * once up front. Used by the bulk importer to classify each item as
 * created vs. updated without an extra round-trip per item.
 */
export async function fetchExistingItemIds(supabase: SupabaseClientLike, boardId: string): Promise<Set<number>> {
  const { data, error } = await supabase.from(TABLE).select("monday_item_id").eq("monday_board_id", Number(boardId));
  if (error) throw error;
  return new Set((data ?? []).map((row: { monday_item_id: number }) => row.monday_item_id));
}

/** Count of active (non-deleted) leads for a board — used for post-import validation. */
export async function countActiveLeadsForBoard(supabase: SupabaseClientLike, boardId: string): Promise<number> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("monday_board_id", Number(boardId))
    .eq("is_deleted", false);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Upserts a lead keyed on (monday_board_id, monday_item_id) — the Monday
 * item id is the external identity, NOT the row's uuid. Replaying the
 * same event (or re-fetching+upserting the same item twice) always
 * resolves to one row: this is what makes create_item, change_column_value
 * and change_name all safe to process through the same "fetch full item,
 * then upsert" path, and what makes duplicate webhook deliveries safe.
 */
export async function upsertLead(
  supabase: SupabaseClientLike,
  lead: NormalizedLead,
  eventType: string,
) {
  const row = {
    monday_board_id: Number(lead.mondayBoardId),
    monday_item_id: Number(lead.mondayItemId),
    monday_group_id: lead.mondayGroupId,
    monday_group_title: lead.mondayGroupTitle,
    name: lead.name,
    first_name: lead.firstName,
    last_name: lead.lastName,
    lead_type: lead.leadType,
    lead_source: lead.leadSource,
    status: lead.status,
    stage: lead.stage,
    owner_name: lead.ownerName,
    owner_monday_user_id: lead.ownerMondayUserId ? Number(lead.ownerMondayUserId) : null,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    website: lead.website,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    country: lead.country,
    industry: lead.industry,
    notes: lead.notes,
    custom_fields: lead.customFields,
    raw_column_values: lead.rawColumnValues,
    monday_created_at: lead.mondayCreatedAt,
    monday_updated_at: lead.mondayUpdatedAt,
    // A fresh upsert from a live Monday item always means "not archived,
    // not deleted" — item_archived/item_deleted are handled separately
    // via markLeadArchived/markLeadDeleted and never go through this path.
    is_archived: false,
    archived_at: null,
    is_deleted: false,
    deleted_at: null,
    last_synced_at: new Date().toISOString(),
    last_synced_event_type: eventType,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "monday_board_id,monday_item_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Marks a lead archived without touching any other field. If the lead
 * isn't already known locally, a minimal stub row is created so the
 * Monday item id and archived state are still preserved per spec — full
 * details will backfill next time the item is fetched (e.g. if it's
 * unarchived and changed again).
 */
export async function markLeadArchived(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  archivedAt: string,
) {
  const { data: existing } = await supabase
    .from(TABLE)
    .select("id")
    .eq("monday_board_id", Number(boardId))
    .eq("monday_item_id", Number(itemId))
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from(TABLE)
      .update({
        is_archived: true,
        archived_at: archivedAt,
        last_synced_at: new Date().toISOString(),
        last_synced_event_type: "item_archived",
      })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from(TABLE).upsert(
    {
      monday_board_id: Number(boardId),
      monday_item_id: Number(itemId),
      name: `(archived Monday item ${itemId})`,
      is_archived: true,
      archived_at: archivedAt,
      last_synced_at: new Date().toISOString(),
      last_synced_event_type: "item_archived",
    },
    { onConflict: "monday_board_id,monday_item_id" },
  );
  if (error) throw error;
}

/**
 * Soft-deletes a lead: marks is_deleted, never removes the row. Preserves
 * the Monday item id and all previously synced data for audit history.
 */
export async function markLeadDeleted(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  deletedAt: string,
) {
  const { data: existing } = await supabase
    .from(TABLE)
    .select("id")
    .eq("monday_board_id", Number(boardId))
    .eq("monday_item_id", Number(itemId))
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from(TABLE)
      .update({
        is_deleted: true,
        deleted_at: deletedAt,
        last_synced_at: new Date().toISOString(),
        last_synced_event_type: "item_deleted",
      })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from(TABLE).upsert(
    {
      monday_board_id: Number(boardId),
      monday_item_id: Number(itemId),
      name: `(deleted Monday item ${itemId})`,
      is_deleted: true,
      deleted_at: deletedAt,
      last_synced_at: new Date().toISOString(),
      last_synced_event_type: "item_deleted",
    },
    { onConflict: "monday_board_id,monday_item_id" },
  );
  if (error) throw error;
}
