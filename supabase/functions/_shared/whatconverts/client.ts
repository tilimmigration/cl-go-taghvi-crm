// Server-side WhatConverts API client. Credentials NEVER leave the server:
// this module is only ever imported by Edge Function code, never bundled
// into the frontend, and it never logs the Authorization header, token or
// secret. It shares no code with the Monday client — the two integrations
// are deliberately independent.
//
// Auth: HTTP Basic, username = API token, password = API secret
// (https://www.whatconverts.com/api/). The only endpoint used here is
// `GET {apiUrl}/leads`, paginated with leads_per_page + page_number.

import type { WhatConvertsLead, WhatConvertsLeadsResponse } from "./types.ts";

// --- Error taxonomy ---------------------------------------------------------
// Distinct classes so callers (and the test endpoint) can map each failure
// mode to a clear response without string-matching. No error message or
// `details` payload ever contains the token or secret.

export class WhatConvertsApiError extends Error {
  /** Upstream HTTP status, when the failure came from a response. */
  status?: number;
  /** Safe, non-sensitive extra context (e.g. a truncated response snippet). */
  details?: unknown;
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "WhatConvertsApiError";
    this.status = opts.status;
    this.details = opts.details;
  }
}

/** Upstream returned 401/403 — the configured token/secret were rejected. */
export class WhatConvertsAuthError extends WhatConvertsApiError {
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message, opts);
    this.name = "WhatConvertsAuthError";
  }
}

/** Upstream returned 429 — rate limited. */
export class WhatConvertsRateLimitError extends WhatConvertsApiError {
  /** Seconds to wait, parsed from the Retry-After header if present. */
  retryAfter: number | null;
  constructor(message: string, opts: { status?: number; details?: unknown; retryAfter?: number | null } = {}) {
    super(message, opts);
    this.name = "WhatConvertsRateLimitError";
    this.retryAfter = opts.retryAfter ?? null;
  }
}

/** The request timed out (was aborted) before a response arrived. */
export class WhatConvertsTimeoutError extends WhatConvertsApiError {
  constructor(message: string, opts: { details?: unknown } = {}) {
    super(message, opts);
    this.name = "WhatConvertsTimeoutError";
  }
}

/** A 2xx response whose body wasn't JSON, or lacked the expected shape. */
export class WhatConvertsInvalidResponseError extends WhatConvertsApiError {
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message, opts);
    this.name = "WhatConvertsInvalidResponseError";
  }
}

// --- Client -----------------------------------------------------------------

export interface WhatConvertsLeadsQuery {
  /** WhatConverts `leads_per_page` (page size). */
  leadsPerPage?: number;
  /** WhatConverts `page_number` (1-based). */
  pageNumber?: number;
}

export interface WhatConvertsLeadsPage {
  leadsPerPage: number | null;
  pageNumber: number | null;
  totalPages: number | null;
  totalLeads: number | null;
  leadCount: number;
  leads: WhatConvertsLead[];
  /** The full parsed response body, passed through untouched. */
  raw: WhatConvertsLeadsResponse;
}

export interface WhatConvertsClient {
  /** GET /leads with pagination. Throws a typed error on any failure. */
  fetchLeads(query?: WhatConvertsLeadsQuery): Promise<WhatConvertsLeadsPage>;
}

function basicAuthHeader(token: string, secret: string): string {
  const raw = `${token}:${secret}`;
  if (typeof btoa === "function") return `Basic ${btoa(raw)}`;
  // deno-lint-ignore no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return `Basic ${B.from(raw, "utf-8").toString("base64")}`;
  throw new WhatConvertsApiError("no base64 encoder available in this runtime");
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toSnippet(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t.length > 500 ? `${t.slice(0, 500)}…` : t;
}

export function createWhatConvertsClient(opts: {
  apiToken: string;
  apiSecret: string;
  apiUrl: string;
  timeoutMs?: number;
}): WhatConvertsClient {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const authorization = basicAuthHeader(opts.apiToken, opts.apiSecret);

  async function getRaw(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<{ status: number; bodyText: string; retryAfter: number | null }> {
    const url = new URL(`${apiUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && `${v}` !== "") url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          // Never logged anywhere in this module.
          Authorization: authorization,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new WhatConvertsTimeoutError(`WhatConverts API request timed out after ${timeoutMs}ms`);
      }
      throw new WhatConvertsApiError("WhatConverts API request failed: network error");
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text().catch(() => "");
    const retryAfterRaw = res.headers.get("retry-after");
    const retryAfterNum = retryAfterRaw != null ? Number(retryAfterRaw) : Number.NaN;
    const retryAfter = Number.isFinite(retryAfterNum) ? retryAfterNum : null;
    return { status: res.status, bodyText, retryAfter };
  }

  return {
    async fetchLeads(query = {}): Promise<WhatConvertsLeadsPage> {
      const { status, bodyText, retryAfter } = await getRaw("/leads", {
        leads_per_page: query.leadsPerPage,
        page_number: query.pageNumber,
      });

      if (status === 401 || status === 403) {
        throw new WhatConvertsAuthError(
          `WhatConverts authentication failed (HTTP ${status}). Verify WHATCONVERTS_API_TOKEN and WHATCONVERTS_API_SECRET.`,
          { status },
        );
      }
      if (status === 429) {
        throw new WhatConvertsRateLimitError("WhatConverts API rate limit exceeded (HTTP 429).", { status, retryAfter });
      }
      if (status < 200 || status >= 300) {
        throw new WhatConvertsApiError(`WhatConverts API request failed (HTTP ${status}).`, {
          status,
          details: toSnippet(bodyText),
        });
      }

      let parsed: unknown;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        throw new WhatConvertsInvalidResponseError("WhatConverts API returned a non-JSON response.", { status });
      }
      if (parsed === null || typeof parsed !== "object") {
        throw new WhatConvertsInvalidResponseError("WhatConverts API returned an empty or non-object response.", { status });
      }
      const resp = parsed as WhatConvertsLeadsResponse;
      if (!Array.isArray(resp.leads)) {
        throw new WhatConvertsInvalidResponseError("WhatConverts API response did not contain a 'leads' array.", { status });
      }

      return {
        leadsPerPage: numOrNull(resp.leads_per_page),
        pageNumber: numOrNull(resp.page_number),
        totalPages: numOrNull(resp.total_pages),
        totalLeads: numOrNull(resp.total_leads),
        leadCount: resp.leads.length,
        leads: resp.leads,
        raw: resp,
      };
    },
  };
}
