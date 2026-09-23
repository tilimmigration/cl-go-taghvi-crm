import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWhatConvertsTestRequest } from "../index.ts";
import type { WhatConvertsConfig } from "../../_shared/whatconverts/config.ts";
import {
  WhatConvertsAuthError,
  WhatConvertsRateLimitError,
  WhatConvertsTimeoutError,
  type WhatConvertsClient,
  type WhatConvertsLeadsPage,
} from "../../_shared/whatconverts/client.ts";

const SERVICE_ROLE_KEY = "fake-service-role-key";
const config: WhatConvertsConfig = {
  apiToken: "t",
  apiSecret: "s",
  apiUrl: "https://app.whatconverts.com/api/v1",
  timeoutMs: 1000,
};

function req(
  method: string,
  { auth, url = "https://x.functions.supabase.co/whatconverts-test", body }: { auth?: string; url?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function fakeClient(impl: WhatConvertsClient["fetchLeads"]): WhatConvertsClient {
  return { fetchLeads: impl };
}

function page(overrides: Partial<WhatConvertsLeadsPage> = {}): WhatConvertsLeadsPage {
  return {
    leadsPerPage: 5,
    pageNumber: 1,
    totalPages: 2,
    totalLeads: 7,
    leadCount: 2,
    leads: [{ lead_id: 1 }, { lead_id: 2 }],
    raw: {},
    ...overrides,
  };
}

test("rejects a method other than GET/POST", async () => {
  const res = await handleWhatConvertsTestRequest(req("PUT", { auth: SERVICE_ROLE_KEY }), { config, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res.status, 405);
});

test("rejects a missing or incorrect service_role key", async () => {
  const res1 = await handleWhatConvertsTestRequest(req("GET"), { config, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res1.status, 401);
  const res2 = await handleWhatConvertsTestRequest(req("GET", { auth: "anon-key" }), { config, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res2.status, 401);
});

test("authorized: returns leads + pagination, defaulting to 5 per page / page 1", async () => {
  let captured: unknown;
  const client = fakeClient(async (q) => {
    captured = q;
    return page();
  });
  const res = await handleWhatConvertsTestRequest(req("GET", { auth: SERVICE_ROLE_KEY }), { config, client, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.lead_count, 2);
  assert.equal(b.pagination.total_leads, 7);
  assert.deepEqual(captured, { leadsPerPage: 5, pageNumber: 1 });
});

test("reads leads_per_page + page_number from the query string, clamping the page size", async () => {
  let captured: { leadsPerPage?: number; pageNumber?: number } = {};
  const client = fakeClient(async (q) => {
    captured = q ?? {};
    return page({ leads: [], leadCount: 0 });
  });
  const res = await handleWhatConvertsTestRequest(
    req("GET", { auth: SERVICE_ROLE_KEY, url: "https://x.functions.supabase.co/whatconverts-test?leads_per_page=999&page_number=4" }),
    { config, client, serviceRoleKey: SERVICE_ROLE_KEY },
  );
  assert.equal(res.status, 200);
  assert.equal(captured.leadsPerPage, 100, "leads_per_page should be clamped to the max");
  assert.equal(captured.pageNumber, 4);
});

test("reads pagination from a POST JSON body", async () => {
  let captured: { leadsPerPage?: number; pageNumber?: number } = {};
  const client = fakeClient(async (q) => {
    captured = q ?? {};
    return page();
  });
  const res = await handleWhatConvertsTestRequest(
    req("POST", { auth: SERVICE_ROLE_KEY, body: { leads_per_page: 3, page_number: 2 } }),
    { config, client, serviceRoleKey: SERVICE_ROLE_KEY },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(captured, { leadsPerPage: 3, pageNumber: 2 });
});

test("maps an upstream auth failure to 502 authentication (not 401)", async () => {
  const client = fakeClient(async () => {
    throw new WhatConvertsAuthError("bad creds", { status: 401 });
  });
  const res = await handleWhatConvertsTestRequest(req("GET", { auth: SERVICE_ROLE_KEY }), { config, client, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error_type, "authentication");
  assert.equal(b.upstream_status, 401);
});

test("maps rate limiting to 429 with retry_after", async () => {
  const client = fakeClient(async () => {
    throw new WhatConvertsRateLimitError("rate limited", { status: 429, retryAfter: 12 });
  });
  const res = await handleWhatConvertsTestRequest(req("GET", { auth: SERVICE_ROLE_KEY }), { config, client, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res.status, 429);
  const b = await res.json();
  assert.equal(b.error_type, "rate_limit");
  assert.equal(b.retry_after, 12);
});

test("maps a timeout to 504", async () => {
  const client = fakeClient(async () => {
    throw new WhatConvertsTimeoutError("timed out");
  });
  const res = await handleWhatConvertsTestRequest(req("GET", { auth: SERVICE_ROLE_KEY }), { config, client, serviceRoleKey: SERVICE_ROLE_KEY });
  assert.equal(res.status, 504);
  const b = await res.json();
  assert.equal(b.error_type, "timeout");
});
