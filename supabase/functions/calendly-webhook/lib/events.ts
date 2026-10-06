// Normalizes a Calendly webhook payload into the fields calendly_events stores.
// Pure, no I/O. Supports invitee.created and invitee.canceled; every other
// event type returns null so the caller can safely ignore it.
//
// Timestamp choices (documented, never fabricated — all come from the payload):
//   - ce_booked_at  ← payload.created_at (when the invitee booked), falling back
//                     to the webhook envelope created_at, then the scheduled
//                     start time.
//   - scheduled_at  ← payload.scheduled_event.start_time (the CE start time).
//   - canceled_at   ← payload.cancellation.canceled_at if present, else
//                     payload.updated_at (when the invitee was canceled), else
//                     the webhook envelope created_at.
//
// Idempotency key: payload.scheduled_event.uri — the stable scheduled-event URI,
// identical across the created and canceled deliveries for the same booking.

export type CalendlyEventKind = "invitee.created" | "invitee.canceled";

export interface NormalizedCalendlyEvent {
  kind: CalendlyEventKind;
  calendlyEventUri: string;
  inviteeUri: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  eventName: string | null;
  eventType: string | null;
  scheduledAt: string | null;
  bookedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** trim + lowercase; null for empty or anything without an "@". */
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

// deno-lint-ignore no-explicit-any
export function normalizeCalendlyEvent(body: any): NormalizedCalendlyEvent | null {
  const kind = body?.event;
  if (kind !== "invitee.created" && kind !== "invitee.canceled") return null;

  const p = body?.payload ?? {};
  const se = p?.scheduled_event ?? {};
  const calendlyEventUri = str(se?.uri);
  if (!calendlyEventUri) return null; // no stable idempotency key → cannot store safely

  const evt: NormalizedCalendlyEvent = {
    kind: kind as CalendlyEventKind,
    calendlyEventUri,
    inviteeUri: str(p?.uri),
    inviteeEmail: normalizeEmail(p?.email),
    inviteeName: str(p?.name),
    eventName: str(se?.name),
    eventType: str(se?.event_type),
    scheduledAt: str(se?.start_time),
    bookedAt: null,
    canceledAt: null,
    cancelReason: null,
  };

  if (kind === "invitee.created") {
    evt.bookedAt = str(p?.created_at) ?? str(body?.created_at) ?? str(se?.start_time);
  } else {
    const c = p?.cancellation ?? {};
    evt.canceledAt = str(c?.canceled_at) ?? str(p?.updated_at) ?? str(body?.created_at);
    evt.cancelReason = str(c?.reason);
  }

  return evt;
}
