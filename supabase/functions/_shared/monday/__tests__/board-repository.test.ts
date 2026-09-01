import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertMondayBoard, upsertMondayBoardColumns } from "../board-repository.ts";
import { createFakeSupabaseClient, buildMondayBoardMeta } from "./fakes.ts";

test("upsertMondayBoard creates a row keyed on board_id", async () => {
  const supabase = createFakeSupabaseClient();
  const meta = buildMondayBoardMeta({ boardId: "111222333" });

  await upsertMondayBoard(supabase, meta);

  assert.equal(supabase.tables.monday_boards.length, 1);
  assert.equal(supabase.tables.monday_boards[0].board_id, 111222333);
  assert.equal(supabase.tables.monday_boards[0].board_name, "Lead Tracker");
  assert.equal(supabase.tables.monday_boards[0].workspace_name, "The Hub");
});

test("upsertMondayBoard is idempotent — re-running updates, not duplicates", async () => {
  const supabase = createFakeSupabaseClient();
  await upsertMondayBoard(supabase, buildMondayBoardMeta({ boardId: "111222333", boardName: "Lead Tracker" }));
  await upsertMondayBoard(supabase, buildMondayBoardMeta({ boardId: "111222333", boardName: "Lead Tracker (renamed)" }));

  assert.equal(supabase.tables.monday_boards.length, 1);
  assert.equal(supabase.tables.monday_boards[0].board_name, "Lead Tracker (renamed)");
});

test("upsertMondayBoardColumns stores every column, keyed on (board_id, monday_column_id)", async () => {
  const supabase = createFakeSupabaseClient();
  const meta = buildMondayBoardMeta({
    boardId: "111222333",
    columns: [
      { id: "status", title: "Status", type: "status", description: null, settings_str: '{"labels":{"0":"New"}}', archived: false },
      { id: "email_1", title: "Email", type: "email", description: "Primary contact email", settings_str: null, archived: false },
      { id: "old_col", title: "Deprecated", type: "text", description: null, settings_str: null, archived: true },
    ],
  });

  await upsertMondayBoardColumns(supabase, meta);

  assert.equal(supabase.tables.monday_board_columns.length, 3);
  const status = supabase.tables.monday_board_columns.find((c) => c.monday_column_id === "status");
  assert.deepEqual(status?.column_settings, { labels: { "0": "New" } });
  const archived = supabase.tables.monday_board_columns.find((c) => c.monday_column_id === "old_col");
  assert.equal(archived?.archived, true);
});

test("upsertMondayBoardColumns re-run updates existing columns rather than duplicating", async () => {
  const supabase = createFakeSupabaseClient();
  const meta = buildMondayBoardMeta({
    boardId: "111222333",
    columns: [{ id: "status", title: "Status", type: "status", description: null, settings_str: null, archived: false }],
  });

  await upsertMondayBoardColumns(supabase, meta);
  await upsertMondayBoardColumns(supabase, { ...meta, columns: [{ ...meta.columns[0], title: "Lead Status" }] });

  assert.equal(supabase.tables.monday_board_columns.length, 1);
  assert.equal(supabase.tables.monday_board_columns[0].column_title, "Lead Status");
});
