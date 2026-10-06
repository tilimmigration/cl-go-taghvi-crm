// Read-merge-upsert of a Calendly event into calendly_events. Idempotent on
// calendly_event_uri (the table's unique key), so duplicate/retried deliveries
// update the same row instead of creating a new one.
//
// Ownership boundary: the webhook owns Calendly LIFECYCLE data (status,
// booking/cancellation, ce_booked). It NEVER writes CE Completed — ce_completed
// / ce_completed_at / ce_completed_by are owned by the explicit completion
// workflow. On an update they are omitted from the payload so an existing
// explicit completion is preserved; on an insert they are set to their defaults.

import type { NormalizedCalendlyEvent } from "./events.ts";
import type { LeadMatch } from "./matching.ts";

export interface UpsertResult {
  action: "inserted" | "updated";
}

// deno-lint-ignore no-explicit-any
export async function upsertCalendlyEvent(
  supabase: any,
  evt: NormalizedCalendlyEvent,
  match: LeadMatch | null,
  rawPayload: unknown,
): Promise<UpsertResult> {
  const { data: existing, error: readErr } = await supabase
    .from("calendly_events")
    .select("*")
    .eq("calendly_event_uri", evt.calendlyEventUri)
    .maybeSingle();
  if (readErr) throw new Error(`calendly_events read failed: ${readErr.message ?? String(readErr)}`);

  // deno-lint-ignore no-explicit-any
  const row: Record<string, any> = {
    calendly_event_uri: evt.calendlyEventUri,
    invitee_uri: evt.inviteeUri,
    invitee_email: evt.inviteeEmail,
    invitee_name: evt.inviteeName,
    event_name: evt.eventName,
    event_type: evt.eventType,
    scheduled_at: evt.scheduledAt,
    // Prefer a fresh non-null match; otherwise keep any association already stored.
    lead_id: match ? match.leadId : (existing?.lead_id ?? null),
    monday_item_id: match ? match.mondayItemId : (existing?.monday_item_id ?? null),
    raw_payload: rawPayload ?? {},
  };

  if (evt.kind === "invitee.created") {
    if (existing?.status === "canceled") {
      // Out-of-order: a stale created arriving after a cancel. Do not resurrect
      // the booking — keep the canceled lifecycle, only refresh enrichment/match.
      row.status = "canceled";
      row.canceled_at = existing.canceled_at ?? null;
      row.cancel_reason = existing.cancel_reason ?? null;
      row.ce_booked = existing.ce_booked ?? false;
      row.ce_booked_at = existing.ce_booked_at ?? null;
    } else {
      row.status = "booked";
      row.ce_booked = true;
      row.ce_booked_at = evt.bookedAt ?? existing?.ce_booked_at ?? evt.scheduledAt ?? null;
      // The DB requires ce_booked_at when ce_booked; never fabricate a timestamp.
      if (!row.ce_booked_at) row.ce_booked = false;
    }
  } else {
    // invitee.canceled — update lifecycle only; preserve the booking record.
    row.status = "canceled";
    row.canceled_at = evt.canceledAt ?? existing?.canceled_at ?? null;
    row.cancel_reason = evt.cancelReason ?? existing?.cancel_reason ?? null;
    row.ce_booked = existing?.ce_booked ?? false;
    row.ce_booked_at = existing?.ce_booked_at ?? null;
  }

  // CE Completed is owned by the explicit confirmation workflow, NEVER the
  // webhook. Set defaults only on insert; omit on update to preserve any
  // explicit completion already recorded.
  if (!existing) {
    row.ce_completed = false;
    row.ce_completed_at = null;
    row.ce_completed_by = null;
  }

  const { error: writeErr } = await supabase
    .from("calendly_events")
    .upsert(row, { onConflict: "calendly_event_uri" });
  if (writeErr) throw new Error(`calendly_events upsert failed: ${writeErr.message ?? String(writeErr)}`);

  return { action: existing ? "updated" : "inserted" };
}
