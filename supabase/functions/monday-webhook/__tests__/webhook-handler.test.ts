// Integration-style tests for handleWebhookRequest(), covering every
// scenario listed in the "Testing" section of the spec:
//   1. Challenge verification
//   2. create_item payload
//   3. change_column_value payload
//   4. change_name payload
//   5. item_archived payload
//   6. item_deleted payload
//   7. Invalid board ID
//   8. Duplicate event
//   9. Missing item ID
//  10. Monday API failure
//
// Runs under plain Node (via `node --experimental-strip-types --test`) —
// no Deno install, no real Supabase project, no real Monday.com API call.
// The Monday and Supabase clients are fully faked; the handler is
// exercised exactly as Deno.serve would invoke it, via a real Request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhookRequest } from "../index.ts";
import { buildMondayItem, createFakeMondayClient, createFakeSupabaseClient } from "../../_shared/monday/__tests__/fakes.ts";
import type { MondaySyncConfig } from "../../_shared/monday/config.ts";

const BOARD_ID = "111222333";

function baseConfig(overrides: Partial<MondaySyncConfig> = {}): MondaySyncConfig {
  return {
    mondayApiToken: "fake-token",
    mondayApiUrl: "https://api.monday.com/v2",
    leadsBoardId: BOARD_ID,
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "fake-service-role-key",
    ...overrides,
  };
}

function postRequest(body: unknown, url = "https://example.functions.supabase.co/monday-webhook") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function logsFor(supabase: ReturnType<typeof createFakeSupabaseClient>) {
  return supabase.tables.monday_webhook_logs ?? [];
}

// --- 1. Challenge verification ---------------------------------------------

test("1. challenge verification: echoes the challenge, writes nothing, needs no config", async () => {
  const req = postRequest({ challenge: "random-value-123" });
  // No config/clients passed at all — should never be needed for a challenge.
  const res = await handleWebhookRequest(req, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { challenge: "random-value-123" });
});

// --- 2. create_item payload --------------------------------------------------

test("2. create_item: fetches the full item, transforms it, and creates one CRM lead", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {
    "555": buildMondayItem({
      id: "555",
      name: "Ana Beltran",
      board: { id: BOARD_ID },
      column_values: [{ id: "status", text: "New lead", value: null, column: { title: "Status" } }],
    }),
  } });

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555, userId: 1 } }),
    { config: baseConfig(), supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(supabase.tables.crm_leads.length, 1);
  assert.equal(supabase.tables.crm_leads[0].name, "Ana Beltran");
  assert.equal(supabase.tables.crm_leads[0].status, "New lead");

  const logs = logsFor(supabase);
  assert.ok(logs.some((l) => l.status === "received"));
  assert.ok(logs.some((l) => l.status === "processed"));
});

// --- 3. change_column_value payload ------------------------------------------

test("3. change_column_value: re-fetches the whole item and updates the existing lead (not just one field)", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayItem = buildMondayItem({
    id: "555",
    name: "Ana Beltran",
    board: { id: BOARD_ID },
    column_values: [{ id: "status", text: "New lead", value: null, column: { title: "Status" } }],
  });
  const mondayClient = createFakeMondayClient({ items: { "555": mondayItem } });
  const config = baseConfig();

  // Seed via create_item first.
  await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555 } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  // Now the item's status changes on Monday's side...
  mondayItem.column_values = [{ id: "status", text: "Contacted", value: null, column: { title: "Status" } }];

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "change_column_value", boardId: Number(BOARD_ID), pulseId: 555, columnId: "status" } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.equal(supabase.tables.crm_leads.length, 1, "must update the existing row, not create a second one");
  assert.equal(supabase.tables.crm_leads[0].status, "Contacted");
  assert.equal(supabase.tables.crm_leads[0].name, "Ana Beltran", "unrelated fields are preserved via full re-fetch");
});

// --- 4. change_name payload ---------------------------------------------------

test("4. change_name: re-fetches the item and updates the name, preserving other fields", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayItem = buildMondayItem({
    id: "555",
    name: "Ana Beltran",
    board: { id: BOARD_ID },
    column_values: [{ id: "status", text: "New lead", value: null, column: { title: "Status" } }],
  });
  const mondayClient = createFakeMondayClient({ items: { "555": mondayItem } });
  const config = baseConfig();

  await handleWebhookRequest(postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555 } }), {
    config,
    supabaseClient: supabase,
    mondayClient,
  });

  mondayItem.name = "Ana Beltrán"; // corrected spelling

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "change_name", boardId: Number(BOARD_ID), pulseId: 555 } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.equal(supabase.tables.crm_leads.length, 1);
  assert.equal(supabase.tables.crm_leads[0].name, "Ana Beltrán");
  assert.equal(supabase.tables.crm_leads[0].status, "New lead", "status is preserved");
});

// --- 5. item_archived payload -------------------------------------------------

test("5. item_archived: marks the lead archived, preserves the rest, never hard-deletes", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayItem = buildMondayItem({ id: "555", name: "Ana Beltran", board: { id: BOARD_ID }, column_values: [] });
  const mondayClient = createFakeMondayClient({ items: { "555": mondayItem } });
  const config = baseConfig();

  await handleWebhookRequest(postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555 } }), {
    config,
    supabaseClient: supabase,
    mondayClient,
  });

  const res = await handleWebhookRequest(
    postRequest({
      event: { type: "item_archived", boardId: Number(BOARD_ID), pulseId: 555, triggerTime: "2026-08-27T12:00:00Z" },
    }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.equal(supabase.tables.crm_leads.length, 1, "archiving never removes the row");
  assert.equal(supabase.tables.crm_leads[0].is_archived, true);
  assert.equal(supabase.tables.crm_leads[0].archived_at, "2026-08-27T12:00:00Z");
  assert.equal(supabase.tables.crm_leads[0].name, "Ana Beltran");
});

// --- 6. item_deleted payload --------------------------------------------------

test("6. item_deleted: soft-deletes the lead, never hard-deletes the row", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayItem = buildMondayItem({ id: "555", name: "Ana Beltran", board: { id: BOARD_ID }, column_values: [] });
  const mondayClient = createFakeMondayClient({ items: { "555": mondayItem } });
  const config = baseConfig();

  await handleWebhookRequest(postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555 } }), {
    config,
    supabaseClient: supabase,
    mondayClient,
  });

  const res = await handleWebhookRequest(
    postRequest({
      event: { type: "item_deleted", boardId: Number(BOARD_ID), pulseId: 555, triggerTime: "2026-08-27T12:30:00Z" },
    }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.equal(supabase.tables.crm_leads.length, 1, "soft-delete never removes the row");
  assert.equal(supabase.tables.crm_leads[0].is_deleted, true);
  assert.equal(supabase.tables.crm_leads[0].deleted_at, "2026-08-27T12:30:00Z");
});

// --- 7. Invalid board ID -------------------------------------------------------

test("7. invalid board id: not processed, logged, still a successful response", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {} });
  const config = baseConfig();

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: 999999999, pulseId: 1 } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, skipped: "wrong_board" });
  assert.equal((supabase.tables.crm_leads ?? []).length, 0);
  assert.equal(logsFor(supabase).at(-1)?.status, "skipped_wrong_board");
});

// --- 8. Duplicate event ---------------------------------------------------------

test("8. duplicate event: replaying the same event twice still results in exactly one lead", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {
    "555": buildMondayItem({ id: "555", name: "Ana Beltran", board: { id: BOARD_ID }, column_values: [] }),
  } });
  const config = baseConfig();
  const event = { event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555, eventId: "evt-dup-1" } };

  const res1 = await handleWebhookRequest(postRequest(event), { config, supabaseClient: supabase, mondayClient });
  const res2 = await handleWebhookRequest(postRequest(event), { config, supabaseClient: supabase, mondayClient });

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(supabase.tables.crm_leads.length, 1, "must not create a duplicate CRM lead");
});

// --- 9. Missing item ID -----------------------------------------------------

test("9. missing item id: not processed, logged as invalid, still a successful response", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {} });
  const config = baseConfig();

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID) /* no pulseId */ } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, skipped: "missing_item_id" });
  assert.equal((supabase.tables.crm_leads ?? []).length, 0);
  assert.equal(logsFor(supabase).at(-1)?.status, "skipped_invalid");
});

// --- 10. Monday API failure ----------------------------------------------------

test("10. Monday API failure: returns 500 (retryable), logs the error, creates no lead", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: { "555": "ERROR" } });
  const config = baseConfig();

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 555 } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 500);
  assert.equal((supabase.tables.crm_leads ?? []).length, 0);
  const lastLog = logsFor(supabase).at(-1);
  assert.equal(lastLog?.status, "error");
  assert.ok(lastLog?.error_message?.includes("simulated Monday API failure"));
});

// --- Extra coverage: unsupported event type, non-POST method, malformed JSON,
// shared-secret hardening --------------------------------------------------

test("unsupported event type is skipped without error", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {} });
  const config = baseConfig();

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "some_future_event", boardId: Number(BOARD_ID), pulseId: 1 } }),
    { config, supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, skipped: "unsupported_event_type" });
});

test("non-POST requests are rejected with 405", async () => {
  const req = new Request("https://example.functions.supabase.co/monday-webhook", { method: "GET" });
  const res = await handleWebhookRequest(req, {});
  assert.equal(res.status, 405);
});

test("malformed JSON body is accepted and dropped (never retried forever)", async () => {
  const req = new Request("https://example.functions.supabase.co/monday-webhook", {
    method: "POST",
    body: "{not valid json",
  });
  const res = await handleWebhookRequest(req, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, skipped: "invalid_json" });
});

test("optional shared-secret hardening rejects requests with a wrong/missing token", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ items: {} });
  const config = baseConfig({ webhookSharedSecret: "s3cr3t" });

  const noToken = await handleWebhookRequest(
    postRequest({ event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 1 } }),
    { config, supabaseClient: supabase, mondayClient },
  );
  assert.equal(noToken.status, 401);

  const wrongToken = await handleWebhookRequest(
    postRequest(
      { event: { type: "create_item", boardId: Number(BOARD_ID), pulseId: 1 } },
      "https://example.functions.supabase.co/monday-webhook?token=nope",
    ),
    { config, supabaseClient: supabase, mondayClient },
  );
  assert.equal(wrongToken.status, 401);
});

test("challenge verification bypasses the shared-secret check", async () => {
  const config = baseConfig({ webhookSharedSecret: "s3cr3t" });
  const res = await handleWebhookRequest(postRequest({ challenge: "abc" }), { config });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { challenge: "abc" });
});

// --- Multi-board routing: Deals stage move -> crm_deals ----------------------

test("deals board move_item_to_group re-syncs the deal into crm_deals with its new group, leaving crm_leads untouched", async () => {
  const DEALS_BOARD_ID = "222333444";
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({
    items: {
      "900": buildMondayItem({
        id: "900",
        name: "Acme LLC",
        board: { id: DEALS_BOARD_ID },
        group: { id: "signed_up", title: "Signed up" },
      }),
    },
  });

  const res = await handleWebhookRequest(
    postRequest({ event: { type: "move_item_to_group", boardId: Number(DEALS_BOARD_ID), pulseId: 900, userId: 1 } }),
    { config: baseConfig({ dealsBoardId: DEALS_BOARD_ID }), supabaseClient: supabase, mondayClient },
  );

  assert.equal(res.status, 200);
  assert.equal(supabase.tables.crm_deals?.length, 1);
  assert.equal(supabase.tables.crm_deals[0].monday_item_id, 900);
  assert.equal(supabase.tables.crm_deals[0].monday_group_title, "Signed up");
  assert.equal(supabase.tables.crm_leads?.length ?? 0, 0);
});
