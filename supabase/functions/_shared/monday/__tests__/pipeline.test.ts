import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveItem, BoardMismatchError, deleteItem, ItemNotFoundError, syncItemFromMonday } from "../pipeline.ts";
import { buildMondayItem, createFakeMondayClient, createFakeSupabaseClient } from "./fakes.ts";

test("syncItemFromMonday fetches, transforms and upserts the full item", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({
    "555": buildMondayItem({
      id: "555",
      name: "Ana Beltran",
      board: { id: "111222333" },
      column_values: [{ id: "status", text: "New lead", value: null, column: { title: "Status" } }],
    }),
  });

  const row = await syncItemFromMonday({ mondayClient, supabase }, "111222333", "555", "create_item");

  assert.equal(row.name, "Ana Beltran");
  assert.equal(row.status, "New lead");
  assert.equal(supabase.tables.crm_leads.length, 1);
});

test("syncItemFromMonday throws ItemNotFoundError when the item can't be fetched", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ "555": null });

  await assert.rejects(
    () => syncItemFromMonday({ mondayClient, supabase }, "111222333", "555", "create_item"),
    ItemNotFoundError,
  );
  assert.equal(supabase.tables.crm_leads?.length ?? 0, 0);
});

test("syncItemFromMonday throws BoardMismatchError when the fetched item belongs to a different board", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({
    "555": buildMondayItem({ id: "555", name: "Wrong board item", board: { id: "999888777" } }),
  });

  await assert.rejects(
    () => syncItemFromMonday({ mondayClient, supabase }, "111222333", "555", "create_item"),
    BoardMismatchError,
  );
  assert.equal(supabase.tables.crm_leads?.length ?? 0, 0);
});

test("syncItemFromMonday propagates Monday API failures", async () => {
  const supabase = createFakeSupabaseClient();
  const mondayClient = createFakeMondayClient({ "555": "ERROR" });

  await assert.rejects(() => syncItemFromMonday({ mondayClient, supabase }, "111222333", "555", "create_item"));
});

test("archiveItem and deleteItem delegate to the leads repository", async () => {
  const supabase = createFakeSupabaseClient();
  await archiveItem(supabase, "111222333", "700", "2026-08-27T00:00:00Z");
  await deleteItem(supabase, "111222333", "701", "2026-08-27T00:00:00Z");

  assert.equal(supabase.tables.crm_leads.length, 2);
  assert.equal(supabase.tables.crm_leads.find((r) => r.monday_item_id === 700)?.is_archived, true);
  assert.equal(supabase.tables.crm_leads.find((r) => r.monday_item_id === 701)?.is_deleted, true);
});
