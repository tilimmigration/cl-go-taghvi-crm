import { test } from "node:test";
import assert from "node:assert/strict";
import { handleImportRequest } from "../index.ts";
import { buildMondayBoardMeta, buildMondayItem, createFakeMondayClient, createFakeSupabaseClient } from "../../_shared/monday/__tests__/fakes.ts";
import type { MondaySyncConfig } from "../../_shared/monday/config.ts";

const BOARD_ID = "111222333";
const SERVICE_ROLE_KEY = "fake-service-role-key";

function baseConfig(overrides: Partial<MondaySyncConfig> = {}): MondaySyncConfig {
  return {
    mondayApiToken: "fake-token",
    mondayApiUrl: "https://api.monday.com/v2",
    leadsBoardId: BOARD_ID,
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: SERVICE_ROLE_KEY,
    ...overrides,
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.functions.supabase.co/monday-import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("rejects requests without the service_role key", async () => {
  const res = await handleImportRequest(postRequest({}), { config: baseConfig() });
  assert.equal(res.status, 401);
});

test("rejects requests bearing the anon key instead of the service role key", async () => {
  const res = await handleImportRequest(postRequest({}, { Authorization: "Bearer anon-key-here" }), { config: baseConfig() });
  assert.equal(res.status, 401);
});

test("rejects non-POST requests", async () => {
  const req = new Request("https://example.functions.supabase.co/monday-import", { method: "GET" });
  const res = await handleImportRequest(req, { config: baseConfig() });
  assert.equal(res.status, 405);
});

test("runs the import end-to-end and returns the summary for an authorized request", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: BOARD_ID, boardName: "Lead Tracker", workspaceName: "The Hub" }),
    pages: [[buildMondayItem({ id: "1", name: "Ana", board: { id: BOARD_ID } })]],
  });

  const res = await handleImportRequest(postRequest({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig(),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.leads.status, "completed");
  assert.equal(body.leads.createdCount, 1);
  assert.equal(body.leads.mondayTotal, 1);
  assert.equal(body.leads.crmTotal, 1);
  assert.equal(body.leads.boardName, "Lead Tracker");
  assert.equal(body.calls, null, "calls board not configured — should be omitted, not attempted");
  assert.equal(body.deals, null, "deals board not configured — should be omitted, not attempted");
});

test("a fatal import failure returns 500 with the run id, in the errors array", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ boardMeta: "ERROR", pages: [] });

  const res = await handleImportRequest(postRequest({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig(),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.leads, null);
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].board, "leads");
  assert.ok(body.errors[0].importRunId);
  assert.ok(body.errors[0].error);
});

test("imports leads, calls and deals together when all three boards are configured", async () => {
  const CALLS_BOARD_ID = "222333444";
  const DEALS_BOARD_ID = "333444555";
  const supabase = createFakeSupabaseClient();

  const relatedLeadColumn = { id: "link", text: "Ana", value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: 1 }] }), type: "board_relation", column: { title: "Lead" } };

  const mondayClient = createFakeMondayClient({
    boardMetaByBoardId: {
      [BOARD_ID]: buildMondayBoardMeta({ boardId: BOARD_ID, boardName: "Lead Tracker" }),
      [CALLS_BOARD_ID]: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID, boardName: "Call Log Tracker" }),
      [DEALS_BOARD_ID]: buildMondayBoardMeta({ boardId: DEALS_BOARD_ID, boardName: "Deals" }),
    },
    pagesByBoardId: {
      [BOARD_ID]: [[buildMondayItem({ id: "1", name: "Ana", board: { id: BOARD_ID } })]],
      [CALLS_BOARD_ID]: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID }, column_values: [relatedLeadColumn] })]],
      [DEALS_BOARD_ID]: [[buildMondayItem({ id: "201", name: "Ana — Family case", board: { id: DEALS_BOARD_ID }, column_values: [relatedLeadColumn] })]],
    },
  });

  const res = await handleImportRequest(postRequest({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig({ callsBoardId: CALLS_BOARD_ID, dealsBoardId: DEALS_BOARD_ID }),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.leads.createdCount, 1);
  assert.equal(body.calls.createdCount, 1);
  assert.equal(body.deals.createdCount, 1);

  assert.equal(supabase.tables.crm_leads.length, 1);
  assert.equal(supabase.tables.crm_calls.length, 1);
  assert.equal(supabase.tables.crm_deals.length, 1);
  assert.equal(supabase.tables.crm_calls[0].related_lead_id, supabase.tables.crm_leads[0].id, "the call resolves its related_lead_id against the imported lead");
  assert.equal(supabase.tables.crm_deals[0].related_lead_id, supabase.tables.crm_leads[0].id);
});

test("accepts an optional pageSize override in the request body", async () => {
  const supabase = createFakeSupabaseClient();
  let capturedPageSize: number | undefined;
  const mondayClient = {
    ...createFakeMondayClient({ boardMeta: buildMondayBoardMeta({ boardId: BOARD_ID }), pages: [] }),
    fetchAllBoardItems: async (
      _boardId: string,
      opts: { pageSize?: number; onPage: (page: { items: []; cursor: null }, n: number) => void },
    ) => {
      capturedPageSize = opts.pageSize;
      return { totalItems: 0, totalPages: 0 };
    },
  };

  await handleImportRequest(postRequest({ pageSize: 250 }, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig(),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(capturedPageSize, 250);
});

test("an optional `boards` filter runs only the listed boards, skipping the rest entirely", async () => {
  const CALLS_BOARD_ID = "222333444";
  const DEALS_BOARD_ID = "333444555";
  const supabase = createFakeSupabaseClient();

  const mondayClient = createFakeMondayClient({
    boardMetaByBoardId: {
      [BOARD_ID]: buildMondayBoardMeta({ boardId: BOARD_ID, boardName: "Lead Tracker" }),
      [CALLS_BOARD_ID]: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID, boardName: "Call Log Tracker" }),
      [DEALS_BOARD_ID]: buildMondayBoardMeta({ boardId: DEALS_BOARD_ID, boardName: "Deals" }),
    },
    pagesByBoardId: {
      [BOARD_ID]: [[buildMondayItem({ id: "1", name: "Ana", board: { id: BOARD_ID } })]],
      [CALLS_BOARD_ID]: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID } })]],
      [DEALS_BOARD_ID]: [[buildMondayItem({ id: "201", name: "Ana — Family case", board: { id: DEALS_BOARD_ID } })]],
    },
  });

  const res = await handleImportRequest(postRequest({ boards: ["deals"] }, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig({ callsBoardId: CALLS_BOARD_ID, dealsBoardId: DEALS_BOARD_ID }),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.leads, null, "leads not requested — should be skipped, not attempted");
  assert.equal(body.calls, null, "calls not requested — should be skipped, not attempted");
  assert.equal(body.deals.createdCount, 1);

  assert.ok(!supabase.tables.crm_leads, "leads board was never even queried");
  assert.ok(!supabase.tables.crm_calls, "calls board was never even queried");
  assert.equal(supabase.tables.crm_deals.length, 1);
});

test("works with an empty/missing request body (pageSize falls back to the client default)", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ boardMeta: buildMondayBoardMeta({ boardId: BOARD_ID }), pages: [] });

  const req = new Request("https://example.functions.supabase.co/monday-import", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });

  const res = await handleImportRequest(req, { config: baseConfig(), supabaseClient: supabase, mondayClient });
  assert.equal(res.status, 200);
});
