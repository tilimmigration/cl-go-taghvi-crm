// Supabase Edge Function: whatconverts-dryrun
// Endpoint: /functions/v1/whatconverts-dryrun
//
// Runs the WhatConverts -> crm_leads matching + first-touch attribution +
// dashboard reconciliation as a READ-ONLY DRY RUN and returns the report.
// It reads crm_leads (service role) and WhatConverts leads (Step-2 client),
// runs the three pure layers via runDryRun(), and returns the result.
//
// It performs NO database writes: it does not touch crm_leads, does not write
// lead_attribution, and does not change the Monday integration. Matching is
// not "enabled" by this — it only reports what a match WOULD produce.
//
// Security: admin-only. The caller must present the Supabase service_role key
// as the Bearer token (same posture as monday-import / whatconverts-test).
// WhatConverts credentials are read server-side only and never returned.

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
const WC_MAX_PAGES = 40; // safety cap (~10k leads) for a dry run

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

async function fetchWhatConvertsLeads(client: WhatConvertsClient, maxPages: number): Promise<WhatConvertsLeadLike[]> {
  const leads: WhatConvertsLeadLike[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await client.fetchLeads({ leadsPerPage: WC_PAGE_SIZE, pageNumber: page });
    leads.push(...(res.leads as WhatConvertsLeadLike[]));
    const totalPages = res.totalPages ?? page;
    if (page >= totalPages || res.leads.length === 0) break;
  }
  return leads;
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

  // Optional request body: existing dashboard channel counts (so the caller
  // supplies them from src/data.js rather than this function hardcoding them),
  // plus optional matching tolerance + WhatConverts page cap.
  let existingChannels: Record<string, number | null> = {};
  let maxPages = WC_MAX_PAGES;
  // deno-lint-ignore no-explicit-any
  let options: any = {};
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (b && typeof b === "object") {
        if (b.existingChannels && typeof b.existingChannels === "object") existingChannels = b.existingChannels;
        if (Number.isFinite(b.maxPages) && b.maxPages > 0) maxPages = Math.min(b.maxPages, WC_MAX_PAGES);
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

    const [crmLeads, whatConvertsLeads] = await Promise.all([
      fetchAllCrmLeads(supabase),
      fetchWhatConvertsLeads(wcClient, maxPages),
    ]);

    const report: DryRunReport = runDryRun({ crmLeads, whatConvertsLeads, existingChannels, options });
    return json({ ok: true, dry_run: true, crm_leads_read: crmLeads.length, ...report }, 200);
  } catch (err) {
    const status = err instanceof WhatConvertsApiError ? err.status : undefined;
    console.error("whatconverts-dryrun: failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown", status ? `(upstream ${status})` : "");
    return json({ ok: false, error: "dry run failed", detail: err instanceof Error ? err.message : "unknown" }, 502);
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleDryRunRequest(req));
}
