// Server-side Calendly REST API client for the historical sync.
//
// Mirrors the WhatConverts client conventions (see
// supabase/functions/_shared/whatconverts/client.ts): bearer auth, a typed error
// taxonomy, an AbortController timeout, and it NEVER logs the token or the
// Authorization header. Read-only GETs only:
//   GET /users/me                                  -> current organization URI
//   GET /scheduled_events?organization=...          -> paginated events
//   GET /scheduled_events/{uuid}/invitees           -> paginated invitees
//
// Calendly paginates with a `pagination.next_page` absolute URL; the client
// exposes that as `nextPage` so the caller can follow it until null.

// --- Error taxonomy ---------------------------------------------------------

export class CalendlyApiError extends Error {
  status?: number;
  details?: unknown;
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "CalendlyApiError";
    this.status = opts.status;
    this.details = opts.details;
  }
}

/** Upstream returned 401/403 — the configured token was rejected or lacks scope. */
export class CalendlyAuthError extends CalendlyApiError {
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message, opts);
    this.name = "CalendlyAuthError";
  }
}

/** Upstream returned 429 — rate limited. */
export class CalendlyRateLimitError extends CalendlyApiError {
  retryAfter: number | null;
  constructor(message: string, opts: { status?: number; details?: unknown; retryAfter?: number | null } = {}) {
    super(message, opts);
    this.name = "CalendlyRateLimitError";
    this.retryAfter = opts.retryAfter ?? null;
  }
}

/** The request timed out (was aborted) before a response arrived. */
export class CalendlyTimeoutError extends CalendlyApiError {
  constructor(message: string, opts: { details?: unknown } = {}) {
    super(message, opts);
    this.name = "CalendlyTimeoutError";
  }
}

/** A 2xx response whose body wasn't JSON or lacked the expected shape. */
export class CalendlyInvalidResponseError extends CalendlyApiError {
  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message, opts);
    this.name = "CalendlyInvalidResponseError";
  }
}

// --- Client -----------------------------------------------------------------

export interface CalendlyPage<T> {
  collection: T[];
  /** Absolute URL of the next page, or null when there are no more. */
  nextPage: string | null;
}

export interface CalendlyClient {
  /** GET /users/me -> resource.current_organization. */
  getCurrentOrganization(): Promise<string>;
  /** GET /scheduled_events (first page from params, or a follow-up pageUrl). */
  listScheduledEvents(params: {
    organization: string;
    count?: number;
    status?: string;
    pageUrl?: string;
  }): Promise<CalendlyPage<unknown>>;
  /** GET /scheduled_events/{uuid}/invitees (first page, or a follow-up pageUrl). */
  listInvitees(eventUuid: string, params?: { count?: number; pageUrl?: string }): Promise<CalendlyPage<unknown>>;
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

function toSnippet(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t.length > 500 ? `${t.slice(0, 500)}…` : t;
}

/** Last non-empty path segment of a Calendly resource URI (its UUID). */
export function lastPathSegment(uri: string): string {
  const parts = String(uri).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function createCalendlyClient(opts: {
  apiToken: string;
  apiUrl: string;
  timeoutMs?: number;
}): CalendlyClient {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const authorization = `Bearer ${opts.apiToken}`;

  async function getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          // Never logged anywhere in this module.
          Authorization: authorization,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw new CalendlyTimeoutError(`Calendly API request timed out after ${timeoutMs}ms`);
      throw new CalendlyApiError("Calendly API request failed: network error");
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text().catch(() => "");

    if (res.status === 401 || res.status === 403) {
      throw new CalendlyAuthError(
        `Calendly authentication failed (HTTP ${res.status}). Verify CALENDLY_API_TOKEN and that it can read the organization.`,
        { status: res.status },
      );
    }
    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterNum = retryAfterRaw != null ? Number(retryAfterRaw) : Number.NaN;
      throw new CalendlyRateLimitError("Calendly API rate limit exceeded (HTTP 429).", {
        status: res.status,
        retryAfter: Number.isFinite(retryAfterNum) ? retryAfterNum : null,
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new CalendlyApiError(`Calendly API request failed (HTTP ${res.status}).`, {
        status: res.status,
        details: toSnippet(bodyText),
      });
    }

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      throw new CalendlyInvalidResponseError("Calendly API returned a non-JSON response.", { status: res.status });
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new CalendlyInvalidResponseError("Calendly API returned an empty or non-object response.", { status: res.status });
    }
    return parsed;
  }

  function buildEventsUrl(params: { organization: string; count?: number; status?: string }): string {
    const url = new URL(`${apiUrl}/scheduled_events`);
    url.searchParams.set("organization", params.organization);
    url.searchParams.set("count", String(params.count ?? 100));
    if (params.status) url.searchParams.set("status", params.status);
    return url.toString();
  }

  // deno-lint-ignore no-explicit-any
  function pageOf(body: any): CalendlyPage<unknown> {
    const collection = Array.isArray(body?.collection) ? body.collection : null;
    if (!collection) throw new CalendlyInvalidResponseError("Calendly response did not contain a 'collection' array.");
    const nextPage = body?.pagination?.next_page ?? null;
    return { collection, nextPage: typeof nextPage === "string" && nextPage ? nextPage : null };
  }

  return {
    async getCurrentOrganization(): Promise<string> {
      // deno-lint-ignore no-explicit-any
      const body = (await getJson(`${apiUrl}/users/me`)) as any;
      const org = body?.resource?.current_organization;
      if (typeof org !== "string" || !org) {
        throw new CalendlyInvalidResponseError("Calendly /users/me did not return resource.current_organization.");
      }
      return org;
    },

    async listScheduledEvents(params): Promise<CalendlyPage<unknown>> {
      const url = params.pageUrl ?? buildEventsUrl(params);
      return pageOf(await getJson(url));
    },

    async listInvitees(eventUuid, params = {}): Promise<CalendlyPage<unknown>> {
      const url =
        params.pageUrl ??
        (() => {
          const u = new URL(`${apiUrl}/scheduled_events/${eventUuid}/invitees`);
          u.searchParams.set("count", String(params.count ?? 100));
          return u.toString();
        })();
      return pageOf(await getJson(url));
    },
  };
}
