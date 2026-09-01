// The shared Monday -> CRM sync pipeline:
//
//   Monday API (client.ts)
//     -> Normalizer/Transformer (mapper.ts)
//     -> CRM Lead Upsert (leads-repository.ts)
//     -> Database
//
// This is the ONE place that wires those three together. The webhook
// entrypoint (monday-webhook/index.ts) calls into this module and must
// never call the client/mapper/repository directly — and any future
// initial/bulk import script must do the same, so both paths are
// guaranteed to transform and persist leads identically.

import type { MondayClient } from "./client.ts";
import { mapMondayItemToLead } from "./mapper.ts";
import { markLeadArchived, markLeadDeleted, upsertLead } from "./leads-repository.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

export class ItemNotFoundError extends Error {}
export class BoardMismatchError extends Error {}

/**
 * Fetches the latest complete state of a Monday item and upserts it as a
 * CRM lead. Used for create_item, change_column_value and change_name —
 * per spec, none of these trust the webhook payload as the full record;
 * they all re-fetch and replace the entire lead.
 */
export async function syncItemFromMonday(
  deps: { mondayClient: MondayClient; supabase: SupabaseClientLike; columnIdMapJson?: string },
  boardId: string,
  itemId: string,
  eventType: string,
) {
  const item = await deps.mondayClient.fetchItem(itemId);
  if (!item) {
    throw new ItemNotFoundError(`Monday item ${itemId} was not found (deleted, archived-hidden, or inaccessible)`);
  }

  // Defense in depth: the webhook payload's board id was already checked
  // by the caller, but re-confirm against the freshly fetched item too, in
  // case of an id collision or a misconfigured board id.
  if (item.board?.id && String(item.board.id) !== String(boardId)) {
    throw new BoardMismatchError(
      `Monday item ${itemId} belongs to board ${item.board.id}, not the configured Leads board ${boardId}`,
    );
  }

  const normalized = mapMondayItemToLead(item, boardId, deps.columnIdMapJson);
  return upsertLead(deps.supabase, normalized, eventType);
}

export async function archiveItem(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  archivedAt: string,
) {
  return markLeadArchived(supabase, boardId, itemId, archivedAt);
}

export async function deleteItem(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  deletedAt: string,
) {
  return markLeadDeleted(supabase, boardId, itemId, deletedAt);
}
