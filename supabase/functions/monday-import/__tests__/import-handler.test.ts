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
  assert.equal(body.status, "completed");
  assert.equal(body.createdCount, 1);
  assert.equal(body.mondayTotal, 1);
  assert.equal(body.crmTotal, 1);
  assert.equal(body.boardName, "Lead Tracker");
});

test("a fatal import failure returns 500 with the run id", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ boardMeta: "ERROR", pages: [] });

  const res = await handleImportRequest(postRequest({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }), {
    config: baseConfig(),
    supabaseClient: supabase,
    mondayClient,
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.importRunId);
  assert.ok(body.error);
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
