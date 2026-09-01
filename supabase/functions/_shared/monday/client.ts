// Server-side Monday.com API client. The API token never leaves the
// server — this module is only ever imported by Edge Function code, never
// bundled into the frontend.

import type { MondayBoardMeta, MondayItem, MondayItemsPage } from "./types.ts";

export class MondayApiError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

/** Thrown after exhausting retries on a rate-limited/transient request. */
export class MondayRateLimitError extends MondayApiError {}

const ITEM_COLUMN_FIELDS = `
  id
  text
  value
  type
  column {
    title
  }
`;

const ITEM_FIELDS = `
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
    ${ITEM_COLUMN_FIELDS}
  }
`;

const ITEM_QUERY = `
  query GetItem($itemId: [ID!]) {
    items(ids: $itemId) {
      ${ITEM_FIELDS}
    }
  }
`;

const BOARD_METADATA_QUERY = `
  query GetBoardMetadata($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      workspace {
        id
        name
      }
      columns {
        id
        title
        type
        description
        settings_str
        archived
      }
    }
  }
`;

const FIRST_ITEMS_PAGE_QUERY = `
  query GetFirstItemsPage($boardId: [ID!], $limit: Int!) {
    boards(ids: $boardId) {
      items_page(limit: $limit) {
        cursor
        items {
          ${ITEM_FIELDS}
        }
      }
    }
  }
`;

const NEXT_ITEMS_PAGE_QUERY = `
  query GetNextItemsPage($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        ${ITEM_FIELDS}
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

  /** Board identity, workspace, and every column defined on the board. */
  fetchBoardMetadata(boardId: string): Promise<MondayBoardMeta>;

  /**
   * Fetches ALL items on a board (every group — Monday's items_page is
   * board-wide, not scoped to one group) via cursor pagination, invoking
   * onPage for each page as it arrives rather than buffering everything
   * in memory. Continues until Monday returns a null cursor. Returns the
   * total number of items seen and the number of pages processed.
   */
  fetchAllBoardItems(
    boardId: string,
    opts: { pageSize?: number; onPage: (page: MondayItemsPage, pageNumber: number) => Promise<void> | void },
  ): Promise<{ totalItems: number; totalPages: number }>;
}

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30_000 };

function isRateLimitShaped(status: number, body: unknown): boolean {
  if (status === 429) return true;
  const text = JSON.stringify(body ?? "").toLowerCase();
  return text.includes("complexity") || text.includes("rate limit") || text.includes("rate_limited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMondayClient(opts: { apiToken: string; apiUrl: string; retry?: Partial<RetryOptions> }): MondayClient {
  const retryOpts: RetryOptions = { ...DEFAULT_RETRY, ...opts.retry };

  async function graphqlOnce<T>(query: string, variables: Record<string, unknown>): Promise<{ data?: T; status: number; body: unknown }> {
    const res = await fetch(opts.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never log this header — see webhook-logger.ts / import-runs-repository.ts,
        // which only ever receive board/item/event ids, not request headers or bodies.
        Authorization: opts.apiToken,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => null);
    return { data: body?.data as T | undefined, status: res.status, body };
  }

  /**
   * Runs one GraphQL request, retrying with exponential backoff on
   * rate-limit-shaped responses (HTTP 429, or a complexity/rate-limit
   * error in the GraphQL errors array) and on transient 5xx/network
   * failures. Bounded — never retries forever. Non-transient errors
   * (bad query, auth failure, 4xx other than 429) fail immediately.
   */
  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retryOpts.maxAttempts; attempt++) {
      let result: { data?: T; status: number; body: unknown } | undefined;
      try {
        result = await graphqlOnce<T>(query, variables);
      } catch (err) {
        lastError = err;
        if (attempt === retryOpts.maxAttempts) break;
        await sleep(Math.min(retryOpts.baseDelayMs * 2 ** (attempt - 1), retryOpts.maxDelayMs));
        continue;
      }

      const { data, status, body } = result;
      const errors = (body as { errors?: unknown[] } | null)?.errors;

      if (status >= 200 && status < 300 && !errors) {
        return data as T;
      }

      const rateLimited = isRateLimitShaped(status, body);
      const transient = status >= 500;

      if ((rateLimited || transient) && attempt < retryOpts.maxAttempts) {
        await sleep(Math.min(retryOpts.baseDelayMs * 2 ** (attempt - 1), retryOpts.maxDelayMs));
        continue;
      }

      if (rateLimited) {
        throw new MondayRateLimitError(`Monday API rate limit exceeded after ${attempt} attempt(s)`, body);
      }
      throw new MondayApiError(`Monday API request failed (HTTP ${status})`, errors ?? body);
    }

    throw lastError instanceof Error ? lastError : new MondayApiError("Monday API request failed after retries", lastError);
  }

  return {
    async fetchItem(itemId: string): Promise<MondayItem | null> {
      const data = await graphql<{ items: MondayItem[] }>(ITEM_QUERY, { itemId: [itemId] });
      const item = data?.items?.[0];
      return item ?? null;
    },

    async fetchBoardMetadata(boardId: string): Promise<MondayBoardMeta> {
      const data = await graphql<{
        boards: Array<{
          id: string;
          name: string | null;
          workspace: { id: string; name: string } | null;
          columns: Array<{ id: string; title: string | null; type: string | null; description: string | null; settings_str: string | null; archived: boolean }>;
        }>;
      }>(BOARD_METADATA_QUERY, { boardId: [boardId] });

      const board = data?.boards?.[0];
      if (!board) {
        throw new MondayApiError(`Monday board ${boardId} was not found or is not accessible with this API token`);
      }

      return {
        boardId: board.id,
        boardName: board.name,
        workspaceId: board.workspace?.id ?? null,
        workspaceName: board.workspace?.name ?? null,
        columns: board.columns.map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          description: c.description,
          settings_str: c.settings_str,
          archived: c.archived,
        })),
      };
    },

    async fetchAllBoardItems(boardId, { pageSize = 100, onPage }) {
      let totalItems = 0;
      let totalPages = 0;

      const first = await graphql<{ boards: Array<{ items_page: { cursor: string | null; items: MondayItem[] } }> }>(
        FIRST_ITEMS_PAGE_QUERY,
        { boardId: [boardId], limit: pageSize },
      );
      const firstPage = first?.boards?.[0]?.items_page;
      if (!firstPage) {
        throw new MondayApiError(`Monday board ${boardId} was not found or is not accessible with this API token`);
      }

      totalPages += 1;
      totalItems += firstPage.items.length;
      await onPage({ items: firstPage.items, cursor: firstPage.cursor }, totalPages);

      let cursor = firstPage.cursor;
      while (cursor) {
        const next = await graphql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
          NEXT_ITEMS_PAGE_QUERY,
          { cursor, limit: pageSize },
        );
        const page = next?.next_items_page;
        if (!page) break;

        totalPages += 1;
        totalItems += page.items.length;
        await onPage({ items: page.items, cursor: page.cursor }, totalPages);
        cursor = page.cursor;
      }

      return { totalItems, totalPages };
    },
  };
}
