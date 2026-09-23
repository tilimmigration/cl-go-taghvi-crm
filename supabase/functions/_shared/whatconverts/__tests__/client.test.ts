import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWhatConvertsClient,
  WhatConvertsApiError,
  WhatConvertsAuthError,
  WhatConvertsInvalidResponseError,
  WhatConvertsRateLimitError,
  WhatConvertsTimeoutError,
} from "../client.ts";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": "application/json", ...headers } });
}

// deno-lint-ignore no-explicit-any
function withMockedFetch(handler: (url: string, init: any) => Response, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (...args: unknown[]) => handler(String(args[0]), args[1]);
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function client() {
  return createWhatConvertsClient({ apiToken: "tok", apiSecret: "sec", apiUrl: "https://app.whatconverts.com/api/v1", timeoutMs: 50 });
}

test("sends HTTP Basic auth + pagination params and returns normalized leads", async () => {
  await withMockedFetch(
    (url, init) => {
      assert.equal(init.headers.Authorization, `Basic ${Buffer.from("tok:sec").toString("base64")}`);
      const u = new URL(url);
      assert.equal(u.pathname, "/api/v1/leads");
      assert.equal(u.searchParams.get("leads_per_page"), "5");
      assert.equal(u.searchParams.get("page_number"), "2");
      return response(200, {
        leads_per_page: 5,
        page_number: 2,
        total_pages: 3,
        total_leads: 12,
        leads: [{ lead_id: 1 }, { lead_id: 2 }],
      });
    },
    async () => {
      const page = await client().fetchLeads({ leadsPerPage: 5, pageNumber: 2 });
      assert.equal(page.leadCount, 2);
      assert.equal(page.totalLeads, 12);
      assert.equal(page.pageNumber, 2);
      assert.equal(page.leads[0].lead_id, 1);
    },
  );
});

test("sends start_date / end_date query params when provided", async () => {
  await withMockedFetch(
    (url) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get("start_date"), "2005-01-01");
      assert.equal(u.searchParams.get("end_date"), "2030-12-31");
      return response(200, { leads_per_page: 250, page_number: 1, total_pages: 1, total_leads: 0, leads: [] });
    },
    async () => {
      await client().fetchLeads({ leadsPerPage: 250, pageNumber: 1, startDate: "2005-01-01", endDate: "2030-12-31" });
    },
  );
});

test("401 -> WhatConvertsAuthError, and the secret is not leaked in the message", async () => {
  await withMockedFetch(
    () => response(401, { message: "Unauthorized" }),
    async () => {
      await assert.rejects(
        () => client().fetchLeads(),
        (e: unknown) => {
          assert.ok(e instanceof WhatConvertsAuthError);
          assert.equal((e as WhatConvertsAuthError).status, 401);
          assert.ok(!(e as Error).message.includes("sec"), "message must not contain the secret");
          return true;
        },
      );
    },
  );
});

test("429 -> WhatConvertsRateLimitError and captures Retry-After", async () => {
  await withMockedFetch(
    () => response(429, { message: "Too Many Requests" }, { "Retry-After": "30" }),
    async () => {
      await assert.rejects(
        () => client().fetchLeads(),
        (e: unknown) => {
          assert.ok(e instanceof WhatConvertsRateLimitError);
          assert.equal((e as WhatConvertsRateLimitError).retryAfter, 30);
          return true;
        },
      );
    },
  );
});

test("5xx -> WhatConvertsApiError", async () => {
  await withMockedFetch(
    () => response(500, "internal error"),
    async () => {
      await assert.rejects(() => client().fetchLeads(), WhatConvertsApiError);
    },
  );
});

test("2xx with a non-JSON body -> WhatConvertsInvalidResponseError", async () => {
  await withMockedFetch(
    () => response(200, "<html>not json</html>"),
    async () => {
      await assert.rejects(() => client().fetchLeads(), WhatConvertsInvalidResponseError);
    },
  );
});

test("2xx without a leads array -> WhatConvertsInvalidResponseError", async () => {
  await withMockedFetch(
    () => response(200, { total_leads: 0 }),
    async () => {
      await assert.rejects(() => client().fetchLeads(), WhatConvertsInvalidResponseError);
    },
  );
});

test("an aborted request -> WhatConvertsTimeoutError", async () => {
  await withMockedFetch(
    () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    },
    async () => {
      await assert.rejects(() => client().fetchLeads(), WhatConvertsTimeoutError);
    },
  );
});
