// Supabase Edge Function: whatconverts-test
// Endpoint: /functions/v1/whatconverts-test
//
// A minimal, admin-only connectivity check for the WhatConverts API. It runs
// a single `GET /leads` (small page) through the server-side WhatConverts
// client and returns the response, so we can confirm the credentials and
// base URL work BEFORE building the real import/webhook pipeline.
//
// SCOPE (deliberately narrow): this function does NOT touch the database,
// the Monday integration, or any CRM record. It only proves the API
// connection. No matching, no writes.
//
// Security:
//   - Credentials (WHATCONVERTS_API_TOKEN / WHATCONVERTS_API_SECRET) are read
//     server-side only, via loadWhatConvertsConfig(). They are never returned
//     to the caller and never logged.
//   - Admin-only: the caller must present the Supabase service_role key as
//     the Bearer token, exactly like monday-import. The browser's anon key is
//     deliberately NOT sufficient (this consumes WhatConverts quota and
//     returns lead PII). The default verify_jwt=true gateway rejects
//     malformed tokens; this manual check additionally rejects the anon key.
//
// handleWhatConvertsTestRequest() is pure and dependency-injectable so it can
// be exercised under plain Node — see __tests__/test-handler.test.ts.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

import { type WhatConvertsConfig, loadWhatConvertsConfig } from "../_shared/whatconverts/config.ts";
import {
  createWhatConvertsClient,
  WhatConvertsApiError,
  WhatConvertsAuthError,
  WhatConvertsInvalidResponseError,
  WhatConvertsRateLimitError,
  WhatConvertsTimeoutError,
  type WhatConvertsClient,
} from "../_shared/whatconverts/client.ts";

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) return Deno.env.get(name) ?? undefined;
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).process?.env?.[name];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DEFAULT_LEADS_PER_PAGE = 5;
const MAX_LEADS_PER_PAGE = 100;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export interface HandleWhatConvertsTestOverrides {
  config?: WhatConvertsConfig;
  client?: WhatConvertsClient;
  /** Defaults to SUPABASE_SERVICE_ROLE_KEY from the environment. */
  serviceRoleKey?: string;
}

export async function handleWhatConvertsTestRequest(
  req: Request,
  overrides: HandleWhatConvertsTestOverrides = {},
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let config: WhatConvertsConfig;
  try {
    config = overrides.config ?? loadWhatConvertsConfig();
  } catch (err) {
    // The message names the missing var, never its value. Log the message only.
    console.error("whatconverts-test: configuration error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "server misconfigured" }, 500);
  }

  // --- Admin auth gate: require the Supabase service_role key -------------
  const serviceRoleKey = overrides.serviceRoleKey ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || !bearer || bearer !== serviceRoleKey) {
    return json({ error: "unauthorized: this endpoint requires the Supabase service_role key" }, 401);
  }

  // --- Pagination params: query string first, then JSON body -------------
  const url = new URL(req.url);
  let bodyParams: { leads_per_page?: unknown; page_number?: unknown } = {};
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (b && typeof b === "object") bodyParams = b as typeof bodyParams;
    } catch {
      // No/invalid body is fine — fall back to query params / defaults.
    }
  }
  const leadsPerPage = clampInt(
    url.searchParams.get("leads_per_page") ?? bodyParams.leads_per_page,
    DEFAULT_LEADS_PER_PAGE,
    1,
    MAX_LEADS_PER_PAGE,
  );
  const pageNumber = clampInt(
    url.searchParams.get("page_number") ?? bodyParams.page_number,
    1,
    1,
    Number.MAX_SAFE_INTEGER,
  );

  const client =
    overrides.client ??
    createWhatConvertsClient({
      apiToken: config.apiToken,
      apiSecret: config.apiSecret,
      apiUrl: config.apiUrl,
      timeoutMs: config.timeoutMs,
    });

  try {
    const page = await client.fetchLeads({ leadsPerPage, pageNumber });
    return json(
      {
        ok: true,
        requested: { leads_per_page: leadsPerPage, page_number: pageNumber },
        pagination: {
          leads_per_page: page.leadsPerPage,
          page_number: page.pageNumber,
          total_pages: page.totalPages,
          total_leads: page.totalLeads,
        },
        lead_count: page.leadCount,
        leads: page.leads,
      },
      200,
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

/**
 * Maps a typed WhatConverts client error to a safe HTTP response. Upstream
 * auth failures become 502 (NOT 401) so they can't be confused with this
 * function's own 401 "missing service_role key" gate. No response body ever
 * includes the token or secret.
 */
function mapErrorToResponse(err: unknown): Response {
  const status = err instanceof WhatConvertsApiError ? err.status : undefined;
  // Log the class + safe message + upstream status only — never config/headers.
  console.error(
    "whatconverts-test: WhatConverts call failed:",
    err instanceof Error ? `${err.name}: ${err.message}` : "unknown error",
    status ? `(upstream HTTP ${status})` : "",
  );

  if (err instanceof WhatConvertsAuthError) {
    return json(
      {
        ok: false,
        error_type: "authentication",
        upstream_status: err.status ?? null,
        message: "WhatConverts rejected the credentials. Verify the configured API token and secret.",
      },
      502,
    );
  }
  if (err instanceof WhatConvertsRateLimitError) {
    return json(
      {
        ok: false,
        error_type: "rate_limit",
        upstream_status: err.status ?? 429,
        retry_after: err.retryAfter,
        message: "WhatConverts rate limit exceeded. Try again later.",
      },
      429,
    );
  }
  if (err instanceof WhatConvertsTimeoutError) {
    return json(
      { ok: false, error_type: "timeout", message: "WhatConverts API did not respond in time." },
      504,
    );
  }
  if (err instanceof WhatConvertsInvalidResponseError) {
    return json(
      {
        ok: false,
        error_type: "invalid_response",
        upstream_status: err.status ?? null,
        message: "WhatConverts returned an unexpected (non-JSON or malformed) response.",
      },
      502,
    );
  }
  if (err instanceof WhatConvertsApiError) {
    return json(
      {
        ok: false,
        error_type: "api_error",
        upstream_status: err.status ?? null,
        details: err.details ?? null,
        message: "WhatConverts API request failed.",
      },
      502,
    );
  }
  return json({ ok: false, error_type: "unknown", message: "Unexpected error calling WhatConverts." }, 500);
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleWhatConvertsTestRequest(req));
}
