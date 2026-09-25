// Supabase Edge Function: whatconverts-dryrun
// Endpoint: /functions/v1/whatconverts-dryrun
//
// Runs the WhatConverts -> crm_leads matching + first-touch attribution +
// dashboard reconciliation as a READ-ONLY DRY RUN and returns the report.
// Reads crm_leads (service role) + WhatConverts leads (Step-2 client), runs
// the three pure layers via runDryRun(). NO database writes.
//
// WhatConverts caps /leads to a 400-day window per query, so when an explicit
// { startDate, endDate } spans more than that, this function chunks it into
// <=365-day sub-windows, fetches every page of each, ACCUMULATES all leads,
// and only then runs matching once — so first-touch and unique-lead counting
// are global across the whole history, never per-window.
//
// Optional body: { startDate, endDate } (yyyy-mm-dd), { existingChannels },
// { maxPages } (per window), { options }. Response includes whatConvertsHistory
// with the API's own totals + the fetched date span and breakdowns.
//
// Security: admin-only (Supabase service_role key as Bearer). WhatConverts
// credentials are read server-side only.

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
import { runDryRun, type DryRunReport } from "../_shared/whatconverts/dryrun.ts";
import type { CrmLeadLike, WhatConvertsLeadLike } from "../_shared/whatconverts/matching.ts";

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
const WC_WINDOW_DAYS = 365; // safely under WhatConverts' 400-day-per-query cap
const WC_MAX_PAGES_PER_WINDOW = 40;
const WC_MAX_TOTAL_PAGES = 300; // global safety cap across all windows

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

interface WindowStat {
  start: string | null;
  end: string | null;
  total_leads: number | null;
  total_pages: number | null;
  pages_fetched: number;
  leads_fetched: number;
}

async function fetchWhatConvertsHistory(
  client: WhatConvertsClient,
  startDate: string | undefined,
  endDate: string | undefined,
  maxPagesPerWindow: number,
): Promise<{ leads: WhatConvertsLeadLike[]; windows: WindowStat[]; totalPagesFetched: number; mode: "windowed" | "default" }> {
  const leads: WhatConvertsLeadLike[] = [];
  const windows: WindowStat[] = [];
  let totalPagesFetched = 0;

  const ranges =
    startDate && endDate ? buildWindows(startDate, endDate) : [{ start: undefined as unknown as string, end: undefined as unknown as string }];
  const mode: "windowed" | "default" = startDate && endDate ? "windowed" : "default";

  for (const r of ranges) {
    const stat: WindowStat = { start: r.start ?? null, end: r.end ?? null, total_leads: null, total_pages: null, pages_fetched: 0, leads_fetched: 0 };
    for (let page = 1; page <= maxPagesPerWindow; page++) {
      if (totalPagesFetched >= WC_MAX_TOTAL_PAGES) break;
      const res = await client.fetchLeads({ leadsPerPage: WC_PAGE_SIZE, pageNumber: page, startDate: r.start, endDate: r.end });
      totalPagesFetched += 1;
      stat.pages_fetched += 1;
      if (page === 1) {
        stat.total_leads = res.totalLeads;
        stat.total_pages = res.totalPages;
      }
      leads.push(...(res.leads as WhatConvertsLeadLike[]));
      stat.leads_fetched += res.leads.length;
      const tp = res.totalPages ?? page;
      if (page >= tp || res.leads.length === 0) break;
    }
    windows.push(stat);
  }
  return { leads, windows, totalPagesFetched, mode };
}

function summarizeHistory(
  leads: WhatConvertsLeadLike[],
  windows: WindowStat[],
  totalPagesFetched: number,
  mode: string,
  dateWindow: { startDate?: string; endDate?: string },
) {
  let earliest: { t: number; s: string } | null = null;
  let latest: { t: number; s: string } | null = null;
  const byLeadType: Record<string, number> = {};
  const bySourceMedium: Record<string, number> = {};
  for (const l of leads) {
    const d = l.date_created ? String(l.date_created) : null;
    if (d) {
      const t = Date.parse(d);
      if (Number.isFinite(t)) {
        if (!earliest || t < earliest.t) earliest = { t, s: d };
        if (!latest || t > latest.t) latest = { t, s: d };
      }
    }
    const lt = (l.lead_type as string | null) ?? "(none)";
    byLeadType[lt] = (byLeadType[lt] ?? 0) + 1;
    const sm = `${(l.lead_source as string | null) ?? "(none)"} / ${(l.lead_medium as string | null) ?? "(none)"}`;
    bySourceMedium[sm] = (bySourceMedium[sm] ?? 0) + 1;
  }
  const perWindowTotalSum = windows.reduce((s, w) => s + (w.total_leads ?? 0), 0);
  return {
    mode,
    requested_date_window: { start_date: dateWindow.startDate ?? null, end_date: dateWindow.endDate ?? null },
    api_max_window_days: 400,
    window_size_days: WC_WINDOW_DAYS,
    windows_count: windows.length,
    total_pages_fetched: totalPagesFetched,
    leads_fetched: leads.length,
    per_window_total_leads_sum: perWindowTotalSum,
    earliest_date_created: earliest?.s ?? null,
    latest_date_created: latest?.s ?? null,
    by_lead_type: byLeadType,
    by_source_medium: bySourceMedium,
    windows,
  };
}

export interface HandleDryRunOverrides {
  config?: WhatConvertsConfig;
  whatConvertsClient?: WhatConvertsClient;
  // deno-lint-ignore no-explicit-any
  supabaseClient?: any;
  serviceRoleKey?: string;
}

export async function handleDryRunRequest(req: Request, overrides: HandleDryRunOverrides = {}): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let config: WhatConvertsConfig;
  try {
    config = overrides.config ?? loadWhatConvertsConfig();
  } catch (err) {
    console.error("whatconverts-dryrun: configuration error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "server misconfigured" }, 500);
  }

  const serviceRoleKey = overrides.serviceRoleKey ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || !bearer || bearer !== serviceRoleKey) {
    return json({ error: "unauthorized: this endpoint requires the Supabase service_role key" }, 401);
  }

  let existingChannels: Record<string, number | null> = {};
  let maxPagesPerWindow = WC_MAX_PAGES_PER_WINDOW;
  let startDate: string | undefined;
  let endDate: string | undefined;
  // deno-lint-ignore no-explicit-any
  let options: any = {};
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (b && typeof b === "object") {
        if (b.existingChannels && typeof b.existingChannels === "object") existingChannels = b.existingChannels;
        if (Number.isFinite(b.maxPages) && b.maxPages > 0) maxPagesPerWindow = Math.min(b.maxPages, WC_MAX_PAGES_PER_WINDOW);
        if (typeof b.startDate === "string") startDate = b.startDate;
        if (typeof b.endDate === "string") endDate = b.endDate;
        if (b.options && typeof b.options === "object") options = b.options;
      }
    } catch {
      // no/invalid body → defaults
    }
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

    const [crmLeads, wc] = await Promise.all([
      fetchAllCrmLeads(supabase),
      fetchWhatConvertsHistory(wcClient, startDate, endDate, maxPagesPerWindow),
    ]);

    const whatConvertsHistory = summarizeHistory(wc.leads, wc.windows, wc.totalPagesFetched, wc.mode, { startDate, endDate });
    const report: DryRunReport = runDryRun({ crmLeads, whatConvertsLeads: wc.leads, existingChannels, options });
    return json({ ok: true, dry_run: true, crm_leads_read: crmLeads.length, whatConvertsHistory, ...report }, 200);
  } catch (err) {
    const status = err instanceof WhatConvertsApiError ? err.status : undefined;
    const upstreamBody = err instanceof WhatConvertsApiError ? (err.details ?? null) : null;
    console.error("whatconverts-dryrun: failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown", status ? `(upstream ${status})` : "");
    return json(
      { ok: false, error: "dry run failed", detail: err instanceof Error ? err.message : "unknown", upstream_status: status ?? null, upstream_body: upstreamBody },
      502,
    );
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleDryRunRequest(req));
}
