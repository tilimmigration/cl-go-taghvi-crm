// Shared types for the Monday.com -> CRM lead sync pipeline.
// Used by: Monday API client, mapper, upsert/repository, and the webhook
// entrypoint — kept dependency-free so they're usable from a future
// import script too.

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null; // raw JSON string, as returned by the Monday API
  type?: string;
  column?: { title?: string | null } | null;
}

export interface MondayItem {
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  state?: string | null; // "active" | "archived" | "deleted"
  group?: { id: string; title: string } | null;
  board?: { id: string } | null;
  column_values: MondayColumnValue[];
}

/** A column definition on a Monday board — from Board.columns, not an item's values. */
export interface MondayColumnDef {
  id: string;
  title: string | null;
  type: string | null;
  description: string | null;
  settings_str: string | null;
  archived: boolean;
}

/** Board + workspace metadata, and every column defined on the board. */
export interface MondayBoardMeta {
  boardId: string;
  boardName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  columns: MondayColumnDef[];
}

/** One page of items from a paginated board fetch. */
export interface MondayItemsPage {
  items: MondayItem[];
  cursor: string | null;
}

/** The normalized shape the mapper produces and the repository upserts. */
export interface NormalizedLead {
  mondayBoardId: string;
  mondayItemId: string;
  mondayGroupId: string | null;
  mondayGroupTitle: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  leadType: string | null;
  leadSource: string | null;
  status: string | null;
  stage: string | null;
  ownerName: string | null;
  ownerMondayUserId: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  notes: string | null;
  customFields: Record<string, { title: string | null; type: string | null; text: string | null; value: unknown }>;
  rawColumnValues: MondayColumnValue[];
  mondayCreatedAt: string | null;
  mondayUpdatedAt: string | null;
}

/**
 * Canonical webhook event types this pipeline understands. Monday's own
 * `event.type` values have varied across API versions (e.g. `create_pulse`
 * vs `create_item`) — normalizeEventType() in events.ts maps known
 * variants onto these canonical names, so the rest of the pipeline only
 * ever deals with this fixed set.
 */
export type CanonicalEventType =
  | "create_item"
  | "change_column_value"
  | "change_name"
  | "item_archived"
  | "item_deleted";

export interface NormalizedWebhookEvent {
  /** Raw event.type as sent by Monday, before alias normalization. */
  rawType: string;
  type: CanonicalEventType | null;
  boardId: string | null;
  itemId: string | null;
  userId: string | null;
  columnId: string | null;
  triggerTime: string | null;
  eventId: string | null;
}

export type WebhookLogStatus =
  | "received"
  | "processed"
  | "skipped_wrong_board"
  | "skipped_invalid"
  | "skipped_unsupported_event"
  | "error";
