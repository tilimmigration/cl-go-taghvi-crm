// Minimal in-memory fakes for testing the Monday sync pipeline under
// plain Node, without a real Supabase project or Monday.com API access.
// Only implements the subset of the supabase-js query builder that
// leads-repository.ts / webhook-logger.ts / board-repository.ts /
// import-runs-repository.ts actually use.

import type { MondayClient } from "../client.ts";
import type { MondayBoardMeta, MondayItem, MondayItemsPage } from "../types.ts";

type Row = Record<string, unknown>;

class FakeQueryBuilder {
  private op: "select" | "upsert" | "update" | "insert" = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string[] = [];
  private filters: Array<[string, unknown]> = [];
  private wantSingle = false;
  private wantMaybeSingle = false;
  private wantCount = false;
  private wantHeadOnly = false;
  private rows: Row[];
  private nextId: () => string;

  constructor(rows: Row[], nextId: () => string) {
    this.rows = rows;
    this.nextId = nextId;
  }

  select(_cols?: string, opts?: { count?: "exact"; head?: boolean }) {
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.wantHeadOnly = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  upsert(row: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = opts?.onConflict ? opts.onConflict.split(",") : [];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantMaybeSingle = true;
    return this;
  }

  // Makes the builder awaitable, matching supabase-js's thenable query
  // builders (`await supabase.from(x).upsert(...)` works without an
  // explicit `.then()` call at the site).
  then(onFulfilled: (v: { data: unknown; error: unknown; count?: number }) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.filters.every(([col, val]) => r[col] === val));
  }

  private async run(): Promise<{ data: unknown; error: unknown; count?: number }> {
    if (this.op === "select") {
      const matched = this.matched();
      if (this.wantCount) {
        return { data: this.wantHeadOnly ? null : matched, error: null, count: matched.length };
      }
      if (this.wantSingle) {
        return matched.length ? { data: matched[0], error: null } : { data: null, error: { message: "no rows" } };
      }
      if (this.wantMaybeSingle) {
        return { data: matched[0] ?? null, error: null };
      }
      return { data: matched, error: null };
    }

    if (this.op === "insert") {
      const row = { id: this.nextId(), ...(this.payload as Row) };
      this.rows.push(row);
      return { data: row, error: null };
    }

    if (this.op === "update") {
      const matched = this.matched();
      matched.forEach((r) => Object.assign(r, this.payload));
      if (this.wantSingle) {
        return matched.length ? { data: matched[0], error: null } : { data: null, error: { message: "no rows" } };
      }
      return { data: matched, error: null };
    }

    if (this.op === "upsert") {
      const conflictCols = this.onConflict;
      const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const results: Row[] = [];

      for (const payload of payloadRows) {
        const existing = conflictCols.length
          ? this.rows.find((r) => conflictCols.every((c) => r[c] === payload[c]))
          : undefined;

        if (existing) {
          Object.assign(existing, payload);
          results.push(existing);
        } else {
          const row = { id: this.nextId(), ...payload };
          this.rows.push(row);
          results.push(row);
        }
      }

      return { data: Array.isArray(this.payload) ? results : results[0], error: null };
    }

    return { data: null, error: { message: "unsupported fake op" } };
  }
}

export interface FakeSupabaseClient {
  from(table: string): FakeQueryBuilder;
  tables: Record<string, Row[]>;
}

export function createFakeSupabaseClient(): FakeSupabaseClient {
  const tables: Record<string, Row[]> = {};
  let idCounter = 1;
  const nextId = () => `fake-${idCounter++}`;

  return {
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return new FakeQueryBuilder(tables[table], nextId);
    },
    tables,
  };
}

export interface FakeMondayClientConfig {
  /** Backs fetchItem() — used by the webhook pipeline, not the bulk importer. */
  items?: Record<string, MondayItem | null | "ERROR">;
  /** Backs fetchBoardMetadata(). "ERROR" simulates a Monday API failure. */
  boardMeta?: MondayBoardMeta | "ERROR";
  /** Backs fetchAllBoardItems() — each sub-array is one page's items, in order. */
  pages?: MondayItem[][];
}

/**
 * A fake Monday API client. Map an items[] entry to `"ERROR"` to simulate
 * a single-item fetch failure, or boardMeta to `"ERROR"` to simulate a
 * board-metadata fetch failure.
 */
export function createFakeMondayClient(config: FakeMondayClientConfig): MondayClient {
  const items = config.items ?? {};

  return {
    async fetchItem(itemId: string) {
      const entry = items[itemId];
      if (entry === "ERROR") {
        throw new Error(`simulated Monday API failure fetching item ${itemId}`);
      }
      return entry ?? null;
    },

    async fetchBoardMetadata(boardId: string): Promise<MondayBoardMeta> {
      if (config.boardMeta === "ERROR") {
        throw new Error(`simulated Monday API failure fetching board ${boardId}`);
      }
      if (!config.boardMeta) {
        throw new Error("fake Monday client: boardMeta not configured for this test");
      }
      return config.boardMeta;
    },

    async fetchAllBoardItems(
      _boardId: string,
      opts: { pageSize?: number; onPage: (page: MondayItemsPage, pageNumber: number) => Promise<void> | void },
    ) {
      const pages = config.pages ?? [];
      let totalItems = 0;

      for (let i = 0; i < pages.length; i++) {
        const cursor = i < pages.length - 1 ? `fake-cursor-${i + 1}` : null;
        totalItems += pages[i].length;
        await opts.onPage({ items: pages[i], cursor }, i + 1);
      }

      return { totalItems, totalPages: pages.length };
    },
  };
}

export function buildMondayItem(overrides: Partial<MondayItem> & { id: string; name: string }): MondayItem {
  return {
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
    state: "active",
    group: { id: "topics", title: "New lead" },
    board: { id: overrides.board?.id ?? "111222333" },
    column_values: [],
    ...overrides,
  };
}

export function buildMondayBoardMeta(overrides: Partial<MondayBoardMeta> & { boardId: string }): MondayBoardMeta {
  return {
    boardName: "Lead Tracker",
    workspaceId: "555",
    workspaceName: "The Hub",
    columns: [],
    ...overrides,
  };
}
