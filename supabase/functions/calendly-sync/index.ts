// Supabase Edge Function: calendly-sync
// Endpoint: /functions/v1/calendly-sync
//
// ONE-TIME (re-runnable) HISTORICAL BACKFILL of existing Calendly bookings into
// public.calendly_events ONLY. It complements — and never changes — the
// real-time calendly-webhook. Like the webhook it:
//   * writes ONLY calendly_events (never crm_leads / crm_leads.status /
//     crm_calls / crm_deals / lead_attribution; never Monday; never WhatConverts),
//   * matches leads ONLY by normalized email (never name/phone/fuzzy),
//   * never infers CE Completed (explicit-only is preserved), and
//   * is idempotent — keyed on calendly_event_uri, re-running never duplicates.
//
// It additionally records match_status (matched / unmatched / ambiguous) so an
// ambiguous email is never guessed and is distinguishable from a plain miss.
//
// Auth mirrors whatconverts-backfill: config loads first, then the caller must
// present the Supabase service_role key (Bearer) OR the optional
// CALENDLY_SYNC_TRIGGER_TOKEN via the `X-Sync-Trigger` header. verify_jwt is
// disabled because this function implements its own admin auth.
//
// handleCalendlySync() is pure/dependency-injectable (config, supabase client,
// and calendly client can all be injected) so it is testable under plain Node;
// Deno.serve() at the bottom is the only Deno-only part.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// deno-lint-ignore no-explicit-any
let _createClient: ((url: string, key: string) => any) | undefined;
async function getSupabaseClientFactory() {
  if (!_createClient) {
    const mod = await import("npm:@supabase/supabase-js@2");
    _createClient = mod.createClient;
  }
  return _createClient!;
}

import { type CalendlySyncConfig, loadCalendlySyncConfig } from "./lib/config.ts";
import { type CalendlyClient, createCalendlyClient, lastPathSegment, CalendlyApiError, CalendlyAuthError, CalendlyRateLimitError } from "./lib/client.ts";
import { normalizeSyncEvent, type NormalizedSyncEvent } from "./lib/events.ts";
import { buildLeadEmailIndex, matchEmail, type CrmLeadLike } from "./lib/matching.ts";
import { buildSyncRow, type ExistingCalendlyRow } from "./lib/persist.ts";

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) return Deno.env.get(name) ?? undefined;
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).process?.env?.[name];
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Constant-time string comparison for the optional trigger token. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CRM_COLUMNS = "id, email, monday_item_id";
const CRM_PAGE = 1000;
// calendly_event_uri values are long (~70 chars, URL-encoded ~120). PostgREST
// puts `.in(...)` values in the GET query string, so a large chunk builds a huge
// URL that the HTTP/2 layer can reject ("stream error / protocol error"). Keep
// this small so the existing-row lookup URL stays well within limits.
const EXISTING_IN_CHUNK = 25;
const UPSERT_CHUNK = 500;
const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_MAX_PAGES = 200;

// deno-lint-ignore no-explicit-any
async function fetchAllCrmLeads(supabase: any): Promise<CrmLeadLike[]> {
  const rows: CrmLeadLike[] = [];
  for (let from = 0; ; from += CRM_PAGE) {
    const { data, error } = await supabase
      .from("crm_leads")
      .select(CRM_COLUMNS)
      .eq("is_deleted", false)
      .order("id")
      .range(from, from + CRM_PAGE - 1);
    if (error) throw new Error(`crm_leads read failed: ${error.message ?? String(error)}`);
    if (data?.length) rows.push(...(data as CrmLeadLike[]));
    if (!data || data.length < CRM_PAGE) break;
  }
  return rows;
}

// deno-lint-ignore no-explicit-any
async function fetchExistingByUris(supabase: any, uris: string[]): Promise<Map<string, ExistingCalendlyRow>> {
  const map = new Map<string, ExistingCalendlyRow>();
  for (let i = 0; i < uris.length; i += EXISTING_IN_CHUNK) {
    const chunk = uris.slice(i, i + EXISTING_IN_CHUNK);
    const { data, error } = await supabase
      .from("calendly_events")
      .select("calendly_event_uri, lead_id, monday_item_id, ce_booked, ce_booked_at, status, canceled_at, cancel_reason")
      .in("calendly_event_uri", chunk);
    if (error) throw new Error(`calendly_events read failed: ${error.message ?? String(error)}`);
    for (const r of (data ?? []) as Array<ExistingCalendlyRow & { calendly_event_uri: string }>) {
      map.set(r.calendly_event_uri, r);
    }
  }
  return map;
}

export interface HandleSyncOverrides {
  config?: CalendlySyncConfig;
  calendlyClient?: CalendlyClient;
  // deno-lint-ignore no-explicit-any
  supabaseClient?: any;
  serviceRoleKey?: string;
}

export async function handleCalendlySync(req: Request, overrides: HandleSyncOverrides = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 1) Config first (mirrors whatconverts-backfill) so a missing CALENDLY_API_TOKEN
  //    is reported as 500 "server misconfigured" rather than masked by auth.
  let config: CalendlySyncConfig;
  try {
    config = overrides.config ?? loadCalendlySyncConfig();
  } catch (err) {
    console.error("calendly-sync: configuration error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "server misconfigured" }, 500);
  }

  // 2) Admin auth: service_role Bearer OR the optional trigger token.
  const serviceRoleKey = overrides.serviceRoleKey ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const triggerHeader = req.headers.get("X-Sync-Trigger") ?? "";
  const okService = !!serviceRoleKey && !!bearer && bearer === serviceRoleKey;
  const okTrigger = !!config.triggerToken && !!triggerHeader && timingSafeEqualStr(triggerHeader, config.triggerToken);
  if (!okService && !okTrigger) {
    return json({ error: "unauthorized: requires the Supabase service_role key (Bearer) or the configured X-Sync-Trigger token" }, 401);
  }

  // 3) Params (all optional).
  let commit = true;
  let maxEvents = DEFAULT_MAX_EVENTS;
  let maxPages = DEFAULT_MAX_PAGES;
  let statusFilter: string | undefined;
  let startPageUrl: string | undefined;
  let inviteeCount = 100;
  try {
    const b = await req.json();
    if (b && typeof b === "object") {
      if (b.commit === false) commit = false;
      if (Number.isFinite(b.maxEvents) && b.maxEvents > 0) maxEvents = Math.min(b.maxEvents, 50000);
      if (Number.isFinite(b.maxPages) && b.maxPages > 0) maxPages = Math.min(b.maxPages, 5000);
      if (b.status === "active" || b.status === "canceled") statusFilter = b.status;
      if (typeof b.pageUrl === "string" && b.pageUrl) startPageUrl = b.pageUrl;
      if (Number.isFinite(b.inviteeCount) && b.inviteeCount > 0) inviteeCount = Math.min(b.inviteeCount, 100);
    }
  } catch {
    // no body → full historical sync with defaults
  }

  try {
    // deno-lint-ignore no-explicit-any
    let supabase: any = overrides.supabaseClient;
    if (!supabase) {
      const supabaseUrl = readEnv("SUPABASE_URL");
      if (!supabaseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);
      const createClient = await getSupabaseClientFactory();
      supabase = createClient(supabaseUrl, serviceRoleKey);
    }
    const calendly =
      overrides.calendlyClient ?? createCalendlyClient({ apiToken: config.apiToken, apiUrl: config.apiUrl, timeoutMs: config.timeoutMs });

    // CRM leads + normalized-email index.
    const leads = await fetchAllCrmLeads(supabase);
    const index = buildLeadEmailIndex(leads);

    // Organization URI (explicit config or derived from /users/me).
    const organization = config.organizationUri ?? (await calendly.getCurrentOrganization());

    // Paginate scheduled events; for each, page through its invitees. Collapse to
    // one row per scheduled event (calendly_event_uri) — consistent with the
    // webhook's one-row-per-event design; extra invitees are counted, not lost
    // silently (relevant only for group events; CE bookings are 1:1).
    const normByUri = new Map<string, { norm: NormalizedSyncEvent; raw: unknown }>();
    let eventsFound = 0;
    let inviteesProcessed = 0;
    let collapsedDuplicateInvitees = 0;
    let eventsWithoutInvitee = 0;
    let pagesFetched = 0;
    let hasMore = false;
    let nextPage: string | null = null;
    let pageUrl = startPageUrl;

    const startedAt = Date.now();
    const timeBudgetMs = 90_000; // stop at a PAGE boundary after ~90s; resume via next_page

    while (true) {
      const page = await calendly.listScheduledEvents({ organization, count: 100, status: statusFilter, pageUrl });
      pagesFetched += 1;

      // Process the WHOLE page. Calendly paginates at the page level, so we must
      // never stop mid-page and resume from next_page (that would skip the rest
      // of this page). maxEvents / maxPages / the time budget are all enforced at
      // page boundaries only.
      for (const se of page.collection) {
        eventsFound += 1;
        // deno-lint-ignore no-explicit-any
        const seAny = se as any;
        const uuid = lastPathSegment(String(seAny?.uri ?? ""));

        // Gather all invitees for this event (paginated).
        const invitees: unknown[] = [];
        let invPageUrl: string | undefined;
        while (uuid) {
          const ip = await calendly.listInvitees(uuid, { count: inviteeCount, pageUrl: invPageUrl });
          invitees.push(...ip.collection);
          if (!ip.nextPage) break;
          invPageUrl = ip.nextPage;
        }

        if (invitees.length === 0) {
          eventsWithoutInvitee += 1;
          const norm = normalizeSyncEvent(seAny, null);
          if (norm && !normByUri.has(norm.calendlyEventUri)) {
            normByUri.set(norm.calendlyEventUri, { norm, raw: { scheduled_event: seAny, invitee: null } });
          }
          continue;
        }

        for (const inv of invitees) {
          inviteesProcessed += 1;
          const norm = normalizeSyncEvent(seAny, inv);
          if (!norm) continue;
          if (normByUri.has(norm.calendlyEventUri)) {
            collapsedDuplicateInvitees += 1;
            continue;
          }
          normByUri.set(norm.calendlyEventUri, { norm, raw: { scheduled_event: seAny, invitee: inv } });
        }
      }

      if (!page.nextPage) {
        hasMore = false;
        nextPage = null;
        break;
      }
      if (eventsFound >= maxEvents || pagesFetched >= maxPages || Date.now() - startedAt >= timeBudgetMs) {
        hasMore = true;
        nextPage = page.nextPage;
        break;
      }
      pageUrl = page.nextPage;
    }

    // Existing rows (to preserve completion + existing links; classify insert vs update).
    const uris = [...normByUri.keys()];
    const existingMap = await fetchExistingByUris(supabase, uris);

    // Build rows + tally.
    // deno-lint-ignore no-explicit-any
    const rows: Record<string, any>[] = [];
    let matched = 0;
    let unmatched = 0;
    let ambiguous = 0;
    let inserted = 0;
    let updated = 0;
    for (const [uri, { norm, raw }] of normByUri) {
      const m = matchEmail(index, norm.inviteeEmail);
      const existing = existingMap.get(uri) ?? null;
      const row = buildSyncRow(norm, m, existing, raw);
      rows.push(row);
      if (row.match_status === "matched") matched += 1;
      else if (row.match_status === "ambiguous") ambiguous += 1;
      else unmatched += 1;
      if (existing) updated += 1;
      else inserted += 1;
    }

    // Idempotent chunked upsert.
    let rowsPersisted = 0;
    if (commit && rows.length) {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase.from("calendly_events").upsert(chunk, { onConflict: "calendly_event_uri" });
        if (error) throw new Error(`calendly_events upsert failed: ${error.message ?? String(error)}`);
        rowsPersisted += chunk.length;
      }
    }

    return json(
      {
        ok: true,
        committed: commit,
        organization,
        total_events_found: eventsFound,
        total_invitees_processed: inviteesProcessed,
        events_without_invitee: eventsWithoutInvitee,
        unique_events_built: rows.length,
        counts: { matched, unmatched, ambiguous },
        inserted,
        updated,
        skipped_duplicate: collapsedDuplicateInvitees,
        rows_persisted: rowsPersisted,
        pages_fetched: pagesFetched,
        has_more: hasMore,
        next_page: nextPage,
      },
      200,
    );
  } catch (err) {
    const status = err instanceof CalendlyApiError ? err.status : undefined;
    const upstream =
      err instanceof CalendlyAuthError ? "calendly_auth" : err instanceof CalendlyRateLimitError ? "calendly_rate_limit" : undefined;
    console.error("calendly-sync: failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown", status ? `(upstream ${status})` : "");
    return json(
      { ok: false, error: "sync failed", detail: err instanceof Error ? err.message : "unknown", upstream },
      status === 401 || status === 403 || status === 429 ? 502 : 500,
    );
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleCalendlySync(req));
}
