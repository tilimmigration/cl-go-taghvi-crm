// Supabase Edge Function: whatconverts-backfill
// Endpoint: /functions/v1/whatconverts-backfill
//
// Persists WhatConverts leads into public.lead_attribution (the separate
// attribution layer). This is the ONLY WhatConverts function that writes, and
// it writes ONLY lead_attribution: it never modifies crm_leads / crm_calls /
// crm_deals, never touches the Monday integration, and never changes the
// Dashboard. One row per WhatConverts lead, upserted on whatconverts_lead_id
// (idempotent — re-running never duplicates).
//
// Reads crm_leads (service role) + WhatConverts leads (Step-2 client, chunked
// into <=365-day windows because WhatConverts caps /leads at 400 days). Runs
// the validated matching engine unchanged; matched -> monday_item_id set,
// unmatched/ambiguous -> monday_item_id NULL (ambiguous keeps its candidate
// ids and is never auto-resolved).
//
// Body (all optional): { startDate, endDate } (yyyy-mm-dd; default the
// validated 2026-04-21..2026-09-23 range, but overridable — never hardcoded),
// { sampleLeadIds: number[] } to persist only those leads (small write test),
// { commit: false } to compute without writing, { maxPages }, { options }.
//
// Security: admin-only (Supabase service_role key as Bearer).

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

import { type WhatConvertsConfig, loadWhatConvertsConfig } from "../_shared/whatconverts/config.ts";
import { createWhatConvertsClient, type WhatConvertsClient, WhatConvertsApiError } from "../_shared/whatconverts/client.ts";
import { buildLeadIndex, matchAll, type CrmLeadLike, type MatchOptions, type WhatConvertsLeadLike } from "../_shared/whatconverts/matching.ts";
import { buildAttributionRows } from "../_shared/whatconverts/persist.ts";

const DEFAULT_START = "2026-04-21";
const DEFAULT_END = "2026-09-23";

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) return Deno.env.get(name) ?? undefined;
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).process?.env?.[name];
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CRM_COLUMNS =
  "id, monday_item_id, name, first_name, last_name, email, phone, custom_fields, raw_column_values, monday_created_at, status";
const CRM_PAGE = 1000;
const WC_PAGE_SIZE = 250;
const WC_WINDOW_DAYS = 365;
const WC_MAX_PAGES_PER_WINDOW = 40;
const WC_MAX_TOTAL_PAGES = 300;
const UPSERT_CHUNK = 500;

// deno-lint-ignore no-explicit-any
async function fetchAllCrmLeads(supabase: any): Promise<CrmLeadLike[]> {
  const rows: CrmLeadLike[] = [];
  for (let from = 0; ; from += CRM_PAGE) {
    const { data, error } = await supabase.from("crm_leads").select(CRM_COLUMNS).eq("is_deleted", false).order("id").range(from, from + CRM_PAGE - 1);
    if (error) throw new Error(`crm_leads read failed: ${error.message}`);
    if (data?.length) rows.push(...(data as CrmLeadLike[]));
    if (!data || data.length < CRM_PAGE) break;
  }
  return rows;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function buildWindows(start: string, end: string): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 200) {
    let winEnd = addDays(cur, WC_WINDOW_DAYS - 1);
    if (winEnd > end) winEnd = end;
    windows.push({ start: cur, end: winEnd });
    cur = addDays(winEnd, 1);
    guard += 1;
  }
  return windows;
}

async function fetchWhatConvertsHistory(client: WhatConvertsClient, startDate: string, endDate: string, maxPagesPerWindow: number): Promise<{ leads: WhatConvertsLeadLike[]; windowsCount: number; pagesFetched: number }> {
  const leads: WhatConvertsLeadLike[] = [];
  let pagesFetched = 0;
  const windows = buildWindows(startDate, endDate);
  for (const w of windows) {
    for (let page = 1; page <= maxPagesPerWindow; page++) {
      if (pagesFetched >= WC_MAX_TOTAL_PAGES) break;
      const res = await client.fetchLeads({ leadsPerPage: WC_PAGE_SIZE, pageNumber: page, startDate: w.start, endDate: w.end });
      pagesFetched += 1;
      leads.push(...(res.leads as WhatConvertsLeadLike[]));
      const tp = res.totalPages ?? page;
      if (page >= tp || res.leads.length === 0) break;
    }
  }
  return { leads, windowsCount: windows.length, pagesFetched };
}

export interface HandleBackfillOverrides {
  config?: WhatConvertsConfig;
  whatConvertsClient?: WhatConvertsClient;
  // deno-lint-ignore no-explicit-any
  supabaseClient?: any;
  serviceRoleKey?: string;
}

export async function handleBackfillRequest(req: Request, overrides: HandleBackfillOverrides = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let config: WhatConvertsConfig;
  try {
    config = overrides.config ?? loadWhatConvertsConfig();
  } catch (err) {
    console.error("whatconverts-backfill: configuration error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "server misconfigured" }, 500);
  }

  const serviceRoleKey = overrides.serviceRoleKey ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || !bearer || bearer !== serviceRoleKey) {
    return json({ error: "unauthorized: this endpoint requires the Supabase service_role key" }, 401);
  }

  let startDate = DEFAULT_START;
  let endDate = DEFAULT_END;
  let maxPages = WC_MAX_PAGES_PER_WINDOW;
  let commit = true;
  let sampleLeadIds: Set<string> | null = null;
  // deno-lint-ignore no-explicit-any
  let options: MatchOptions = {};
  try {
    const b = await req.json();
    if (b && typeof b === "object") {
      if (typeof b.startDate === "string") startDate = b.startDate;
      if (typeof b.endDate === "string") endDate = b.endDate;
      if (Number.isFinite(b.maxPages) && b.maxPages > 0) maxPages = Math.min(b.maxPages, WC_MAX_PAGES_PER_WINDOW);
      if (b.commit === false) commit = false;
      if (Array.isArray(b.sampleLeadIds) && b.sampleLeadIds.length) sampleLeadIds = new Set(b.sampleLeadIds.map((x: unknown) => String(x)));
      if (b.options && typeof b.options === "object") options = b.options;
    }
  } catch {
    // no body → defaults (validated historical range)
  }

  try {
    // deno-lint-ignore no-explicit-any
    let supabase: any = overrides.supabaseClient;
    if (!supabase) {
      const supabaseUrl = readEnv("SUPABASE_URL");
      if (!supabaseUrl) return json({ error: "server misconfigured" }, 500);
      const createClient = await getSupabaseClientFactory();
      supabase = createClient(supabaseUrl, serviceRoleKey);
    }
    const wcClient =
      overrides.whatConvertsClient ??
      createWhatConvertsClient({ apiToken: config.apiToken, apiSecret: config.apiSecret, apiUrl: config.apiUrl, timeoutMs: config.timeoutMs });

    const [crmLeads, wc] = await Promise.all([fetchAllCrmLeads(supabase), fetchWhatConvertsHistory(wcClient, startDate, endDate, maxPages)]);

    let wcLeads = wc.leads;
    if (sampleLeadIds) wcLeads = wcLeads.filter((l) => sampleLeadIds!.has(String(l.lead_id)));

    const index = buildLeadIndex(crmLeads);
    const results = matchAll(wcLeads, index, options);
    const rows = buildAttributionRows(wcLeads, results);

    const counts = {
      matched: results.filter((r) => r.status === "matched").length,
      unmatched: results.filter((r) => r.status === "unmatched").length,
      ambiguous: results.filter((r) => r.status === "ambiguous").length,
    };

    let persisted = 0;
    if (commit && rows.length) {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase.from("lead_attribution").upsert(chunk, { onConflict: "whatconverts_lead_id" });
        if (error) throw new Error(`lead_attribution upsert failed: ${error.message}`);
        persisted += chunk.length;
      }
    }

    return json(
      {
        ok: true,
        committed: commit,
        date_range: { start_date: startDate, end_date: endDate },
        sample: sampleLeadIds ? [...sampleLeadIds] : null,
        crm_leads_read: crmLeads.length,
        whatconverts_leads_fetched: wc.leads.length,
        whatconverts_leads_considered: wcLeads.length,
        windows_count: wc.windowsCount,
        pages_fetched: wc.pagesFetched,
        rows_built: rows.length,
        rows_persisted: persisted,
        counts,
      },
      200,
    );
  } catch (err) {
    const status = err instanceof WhatConvertsApiError ? err.status : undefined;
    console.error("whatconverts-backfill: failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown", status ? `(upstream ${status})` : "");
    return json({ ok: false, error: "backfill failed", detail: err instanceof Error ? err.message : "unknown" }, status === 401 || status === 403 ? 502 : 500);
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleBackfillRequest(req));
}
