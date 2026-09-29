// Builds the calendly_events row for one scheduled event from its normalized
// data + match verdict + any existing row. Pure (no I/O) so it is unit-testable;
// the orchestrator batches these into a chunked, idempotent upsert on
// calendly_event_uri.
//
// Invariants this preserves (all required by the spec):
//   * Idempotent: the same event re-synced produces the same row (keyed on
//     calendly_event_uri), never a duplicate.
//   * CE Completed stays EXPLICIT-ONLY: this builder NEVER emits ce_completed /
//     ce_completed_at / ce_completed_by. On INSERT the table defaults apply
//     (false / null / null); on UPDATE those columns are absent from the write
//     so an existing explicit completion is preserved untouched.
//   * ce_booked is historical: a canceled booking keeps ce_booked = true (it
//     WAS booked), so the lifecycle view reads 'ce_canceled' while the booking
//     history is retained.
//   * Existing useful data is preserved: if the invitee email no longer resolves
//     to exactly one lead, an existing CRM link is retained rather than cleared.
//
// The key set is IDENTICAL for every row (canceled fields are emitted as null on
// booked rows) so a bulk PostgREST upsert has a uniform column list — which is
// what guarantees the ce_completed* columns are never in the UPDATE SET clause.

import type { NormalizedSyncEvent } from "./events.ts";
import type { SyncMatch } from "./matching.ts";

export interface ExistingCalendlyRow {
  lead_id: string | null;
  monday_item_id: number | null;
  ce_booked: boolean | null;
  ce_booked_at: string | null;
  status: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
}

// deno-lint-ignore no-explicit-any
export type CalendlyEventRow = Record<string, any>;

export function buildSyncRow(
  evt: NormalizedSyncEvent,
  match: SyncMatch,
  existing: ExistingCalendlyRow | null,
  rawPayload: unknown,
): CalendlyEventRow {
  // Prefer a fresh confident match; otherwise retain an existing CRM link.
  const leadId = match.status === "matched" ? match.leadId : (existing?.lead_id ?? null);
  const mondayItemId = match.status === "matched" ? match.mondayItemId : (existing?.monday_item_id ?? null);
  // match_status reflects the link actually stored: 'matched' whenever a lead is
  // linked (fresh or retained), else the ambiguity verdict from this run.
  const matchStatus: SyncMatch["status"] = leadId ? "matched" : match.status;

  const row: CalendlyEventRow = {
    calendly_event_uri: evt.calendlyEventUri,
    invitee_uri: evt.inviteeUri,
    invitee_email: evt.inviteeEmail,
    invitee_name: evt.inviteeName,
    event_name: evt.eventName,
    event_type: evt.eventType,
    scheduled_at: evt.scheduledAt,
    ended_at: evt.endedAt,
    status: evt.status,
    canceled_at: null,
    cancel_reason: null,
    lead_id: leadId,
    monday_item_id: mondayItemId,
    match_status: matchStatus,
    ce_booked: false,
    ce_booked_at: null,
    raw_payload: rawPayload ?? {},
  };

  if (evt.status === "canceled") {
    row.canceled_at = evt.canceledAt ?? existing?.canceled_at ?? null;
    row.cancel_reason = evt.cancelReason ?? existing?.cancel_reason ?? null;
    // ce_booked is historical: preserve an existing true, else derive from a
    // known booking time.
    row.ce_booked_at = existing?.ce_booked_at ?? evt.ceBookedAt ?? null;
    row.ce_booked = (existing?.ce_booked ?? Boolean(evt.ceBookedAt)) && Boolean(row.ce_booked_at);
  } else {
    row.ce_booked_at = evt.ceBookedAt ?? existing?.ce_booked_at ?? evt.scheduledAt ?? null;
    row.ce_booked = Boolean(row.ce_booked_at);
  }

  // NOTE: ce_completed / ce_completed_at / ce_completed_by are intentionally
  // absent from `row`. INSERT -> DB defaults (false/null/null); UPDATE -> not in
  // the SET clause -> an existing explicit completion is preserved.
  return row;
}
