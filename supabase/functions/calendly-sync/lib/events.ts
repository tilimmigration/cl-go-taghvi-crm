// Pure normalization/extraction of Calendly REST API objects into the
// calendly_events column shape. Mirrors calendly-webhook/lib/events.ts for
// email normalization and the booked/canceled status mapping, but reads the
// Calendly REST API shapes (a scheduled_event object + one of its invitees)
// instead of a webhook payload. No I/O — unit-testable under plain Node.

/** DB-side status vocabulary (matches the calendly_events CHECK constraint). */
export type CalendlyDbStatus = "booked" | "canceled" | "no_show";

export interface NormalizedSyncEvent {
  /** scheduled_event.uri — the idempotency key (one row per scheduled event). */
  calendlyEventUri: string;
  inviteeUri: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  eventName: string | null;
  /** event_type URI (kept as text, same as the webhook). */
  eventType: string | null;
  /** scheduled start time (start_time). */
  scheduledAt: string | null;
  /** scheduled end time (end_time). */
  endedAt: string | null;
  status: CalendlyDbStatus;
  /** booking creation time (scheduled_event.created_at). */
  ceBookedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** Trim + lowercase; require an '@'. Mirrors calendly-webhook/lib/events.ts. */
export function normalizeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  return s && s.includes("@") ? s : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Maps Calendly's active/canceled status to the DB vocabulary. Prefers the
 * invitee status (an invitee can cancel) and falls back to the event status.
 * Calendly's REST status has no "no_show" (that is a separate explicit marking),
 * so this only ever returns "booked" or "canceled".
 */
export function mapStatus(inviteeStatus: unknown, eventStatus: unknown): CalendlyDbStatus {
  const s = (str(inviteeStatus) ?? str(eventStatus) ?? "").toLowerCase();
  if (s === "canceled" || s === "cancelled") return "canceled";
  return "booked";
}

/**
 * Combines a scheduled_event object with ONE of its invitees into the
 * normalized shape. Returns null only when the scheduled_event has no URI
 * (nothing to key on). `invitee` may be null (event with no invitee).
 */
// deno-lint-ignore no-explicit-any
export function normalizeSyncEvent(scheduledEvent: any, invitee: any): NormalizedSyncEvent | null {
  const se = scheduledEvent ?? {};
  const inv = invitee ?? {};

  const calendlyEventUri = str(se.uri);
  if (!calendlyEventUri) return null;

  const status = mapStatus(inv.status, se.status);
  const cancellation = inv.cancellation ?? se.cancellation ?? {};

  return {
    calendlyEventUri,
    inviteeUri: str(inv.uri),
    inviteeEmail: normalizeEmail(inv.email),
    inviteeName: str(inv.name),
    eventName: str(se.name),
    eventType: str(se.event_type),
    scheduledAt: str(se.start_time),
    endedAt: str(se.end_time),
    status,
    // booking time; fall back to invitee creation, then the start time.
    ceBookedAt: str(se.created_at) ?? str(inv.created_at) ?? str(se.start_time),
    canceledAt: status === "canceled"
      ? (str(cancellation.created_at) ?? str(inv.updated_at) ?? str(se.updated_at))
      : null,
    cancelReason: status === "canceled" ? str(cancellation.reason) : null,
  };
}
