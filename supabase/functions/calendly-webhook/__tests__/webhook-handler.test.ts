// Integration-style tests for handleCalendlyWebhook(), covering every scenario
// in the Step-3 spec's "Testing" section. Runs under plain Node
// (`node --experimental-strip-types --test`) — no Deno, no real Supabase, no
// real Calendly. The supabase client is faked; signatures are computed with a
// real HMAC so signature verification is exercised end-to-end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCalendlyWebhook } from "../index.ts";
import { createFakeSupabaseClient } from "../../_shared/monday/__tests__/fakes.ts";
import type { CalendlyConfig } from "../lib/config.ts";

const SIGNING_KEY = "test-signing-key";
const T = 1790000000; // fixed unix seconds for deterministic tolerance checks
const NOW_MS = T * 1000;

function config(overrides: Partial<CalendlyConfig> = {}): CalendlyConfig {
  return {
    signingKey: SIGNING_KEY,
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "fake-service-role-key",
    signatureToleranceSeconds: 300,
    ...overrides,
  };
}

async function hmacHex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  let hex = "";
  for (const b of new Uint8Array(sig)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function signedRequest(payload: unknown, opts: { badSignature?: boolean } = {}): Promise<Request> {
  const rawBody = JSON.stringify(payload);
  const v1 = opts.badSignature ? "deadbeef" : await hmacHex(`${T}.${rawBody}`, SIGNING_KEY);
  return new Request("https://example.functions.supabase.co/calendly-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Calendly-Webhook-Signature": `t=${T},v1=${v1}` },
    body: rawBody,
  });
}

const EVENT_URI = "https://api.calendly.com/scheduled_events/EVT123";
const INVITEE_URI = "https://api.calendly.com/scheduled_events/EVT123/invitees/INV1";

function createdPayload(overrides: { eventUri?: string; email?: string; createdAt?: string; startTime?: string } = {}) {
  const createdAt = overrides.createdAt ?? "2026-09-20T15:00:00.000000Z";
  return {
    event: "invitee.created",
    created_at: createdAt,
    payload: {
      uri: INVITEE_URI,
      email: overrides.email ?? "Ana@Example.com",
      name: "Ana Beltran",
      status: "active",
      created_at: createdAt,
      scheduled_event: {
        uri: overrides.eventUri ?? EVENT_URI,
        name: "Case Evaluation",
        event_type: "https://api.calendly.com/event_types/EVT",
        start_time: overrides.startTime ?? "2026-10-01T10:00:00.000000Z",
        status: "active",
      },
    },
  };
}

function canceledPayload(overrides: { eventUri?: string; email?: string; updatedAt?: string; reason?: string } = {}) {
  const updatedAt = overrides.updatedAt ?? "2026-09-25T09:00:00.000000Z";
  return {
    event: "invitee.canceled",
    created_at: updatedAt,
    payload: {
      uri: INVITEE_URI,
      email: overrides.email ?? "Ana@Example.com",
      name: "Ana Beltran",
      status: "canceled",
      updated_at: updatedAt,
      cancellation: { reason: overrides.reason ?? "Something came up", canceled_by: "invitee", canceler_type: "invitee" },
      scheduled_event: {
        uri: overrides.eventUri ?? EVENT_URI,
        name: "Case Evaluation",
        event_type: "https://api.calendly.com/event_types/EVT",
        start_time: "2026-10-01T10:00:00.000000Z",
        status: "canceled",
      },
    },
  };
}

function fakeWith(leads: Array<{ id: string; monday_item_id: number | null; email: string }>) {
  const supabase = createFakeSupabaseClient();
  supabase.tables.crm_leads = leads.map((l) => ({ ...l, is_deleted: false }));
  return supabase;
}
function calendly(supabase: ReturnType<typeof createFakeSupabaseClient>) {
  return supabase.tables.calendly_events ?? [];
}

// --- Test 1: New booking ----------------------------------------------------
test("1. new booking: one row, status booked, ce_booked true + ce_booked_at, ce_completed false, lead matched", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  const res = await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.status, "booked");
  assert.equal(r.ce_booked, true);
  assert.equal(r.ce_booked_at, "2026-09-20T15:00:00.000000Z");
  assert.equal(r.ce_completed, false);
  assert.equal(r.ce_completed_at, null);
  assert.equal(r.ce_completed_by, null);
  assert.equal(r.invitee_email, "ana@example.com");
  assert.equal(r.lead_id, "lead-1");
  assert.equal(r.monday_item_id, 111);
});

// --- Test 2: Duplicate booking ----------------------------------------------
test("2. duplicate booking: same event twice → exactly one row, both succeed", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  const r1 = await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  const r2 = await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(calendly(supabase).length, 1);
  assert.equal(calendly(supabase)[0].status, "booked");
});

// --- Test 3: Cancellation ---------------------------------------------------
test("3. cancellation: same row updated to canceled with cancel info, no duplicate, booking preserved", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  const res = await handleCalendlyWebhook(await signedRequest(canceledPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "canceled");
  assert.equal(rows[0].canceled_at, "2026-09-25T09:00:00.000000Z");
  assert.equal(rows[0].cancel_reason, "Something came up");
  assert.equal(rows[0].ce_booked, true, "booking history preserved on cancel");
  assert.equal(rows[0].ce_completed, false);
});

// --- Test 4: Unknown invitee ------------------------------------------------
test("4. unknown invitee: event stored, lead_id NULL", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "someone-else@example.com" }]);
  const res = await handleCalendlyWebhook(await signedRequest(createdPayload({ email: "nomatch@example.com" })), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lead_id, null);
  assert.equal(rows[0].monday_item_id, null);
});

// --- Test 5: Ambiguous email ------------------------------------------------
test("5. ambiguous email (matches 2 leads): event stored, lead_id NULL, no guess", async () => {
  const supabase = fakeWith([
    { id: "lead-1", monday_item_id: 111, email: "ana@example.com" },
    { id: "lead-2", monday_item_id: 222, email: "ana@example.com" },
  ]);
  const res = await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lead_id, null);
  assert.equal(rows[0].monday_item_id, null);
});

// --- Test 6: Existing CE Completed ------------------------------------------
test("6. existing explicit CE Completed survives a Calendly webhook update", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  // A row already booked AND explicitly completed by a user.
  supabase.tables.calendly_events = [{
    id: "ce-1",
    calendly_event_uri: EVENT_URI,
    status: "booked",
    ce_booked: true,
    ce_booked_at: "2026-09-20T15:00:00.000000Z",
    ce_completed: true,
    ce_completed_at: "2026-10-01T11:00:00.000000Z",
    ce_completed_by: "paralegal@taghavilaw.com",
  }];
  const res = await handleCalendlyWebhook(await signedRequest(canceledPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "canceled", "lifecycle updated");
  assert.equal(rows[0].ce_completed, true, "explicit completion preserved");
  assert.equal(rows[0].ce_completed_at, "2026-10-01T11:00:00.000000Z");
  assert.equal(rows[0].ce_completed_by, "paralegal@taghavilaw.com");
});

// --- Test 7: Invalid signature ----------------------------------------------
test("7. invalid signature: rejected 401, nothing written", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  const res = await handleCalendlyWebhook(await signedRequest(createdPayload(), { badSignature: true }), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 401);
  assert.equal(calendly(supabase).length, 0);
});

// --- Test 8: CRM protection -------------------------------------------------
test("8. CRM protection: no crm_leads/calls/deals/attribution writes; CE Completed never auto-set", async () => {
  const seededLeads = [{ id: "lead-1", monday_item_id: 111, email: "ana@example.com", is_deleted: false }];
  const supabase = createFakeSupabaseClient();
  supabase.tables.crm_leads = seededLeads.map((l) => ({ ...l }));

  await handleCalendlyWebhook(await signedRequest(createdPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  await handleCalendlyWebhook(await signedRequest(canceledPayload()), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });

  // crm_leads untouched (same rows, unchanged), and no lead status field written.
  assert.deepEqual(supabase.tables.crm_leads, seededLeads);
  // Never touched at all.
  assert.equal(supabase.tables.crm_calls, undefined);
  assert.equal(supabase.tables.crm_deals, undefined);
  assert.equal(supabase.tables.lead_attribution, undefined);
  // Only calendly_events was written, and CE Completed was never auto-set.
  const rows = calendly(supabase);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ce_completed, false);
  assert.equal(rows[0].ce_completed_at, null);
  assert.equal(rows[0].ce_completed_by, null);
});

// --- Extra: unsupported event type is safely ignored ------------------------
test("unsupported event type is acknowledged (200) and ignored, nothing written", async () => {
  const supabase = fakeWith([{ id: "lead-1", monday_item_id: 111, email: "ana@example.com" }]);
  const res = await handleCalendlyWebhook(await signedRequest({ event: "routing_form_submission.created", payload: {} }), { config: config(), supabaseClient: supabase, nowMs: NOW_MS });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ignored: true });
  assert.equal(calendly(supabase).length, 0);
});
