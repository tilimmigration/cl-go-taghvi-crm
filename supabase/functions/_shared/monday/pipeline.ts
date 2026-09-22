// The shared Monday -> CRM sync pipeline:
//
//   Monday API (client.ts)
//     -> Normalizer/Transformer (mapper.ts)
//     -> CRM upsert (leads-repository.ts for the Leads board,
//        linked-records-repository.ts for the Calls / Deals boards)
//     -> Database
//
// This is the ONE place that wires those together. The webhook entrypoint
// (monday-webhook/index.ts) calls into this module and must never call the
// client/mapper/repository directly — the bulk importer follows the same
// rule — so every path transforms and persists identically.
//
// A `SyncTarget` says which table a given board's events belong to: the
// Leads board maps to crm_leads, the Calls and Deals boards each map to
// their linked-record table (and carry the Leads board id so the linked
// record's related lead can be resolved). The webhook resolves the target
// from the event's board id before calling in.

import type { MondayClient } from "./client.ts";
import { extractRelatedLeadMondayItemId, mapMondayItemToLead } from "./mapper.ts";
import { markLeadArchived, markLeadDeleted, upsertLead } from "./leads-repository.ts";
import {
  markLinkedRecordArchived,
  markLinkedRecordDeleted,
  upsertLinkedRecord,
  type LinkedRecordTable,
} from "./linked-records-repository.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

export class ItemNotFoundError extends Error {}
export class BoardMismatchError extends Error {}

/** Which CRM table a board's events sync into. */
export type SyncTarget =
  | { kind: "lead" }
  | { kind: "linked"; table: LinkedRecordTable; leadsBoardId: string };

/**
 * Fetches the latest complete state of a Monday item and upserts it into
 * the CRM table its board maps to. Used for create_item,
 * change_column_value, change_name and move_item_to_group — none of these
 * trust the webhook payload as the full record; they all re-fetch and
 * replace the entire row, so a group move re-reads the item's current
 * group and the stage count follows.
 */
export async function syncItemFromMonday(
  deps: { mondayClient: MondayClient; supabase: SupabaseClientLike; columnIdMapJson?: string },
  boardId: string,
  itemId: string,
  eventType: string,
  target: SyncTarget,
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
      `Monday item ${itemId} belongs to board ${item.board.id}, not the expected board ${boardId}`,
    );
  }

  const normalized = mapMondayItemToLead(item, boardId, deps.columnIdMapJson);

  if (target.kind === "lead") {
    return upsertLead(deps.supabase, normalized, eventType);
  }

  const relatedLeadMondayItemId = extractRelatedLeadMondayItemId(item);
  return upsertLinkedRecord(deps.supabase, target.table, normalized, {
    relatedLeadMondayItemId,
    leadsBoardId: target.leadsBoardId,
    eventType,
  });
}

export async function archiveItem(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  archivedAt: string,
  target: SyncTarget,
) {
  if (target.kind === "lead") {
    return markLeadArchived(supabase, boardId, itemId, archivedAt);
  }
  return markLinkedRecordArchived(supabase, target.table, boardId, itemId, archivedAt);
}

export async function deleteItem(
  supabase: SupabaseClientLike,
  boardId: string,
  itemId: string,
  deletedAt: string,
  target: SyncTarget,
) {
  if (target.kind === "lead") {
    return markLeadDeleted(supabase, boardId, itemId, deletedAt);
  }
  return markLinkedRecordDeleted(supabase, target.table, boardId, itemId, deletedAt);
}
