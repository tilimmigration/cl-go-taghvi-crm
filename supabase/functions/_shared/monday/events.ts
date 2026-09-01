// Normalizes Monday.com's raw webhook payload into a fixed internal
// shape, and maps Monday's (version-dependent) event.type strings onto
// the canonical event types this pipeline supports.
//
// Monday has used different event.type spellings across API/versions for
// the same underlying event (e.g. `create_pulse` vs `create_item`). Rather
// than gamble on which one a given account/version sends, every known
// variant is aliased to one canonical name here — add new variants (or
// entirely new event types) to EVENT_TYPE_ALIASES / CanonicalEventType as
// Monday's payloads are observed in practice.

import type { CanonicalEventType, NormalizedWebhookEvent } from "./types.ts";

const EVENT_TYPE_ALIASES: Record<string, CanonicalEventType> = {
  create_item: "create_item",
  create_pulse: "create_item",

  change_column_value: "change_column_value",
  update_column_value: "change_column_value",

  change_name: "change_name",
  update_name: "change_name",

  item_archived: "item_archived",
  archive_item: "item_archived",
  archive_pulse: "item_archived",

  item_deleted: "item_deleted",
  delete_item: "item_deleted",
  delete_pulse: "item_deleted",
};

function normalizeEventType(rawType: string | undefined | null): CanonicalEventType | null {
  if (!rawType) return null;
  return EVENT_TYPE_ALIASES[rawType] ?? null;
}

function firstDefined(...values: unknown[]): string | null {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

/**
 * Monday's webhook body is `{ event: {...} }`, but individual field names
 * have shifted between camelCase and snake_case across API versions
 * (`boardId`/`board_id`, `pulseId`/`itemId`/`item_id`, etc). This reads
 * every spelling seen in Monday's docs/changelog so the rest of the
 * pipeline never has to think about it again.
 */
export function normalizeWebhookEvent(rawBody: Record<string, unknown>): NormalizedWebhookEvent {
  const event = (rawBody?.event ?? {}) as Record<string, unknown>;

  const rawType = typeof event.type === "string" ? event.type : "";

  return {
    rawType,
    type: normalizeEventType(rawType),
    boardId: firstDefined(event.boardId, event.board_id),
    itemId: firstDefined(event.pulseId, event.itemId, event.item_id, event.pulse_id),
    userId: firstDefined(event.userId, event.user_id),
    columnId: firstDefined(event.columnId, event.column_id),
    triggerTime: firstDefined(event.triggerTime, event.trigger_time),
    eventId: firstDefined(rawBody.eventId, event.eventId, event.event_id),
  };
}
