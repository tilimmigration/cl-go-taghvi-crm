import { test } from "node:test";
import assert from "node:assert/strict";
import { runLeadImport } from "../import.ts";
import { runLinkedRecordImport } from "../linked-record-import.ts";
import { buildMondayBoardMeta, buildMondayItem, createFakeMondayClient, createFakeSupabaseClient } from "./fakes.ts";

const LEADS_BOARD_ID = "111222333";
const CALLS_BOARD_ID = "222333444";

function relatedLeadColumn(mondayItemId: number) {
  return {
    id: "link",
    text: "Ana",
    value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: mondayItemId }] }),
    type: "board_relation",
    column: { title: "Lead" },
  };
}

test("imports calls and resolves related_lead_id against an already-imported lead", async () => {
  const supabase = createFakeSupabaseClient();

  // Seed the lead first via the leads pipeline.
  const leadsClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: LEADS_BOARD_ID }),
    pages: [[buildMondayItem({ id: "1", name: "Ana", board: { id: LEADS_BOARD_ID } })]],
  });
  await runLeadImport({ mondayClient: leadsClient, supabase, boardId: LEADS_BOARD_ID });

  const callsClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID, boardName: "Call Log Tracker" }),
    pages: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID }, column_values: [relatedLeadColumn(1)] })]],
  });

  const summary = await runLinkedRecordImport({
    mondayClient: callsClient,
    supabase,
    table: "crm_calls",
    boardId: CALLS_BOARD_ID,
    leadsBoardId: LEADS_BOARD_ID,
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.createdCount, 1);
  assert.equal(supabase.tables.crm_calls.length, 1);
  assert.equal(supabase.tables.crm_calls[0].related_lead_id, supabase.tables.crm_leads[0].id);
  assert.equal(supabase.tables.monday_boards.find((b) => b.board_id === Number(CALLS_BOARD_ID))?.board_name, "Call Log Tracker");
});

test("importing a call before its lead still succeeds, with related_lead_id left null", async () => {
  const supabase = createFakeSupabaseClient();

  const callsClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID }),
    pages: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID }, column_values: [relatedLeadColumn(999)] })]],
  });

  const summary = await runLinkedRecordImport({
    mondayClient: callsClient,
    supabase,
    table: "crm_calls",
    boardId: CALLS_BOARD_ID,
    leadsBoardId: LEADS_BOARD_ID,
  });

  assert.equal(summary.status, "completed");
  assert.equal(supabase.tables.crm_calls[0].related_lead_id, null);
  assert.equal(supabase.tables.crm_calls[0].related_lead_monday_item_id, 999);
});

test("re-running a calls import is idempotent — no duplicates in crm_calls", async () => {
  const supabase = createFakeSupabaseClient();
  const callsClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID }),
    pages: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID } })]],
  });

  await runLinkedRecordImport({ mondayClient: callsClient, supabase, table: "crm_calls", boardId: CALLS_BOARD_ID, leadsBoardId: LEADS_BOARD_ID });
  const second = await runLinkedRecordImport({ mondayClient: callsClient, supabase, table: "crm_calls", boardId: CALLS_BOARD_ID, leadsBoardId: LEADS_BOARD_ID });

  assert.equal(second.createdCount, 0);
  assert.equal(second.updatedCount, 1);
  assert.equal(supabase.tables.crm_calls.length, 1);
});

test("crm_leads is untouched by a calls import — writes only ever go to crm_calls", async () => {
  const supabase = createFakeSupabaseClient();
  const callsClient = createFakeMondayClient({
    boardMeta: buildMondayBoardMeta({ boardId: CALLS_BOARD_ID }),
    pages: [[buildMondayItem({ id: "101", name: "Call with Ana", board: { id: CALLS_BOARD_ID } })]],
  });

  await runLinkedRecordImport({ mondayClient: callsClient, supabase, table: "crm_calls", boardId: CALLS_BOARD_ID, leadsBoardId: LEADS_BOARD_ID });

  assert.equal(supabase.tables.crm_leads?.length ?? 0, 0);
});
