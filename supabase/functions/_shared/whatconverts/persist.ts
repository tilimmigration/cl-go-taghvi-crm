// Builds lead_attribution rows from matched WhatConverts leads. Pure, no I/O —
// the backfill Edge Function calls this and upserts the result. One row per
// WhatConverts lead, keyed by whatconverts_lead_id (the idempotency key):
//   - matched    -> monday_item_id set, match_method + confidence set
//   - unmatched  -> monday_item_id NULL, match_status 'unmatched'
//   - ambiguous  -> monday_item_id NULL, match_status 'ambiguous',
//                   candidate_crm_lead_ids retained, never auto-resolved
// Normalized attribution fields are kept separate from the raw WhatConverts
// values, and the complete raw WhatConverts lead is preserved in raw_attribution.

import { classifyChannel } from "./attribution.ts";
import type { MatchResult, WhatConvertsLeadLike } from "./matching.ts";

export interface AttributionRow {
  whatconverts_lead_id: number;
  monday_item_id: number | null;
  channel: string;
  match_status: "matched" | "unmatched" | "ambiguous";
  match_method: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  candidate_crm_lead_ids: string[] | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  keyword: string | null;
  referrer: string | null;
  landing_page: string | null;
  gclid: string | null;
  fbclid: string | null;
  lead_type: string | null;
  raw_source: string | null;
  raw_medium: string | null;
  raw_campaign: string | null;
  raw_attribution: unknown;
  attribution_created_at: string | null;
  last_synced_at: string;
}

/** lowercased + trimmed, or null. Used for the normalized source/medium. */
function norm(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s || null;
}
/** trimmed original, or null. Used for values that are case-sensitive (campaign, ids, urls). */
function trimmed(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function toIso(v: unknown): string | null {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function buildAttributionRow(wc: WhatConvertsLeadLike, m: MatchResult, now: string = new Date().toISOString()): AttributionRow {
  const cls = classifyChannel(wc);
  // monday_item_id is assigned ONLY for a deterministic (matched) result.
  const mondayItemId = m.status === "matched" && m.monday_item_id != null ? Number(m.monday_item_id) : null;
  return {
    whatconverts_lead_id: Number(wc.lead_id),
    monday_item_id: mondayItemId,
    channel: cls.channel,
    match_status: m.status,
    match_method: m.match_method,
    match_confidence: m.match_confidence,
    match_reason: m.match_reason ?? m.unmatched_reason ?? m.ambiguous_reason ?? null,
    candidate_crm_lead_ids: m.status === "ambiguous" ? m.candidate_crm_lead_ids ?? null : null,
    // Normalized attribution.
    source: norm(wc.lead_source),
    medium: norm(wc.lead_medium),
    campaign: trimmed(wc.lead_campaign),
    content: trimmed((wc as Record<string, unknown>).lead_content),
    keyword: trimmed((wc as Record<string, unknown>).lead_keyword),
    referrer: trimmed((wc as Record<string, unknown>).referral_url),
    landing_page: trimmed((wc as Record<string, unknown>).landing_url),
    gclid: trimmed((wc as Record<string, unknown>).gclid),
    fbclid: trimmed((wc as Record<string, unknown>).fbclid),
    lead_type: trimmed(wc.lead_type),
    // Raw WhatConverts values, kept separate from the normalized ones above.
    raw_source: trimmed(wc.lead_source),
    raw_medium: trimmed(wc.lead_medium),
    raw_campaign: trimmed(wc.lead_campaign),
    // Complete raw WhatConverts lead payload.
    raw_attribution: wc,
    attribution_created_at: toIso(wc.date_created),
    last_synced_at: now,
  };
}

export function buildAttributionRows(
  wcLeads: WhatConvertsLeadLike[],
  results: MatchResult[],
  now: string = new Date().toISOString(),
): AttributionRow[] {
  const byId = new Map(results.map((r) => [String(r.whatconverts_lead_id), r]));
  return wcLeads.map((wc) => {
    const m = byId.get(String(wc.lead_id));
    if (!m) throw new Error(`no match result for whatconverts_lead_id ${wc.lead_id}`);
    return buildAttributionRow(wc, m, now);
  });
}
