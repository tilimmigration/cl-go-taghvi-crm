import { test } from "node:test";
import assert from "node:assert/strict";
import { markLeadArchived, markLeadDeleted, upsertLead } from "../leads-repository.ts";
import { createFakeSupabaseClient } from "./fakes.ts";
import type { NormalizedLead } from "../types.ts";

function normalizedLead(overrides: Partial<NormalizedLead> = {}): NormalizedLead {
  return {
    mondayBoardId: "111222333",
    mondayItemId: "555",
    mondayGroupId: "topics",
    mondayGroupTitle: "New lead",
    name: "Ana Beltran",
    leadType: "Family",
    leadSource: "Meta — quiz",
    status: "New lead",
    ownerName: null,
    ownerMondayUserId: null,
    email: "ana@example.com",
    phone: null,
    company: null,
    customFields: {},
    rawColumnValues: [],
    mondayCreatedAt: "2026-08-01T00:00:00Z",
    mondayUpdatedAt: "2026-08-27T00:00:00Z",
    ...overrides,
  };
}

test("upsertLead creates a new row keyed on (board id, item id)", async () => {
  const supabase = createFakeSupabaseClient();
  const row = await upsertLead(supabase, normalizedLead(), "create_item");

  assert.equal(row.monday_board_id, 111222333);
  assert.equal(row.monday_item_id, 555);
  assert.equal(row.name, "Ana Beltran");
  assert.equal(supabase.tables.crm_leads.length, 1);
});

test("upsertLead is idempotent: same (board id, item id) always resolves to one row", async () => {
  const supabase = createFakeSupabaseClient();

  await upsertLead(supabase, normalizedLead({ status: "New lead" }), "create_item");
  await upsertLead(supabase, normalizedLead({ status: "Contacted" }), "change_column_value");
  await upsertLead(supabase, normalizedLead({ status: "Contacted" }), "change_column_value"); // exact duplicate delivery

  assert.equal(supabase.tables.crm_leads.length, 1);
  assert.equal(supabase.tables.crm_leads[0].status, "Contacted");
});

test("upsertLead for a different item id creates a second, independent row", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLead(supabase, normalizedLead({ mondayItemId: "555" }), "create_item");
  await upsertLead(supabase, normalizedLead({ mondayItemId: "556" }), "create_item");
  assert.equal(supabase.tables.crm_leads.length, 2);
});

test("markLeadArchived creates a stub row when the lead isn't known yet", async () => {
  const supabase = createFakeSupabaseClient();
  await markLeadArchived(supabase, "111222333", "999", "2026-08-27T12:00:00Z");

  assert.equal(supabase.tables.crm_leads.length, 1);
  const row = supabase.tables.crm_leads[0];
  assert.equal(row.monday_item_id, 999);
  assert.equal(row.is_archived, true);
  assert.equal(row.archived_at, "2026-08-27T12:00:00Z");
});

test("markLeadArchived preserves existing fields on a known lead", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLead(supabase, normalizedLead(), "create_item");
  await markLeadArchived(supabase, "111222333", "555", "2026-08-27T12:00:00Z");

  assert.equal(supabase.tables.crm_leads.length, 1);
  const row = supabase.tables.crm_leads[0];
  assert.equal(row.name, "Ana Beltran"); // preserved
  assert.equal(row.is_archived, true);
  assert.equal(row.archived_at, "2026-08-27T12:00:00Z");
});

test("markLeadDeleted soft-deletes without removing the row", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertLead(supabase, normalizedLead(), "create_item");
  await markLeadDeleted(supabase, "111222333", "555", "2026-08-27T12:00:00Z");

  assert.equal(supabase.tables.crm_leads.length, 1); // still present
  const row = supabase.tables.crm_leads[0];
  assert.equal(row.is_deleted, true);
  assert.equal(row.deleted_at, "2026-08-27T12:00:00Z");
  assert.equal(row.name, "Ana Beltran"); // preserved
});
