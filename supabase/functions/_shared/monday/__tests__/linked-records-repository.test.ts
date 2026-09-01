import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertLead } from "../leads-repository.ts";
import { countActiveLinkedRecordsForBoard, fetchExistingLinkedRecordItemIds, upsertLinkedRecord } from "../linked-records-repository.ts";
import { createFakeSupabaseClient } from "./fakes.ts";
import type { NormalizedLead } from "../types.ts";

const LEADS_BOARD_ID = "111222333";
const CALLS_BOARD_ID = "222333444";

function normalizedRecord(overrides: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    mondayBoardId: CALLS_BOARD_ID,
    mondayItemId: "101",
    mondayGroupId: null,
    mondayGroupTitle: null,
    name: "Call with Ana",
    firstName: null,
    lastName: null,
    leadType: null,
    leadSource: null,
    status: "Completed",
    stage: null,
    ownerName: "Soulmaz",
    ownerMondayUserId: null,
    email: null,
    phone: null,
    company: null,
    website: null,
    address: null,
    city: null,
    state: null,
    country: null,
    industry: null,
    notes: null,
    customFields: {},
    rawColumnValues: [],
    mondayCreatedAt: null,
    mondayUpdatedAt: null,
    ...overrides,
  };
}

async function seedLead(supabase: ReturnType<typeof createFakeSupabaseClient>, mondayItemId: string) {
  return upsertLead(
    supabase,
    normalizedRecord({ mondayBoardId: LEADS_BOARD_ID, mondayItemId, name: "Ana Beltran" }),
    "initial_import",
  );
}

test("upsertLinkedRecord resolves related_lead_id when the lead already exists", async () => {
  const supabase = createFakeSupabaseClient();
  const lead = await seedLead(supabase, "1");

  const row = await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord(), {
    relatedLeadMondayItemId: "1",
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  assert.equal(row.related_lead_id, lead.id);
  assert.equal(row.related_lead_monday_item_id, 1);
});

test("upsertLinkedRecord leaves related_lead_id null when the lead hasn't been imported yet", async () => {
  const supabase = createFakeSupabaseClient();

  const row = await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord(), {
    relatedLeadMondayItemId: "999",
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  assert.equal(row.related_lead_id, null);
  assert.equal(row.related_lead_monday_item_id, 999, "the raw external reference is preserved even when unresolved");
});

test("upsertLinkedRecord with no related lead column leaves both related fields null", async () => {
  const supabase = createFakeSupabaseClient();

  const row = await upsertLinkedRecord(supabase, "crm_deals", normalizedRecord(), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  assert.equal(row.related_lead_id, null);
  assert.equal(row.related_lead_monday_item_id, null);
});

test("upsertLinkedRecord is idempotent per table, keyed on (board id, item id)", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord({ status: "Scheduled" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });
  await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord({ status: "Completed" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  assert.equal(supabase.tables.crm_calls.length, 1);
  assert.equal(supabase.tables.crm_calls[0].status, "Completed");
});

test("crm_calls and crm_deals are independent tables — same monday_item_id in each doesn't collide", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord({ mondayItemId: "500" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });
  await upsertLinkedRecord(supabase, "crm_deals", normalizedRecord({ mondayBoardId: "333444555", mondayItemId: "500" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  assert.equal(supabase.tables.crm_calls.length, 1);
  assert.equal(supabase.tables.crm_deals.length, 1);
});

test("fetchExistingLinkedRecordItemIds and countActiveLinkedRecordsForBoard scope to (table, board)", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord({ mondayItemId: "1" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });
  await upsertLinkedRecord(supabase, "crm_calls", normalizedRecord({ mondayItemId: "2" }), {
    relatedLeadMondayItemId: null,
    leadsBoardId: LEADS_BOARD_ID,
    eventType: "initial_import",
  });

  const ids = await fetchExistingLinkedRecordItemIds(supabase, "crm_calls", CALLS_BOARD_ID);
  assert.deepEqual([...ids].sort(), [1, 2]);

  const count = await countActiveLinkedRecordsForBoard(supabase, "crm_calls", CALLS_BOARD_ID);
  assert.equal(count, 2);
});
