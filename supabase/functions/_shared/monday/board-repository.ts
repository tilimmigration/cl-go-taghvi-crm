// Supabase-side persistence for Monday board/column metadata
// (public.monday_boards, public.monday_board_columns). Written once per
// import run, before any leads are processed — never read by the
// frontend in this phase.

import type { MondayBoardMeta } from "./types.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

/** Upserts the board's own identity, keyed on the Monday board id. */
export async function upsertMondayBoard(supabase: SupabaseClientLike, meta: MondayBoardMeta) {
  const { error } = await supabase.from("monday_boards").upsert(
    {
      board_id: Number(meta.boardId),
      board_name: meta.boardName,
      workspace_id: meta.workspaceId,
      workspace_name: meta.workspaceName,
    },
    { onConflict: "board_id" },
  );
  if (error) throw error;
}

/**
 * Upserts every column definition for a board, keyed on
 * (board_id, monday_column_id). Column ids are the stable identifier —
 * titles are stored for display only and may change on the Monday side
 * without breaking mapping logic that keys off the id.
 */
export async function upsertMondayBoardColumns(supabase: SupabaseClientLike, meta: MondayBoardMeta) {
  if (meta.columns.length === 0) return;

  const rows = meta.columns.map((col) => ({
    board_id: Number(meta.boardId),
    monday_column_id: col.id,
    column_title: col.title,
    column_type: col.type,
    column_description: col.description,
    column_settings: safeParseSettings(col.settings_str),
    archived: col.archived,
  }));

  const { error } = await supabase.from("monday_board_columns").upsert(rows, { onConflict: "board_id,monday_column_id" });
  if (error) throw error;
}

function safeParseSettings(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
