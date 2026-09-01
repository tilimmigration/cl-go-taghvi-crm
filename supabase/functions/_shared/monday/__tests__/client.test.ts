import { test } from "node:test";
import assert from "node:assert/strict";
import { createMondayClient, MondayApiError, MondayRateLimitError } from "../client.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function withMockedFetch(handler: (req: Request) => Response | Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  let calls = 0;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (...args: unknown[]) => {
    calls++;
    return handler(new Request(args[0] as string, args[1] as RequestInit));
  };
  return fn()
    .then(() => calls)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test("fetchBoardMetadata returns board, workspace and columns", async () => {
  const client = createMondayClient({ apiToken: "t", apiUrl: "https://fake.monday/v2" });

  const calls = await withMockedFetch(
    async () =>
      jsonResponse(200, {
        data: {
          boards: [
            {
              id: "111222333",
              name: "Lead Tracker",
              workspace: { id: "555", name: "The Hub" },
              columns: [
                { id: "status", title: "Status", type: "status", description: null, settings_str: "{}", archived: false },
              ],
            },
          ],
        },
      }),
    async () => {
      const meta = await client.fetchBoardMetadata("111222333");
      assert.equal(meta.boardId, "111222333");
      assert.equal(meta.boardName, "Lead Tracker");
      assert.equal(meta.workspaceId, "555");
      assert.equal(meta.workspaceName, "The Hub");
      assert.equal(meta.columns.length, 1);
      assert.equal(meta.columns[0].id, "status");
    },
  );
  assert.equal(calls, 1);
});

test("fetchBoardMetadata throws when the board doesn't exist", async () => {
  const client = createMondayClient({ apiToken: "t", apiUrl: "https://fake.monday/v2" });

  await withMockedFetch(
    async () => jsonResponse(200, { data: { boards: [] } }),
    async () => {
      await assert.rejects(() => client.fetchBoardMetadata("999"), MondayApiError);
    },
  );
});

test("fetchAllBoardItems follows cursor pagination across multiple pages", async () => {
  const client = createMondayClient({ apiToken: "t", apiUrl: "https://fake.monday/v2" });

  const calls = await withMockedFetch(
    async (req) => {
      const body = JSON.parse(await req.text());
      if (body.query.includes("GetFirstItemsPage")) {
        return jsonResponse(200, {
          data: { boards: [{ items_page: { cursor: "cursor-1", items: [{ id: "1", name: "A", column_values: [] }] } }] },
        });
      }
      if (body.query.includes("GetNextItemsPage") && body.variables.cursor === "cursor-1") {
        return jsonResponse(200, {
          data: { next_items_page: { cursor: "cursor-2", items: [{ id: "2", name: "B", column_values: [] }] } },
        });
      }
      if (body.query.includes("GetNextItemsPage") && body.variables.cursor === "cursor-2") {
        return jsonResponse(200, {
          data: { next_items_page: { cursor: null, items: [{ id: "3", name: "C", column_values: [] }] } },
        });
      }
      throw new Error("unexpected request in test: " + body.query.slice(0, 40));
    },
    async () => {
      const seenPages: Array<{ pageNumber: number; ids: string[] }> = [];
      const { totalItems, totalPages } = await client.fetchAllBoardItems("111222333", {
        pageSize: 1,
        onPage: (page, pageNumber) => {
          seenPages.push({ pageNumber, ids: page.items.map((i) => i.id) });
        },
      });

      assert.equal(totalItems, 3);
      assert.equal(totalPages, 3);
      assert.deepEqual(seenPages, [
        { pageNumber: 1, ids: ["1"] },
        { pageNumber: 2, ids: ["2"] },
        { pageNumber: 3, ids: ["3"] },
      ]);
    },
  );

  assert.equal(calls, 3);
});

test("retries on a rate-limit-shaped response and eventually succeeds", async () => {
  const client = createMondayClient({
    apiToken: "t",
    apiUrl: "https://fake.monday/v2",
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });

  let attempt = 0;
  const calls = await withMockedFetch(
    async () => {
      attempt++;
      if (attempt < 3) {
        return jsonResponse(429, { errors: [{ message: "rate limited" }] });
      }
      return jsonResponse(200, { data: { items: [{ id: "1", name: "A", column_values: [] }] } });
    },
    async () => {
      const item = await client.fetchItem("1");
      assert.equal(item?.id, "1");
    },
  );

  assert.equal(calls, 3);
});

test("gives up after exhausting retries on persistent rate limiting", async () => {
  const client = createMondayClient({
    apiToken: "t",
    apiUrl: "https://fake.monday/v2",
    retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
  });

  const calls = await withMockedFetch(
    async () => jsonResponse(429, { errors: [{ message: "rate limited" }] }),
    async () => {
      await assert.rejects(() => client.fetchItem("1"), MondayRateLimitError);
    },
  );

  assert.equal(calls, 2);
});

test("does not retry on a non-transient error (e.g. bad query)", async () => {
  const client = createMondayClient({
    apiToken: "t",
    apiUrl: "https://fake.monday/v2",
    retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 },
  });

  const calls = await withMockedFetch(
    async () => jsonResponse(400, { errors: [{ message: "invalid query syntax" }] }),
    async () => {
      await assert.rejects(() => client.fetchItem("1"), MondayApiError);
    },
  );

  assert.equal(calls, 1, "a 400 that isn't rate-limit-shaped should fail immediately, not retry");
});
