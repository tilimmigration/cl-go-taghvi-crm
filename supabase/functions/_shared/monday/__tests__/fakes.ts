// Minimal in-memory fakes for testing the Monday sync pipeline under
// plain Node, without a real Supabase project or Monday.com API access.
// Only implements the subset of the supabase-js query builder that
// leads-repository.ts / webhook-logger.ts actually use.

import type { MondayClient } from "../client.ts";
import type { MondayItem } from "../types.ts";

type Row = Record<string, unknown>;

class FakeQueryBuilder {
  private op: "select" | "upsert" | "update" | "insert" = "select";
  private payload: Row | null = null;
  private onConflict: string[] = [];
  private filters: Array<[string, unknown]> = [];
  private wantSingle = false;
  private wantMaybeSingle = false;
  private rows: Row[];
  private nextId: () => string;

  constructor(rows: Row[], nextId: () => string) {
    this.rows = rows;
    this.nextId = nextId;
  }

  select(_cols?: string) {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
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
  then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.filters.every(([col, val]) => r[col] === val));
  }

  private async run(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === "select") {
      const matched = this.matched();
      if (this.wantSingle) {
        return matched.length ? { data: matched[0], error: null } : { data: null, error: { message: "no rows" } };
      }
      if (this.wantMaybeSingle) {
        return { data: matched[0] ?? null, error: null };
      }
      return { data: matched, error: null };
    }

    if (this.op === "insert") {
      const row = { id: this.nextId(), ...this.payload };
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
      const existing = conflictCols.length
        ? this.rows.find((r) => conflictCols.every((c) => r[c] === this.payload![c]))
        : undefined;

      let result: Row;
      if (existing) {
        Object.assign(existing, this.payload);
        result = existing;
      } else {
        result = { id: this.nextId(), ...this.payload };
        this.rows.push(result);
      }
      return { data: result, error: null };
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

/**
 * A fake Monday API client backed by an in-memory item map. Map a value of
 * `"ERROR"` to simulate a Monday API failure for that item id.
 */
export function createFakeMondayClient(items: Record<string, MondayItem | null | "ERROR">): MondayClient {
  return {
    async fetchItem(itemId: string) {
      const entry = items[itemId];
      if (entry === "ERROR") {
        throw new Error(`simulated Monday API failure fetching item ${itemId}`);
      }
      return entry ?? null;
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
