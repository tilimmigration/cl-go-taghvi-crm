// Server-side Monday.com API client. The API token never leaves the
// server — this module is only ever imported by Edge Function code, never
// bundled into the frontend.

import type { MondayItem } from "./types.ts";

export class MondayApiError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

const ITEM_QUERY = `
  query GetItem($itemId: [ID!]) {
    items(ids: $itemId) {
      id
      name
      created_at
      updated_at
      state
      group {
        id
        title
      }
      board {
        id
      }
      column_values {
        id
        text
        value
        type
        column {
          title
        }
      }
    }
  }
`;

export interface MondayClient {
  /**
   * Fetches the current, authoritative state of a single item from
   * Monday. Returns null if the item doesn't exist (or isn't visible to
   * the API token) — callers must not assume this always returns a value.
   */
  fetchItem(itemId: string): Promise<MondayItem | null>;
}

export function createMondayClient(opts: { apiToken: string; apiUrl: string }): MondayClient {
  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(opts.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never log this header — see webhook-logger.ts, which only ever
        // receives board/item/event ids, not request headers or bodies.
        Authorization: opts.apiToken,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new MondayApiError(`Monday API request failed with HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new MondayApiError("Monday API returned GraphQL errors", json.errors);
    }
    return json.data as T;
  }

  return {
    async fetchItem(itemId: string): Promise<MondayItem | null> {
      const data = await graphql<{ items: MondayItem[] }>(ITEM_QUERY, { itemId: [itemId] });
      const item = data?.items?.[0];
      return item ?? null;
    },
  };
}
