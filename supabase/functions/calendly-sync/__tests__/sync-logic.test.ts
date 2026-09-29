// Unit tests for the calendly-sync pure logic. Run with:
//   node --experimental-strip-types --test supabase/functions/calendly-sync/__tests__/sync-logic.test.ts
// No Deno, no network, no database — only the pure modules are exercised.

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeEmail, mapStatus, normalizeSyncEvent } from "../lib/events.ts";
import { buildLeadEmailIndex, matchEmail, type CrmLeadLike } from "../lib/matching.ts";
import { buildSyncRow } from "../lib/persist.ts";

// --- events -----------------------------------------------------------------

test("normalizeEmail trims + lowercases and requires '@'", () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  assert.equal(normalizeEmail("notanemail"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
});

test("mapStatus maps active->booked, canceled->canceled, prefers invitee", () => {
  assert.equal(mapStatus("active", "active"), "booked");
  assert.equal(mapStatus("canceled", "active"), "canceled");
  assert.equal(mapStatus(undefined, "canceled"), "canceled");
  assert.equal(mapStatus("cancelled", undefined), "canceled"); // British spelling tolerated
});

test("normalizeSyncEvent extracts a booked event", () => {
  const se = {
    uri: "https://api.calendly.com/scheduled_events/EVT1",
    name: "Case Evaluation",
    status: "active",
    start_time: "2026-01-02T15:00:00.000000Z",
    end_time: "2026-01-02T15:30:00.000000Z",
    event_type: "https://api.calendly.com/event_types/ET1",
    created_at: "2026-01-01T09:00:00.000000Z",
  };
  const inv = { uri: "https://api.calendly.com/.../invitees/INV1", email: "  Jane@Example.com ", name: "Jane", status: "active" };
  const n = normalizeSyncEvent(se, inv)!;
  assert.equal(n.calendlyEventUri, "https://api.calendly.com/scheduled_events/EVT1");
  assert.equal(n.inviteeEmail, "jane@example.com");
  assert.equal(n.inviteeName, "Jane");
  assert.equal(n.eventName, "Case Evaluation");
  assert.equal(n.scheduledAt, "2026-01-02T15:00:00.000000Z");
  assert.equal(n.endedAt, "2026-01-02T15:30:00.000000Z");
  assert.equal(n.status, "booked");
  assert.equal(n.ceBookedAt, "2026-01-01T09:00:00.000000Z");
  assert.equal(n.canceledAt, null);
});

test("normalizeSyncEvent extracts a canceled event with reason", () => {
  const se = { uri: "https://api.calendly.com/scheduled_events/EVT2", status: "canceled", start_time: "2026-02-02T15:00:00Z", updated_at: "2026-02-01T10:00:00Z" };
  const inv = { uri: "i2", email: "x@y.com", status: "canceled", cancellation: { reason: "client rescheduled", created_at: "2026-02-01T11:00:00Z" } };
  const n = normalizeSyncEvent(se, inv)!;
  assert.equal(n.status, "canceled");
  assert.equal(n.cancelReason, "client rescheduled");
  assert.equal(n.canceledAt, "2026-02-01T11:00:00Z");
});

test("normalizeSyncEvent returns null without a scheduled_event uri", () => {
  assert.equal(normalizeSyncEvent({ status: "active" }, { email: "a@b.com" }), null);
});

// --- matching ---------------------------------------------------------------

const leads: CrmLeadLike[] = [
  { id: "L1", email: "Solo@Example.com", monday_item_id: 111 },
  { id: "L2", email: "dup@example.com", monday_item_id: 222 },
  { id: "L3", email: "dup@example.com", monday_item_id: 333 },
];
const index = buildLeadEmailIndex(leads);

test("matchEmail: exactly one -> matched (with monday_item_id)", () => {
  const m = matchEmail(index, "solo@example.com");
  assert.equal(m.status, "matched");
  assert.equal(m.leadId, "L1");
  assert.equal(m.mondayItemId, 111);
});

test("matchEmail: zero -> unmatched", () => {
  const m = matchEmail(index, "nobody@example.com");
  assert.equal(m.status, "unmatched");
  assert.equal(m.leadId, null);
});

test("matchEmail: two+ -> ambiguous, never guessed", () => {
  const m = matchEmail(index, "dup@example.com");
  assert.equal(m.status, "ambiguous");
  assert.equal(m.leadId, null);
  assert.equal(m.mondayItemId, null);
});

test("matchEmail: null/blank email -> unmatched", () => {
  assert.equal(matchEmail(index, null).status, "unmatched");
  assert.equal(matchEmail(index, "").status, "unmatched");
});

// --- persist ----------------------------------------------------------------

const bookedNorm = {
  calendlyEventUri: "EVT1",
  inviteeUri: "INV1",
  inviteeEmail: "solo@example.com",
  inviteeName: "Jane",
  eventName: "Case Evaluation",
  eventType: "ET1",
  scheduledAt: "2026-01-02T15:00:00Z",
  endedAt: "2026-01-02T15:30:00Z",
  status: "booked" as const,
  ceBookedAt: "2026-01-01T09:00:00Z",
  canceledAt: null,
  cancelReason: null,
};

test("buildSyncRow (booked, matched): ce_booked true, status booked, never emits ce_completed*", () => {
  const row = buildSyncRow(bookedNorm, { status: "matched", leadId: "L1", mondayItemId: 111 }, null, { raw: 1 });
  assert.equal(row.status, "booked");
  assert.equal(row.ce_booked, true);
  assert.equal(row.ce_booked_at, "2026-01-01T09:00:00Z");
  assert.equal(row.lead_id, "L1");
  assert.equal(row.monday_item_id, 111);
  assert.equal(row.match_status, "matched");
  assert.equal(row.canceled_at, null);
  // Explicit-only CE Completed: these keys must be ABSENT so an existing
  // completion is never overwritten on update.
  assert.equal(Object.hasOwn(row, "ce_completed"), false);
  assert.equal(Object.hasOwn(row, "ce_completed_at"), false);
  assert.equal(Object.hasOwn(row, "ce_completed_by"), false);
});

test("buildSyncRow (canceled): status canceled, ce_booked stays true (historical), completion untouched", () => {
  const norm = { ...bookedNorm, status: "canceled" as const, canceledAt: "2026-01-03T10:00:00Z", cancelReason: "no longer needed" };
  const row = buildSyncRow(norm, { status: "matched", leadId: "L1", mondayItemId: 111 }, null, {});
  assert.equal(row.status, "canceled");
  assert.equal(row.ce_booked, true);
  assert.equal(row.canceled_at, "2026-01-03T10:00:00Z");
  assert.equal(row.cancel_reason, "no longer needed");
  assert.equal(Object.hasOwn(row, "ce_completed"), false);
});

test("buildSyncRow (unmatched): lead_id null, match_status unmatched", () => {
  const row = buildSyncRow(bookedNorm, { status: "unmatched", leadId: null, mondayItemId: null }, null, {});
  assert.equal(row.lead_id, null);
  assert.equal(row.match_status, "unmatched");
});

test("buildSyncRow (ambiguous): lead_id null, match_status ambiguous", () => {
  const row = buildSyncRow(bookedNorm, { status: "ambiguous", leadId: null, mondayItemId: null }, null, {});
  assert.equal(row.lead_id, null);
  assert.equal(row.match_status, "ambiguous");
});

test("buildSyncRow preserves an existing CRM link when the email no longer resolves", () => {
  const existing = { lead_id: "L9", monday_item_id: 999, ce_booked: true, ce_booked_at: "2026-01-01T00:00:00Z", status: "booked", canceled_at: null, cancel_reason: null };
  const row = buildSyncRow(bookedNorm, { status: "unmatched", leadId: null, mondayItemId: null }, existing, {});
  assert.equal(row.lead_id, "L9");
  assert.equal(row.monday_item_id, 999);
  assert.equal(row.match_status, "matched"); // a retained link is 'matched'
});
