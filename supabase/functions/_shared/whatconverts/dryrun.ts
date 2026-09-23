// Dry-run orchestrator. This does NOT implement any of the three layers — it
// only wires them together and shapes the report:
//   Layer 1 matching.ts  -> Layer 2 attribution.ts -> Layer 3 reconcile.ts
// It performs NO database writes and NO external calls; it operates purely on
// already-fetched crm_leads + WhatConverts leads. PII in the examples is
// redacted here so the report is safe to share.

import { buildLeadIndex, matchAll, type CrmLeadLike, type MatchMethod, type MatchResult, type MatchOptions, type WhatConvertsLeadLike } from "./matching.ts";
import { computeFirstTouch, type Channel, type MatchedTouch } from "./attribution.ts";
import { aggregateFirstTouchChannels, reconcile, type Reconciliation } from "./reconcile.ts";

export interface DryRunInput {
  crmLeads: CrmLeadLike[];
  whatConvertsLeads: WhatConvertsLeadLike[];
  /** Existing dashboard channel counts by display label (+ "__total__"); from src/data.js, never hardcoded here. */
  existingChannels?: Record<string, number | null>;
  options?: MatchOptions;
}

export interface RedactedExample {
  whatconverts_lead_id: number | string;
  status: string;
  match_method: string | null;
  match_confidence: number | null;
  monday_item_id: number | string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  reason: string | null;
  candidate_count?: number;
}

export interface MultiTouchExample {
  crm_lead_id_redacted: string;
  monday_item_id: number | string | null;
  touch_count: number;
  touches_in_order: Channel[];
  first_touch_channel: Channel;
  first_touch_display: string;
}

export interface DryRunReport {
  matching: {
    totalWhatConvertsLeads: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    byMethod: Record<MatchMethod, number>;
    byConfidence: Record<string, number>;
  };
  firstTouch: {
    byChannel: Record<Channel, number>;
    totalAttributed: number;
  };
  reconciliation: Reconciliation;
  /** CRM leads that got no first-touch attribution (no matched WhatConverts touch). */
  crmLeadsWithNoAttribution: number;
  /** WhatConverts leads that matched no CRM lead. */
  whatConvertsWithNoMatch: number;
  /** CRM leads with more than one matched WhatConverts touch. */
  crmLeadsWithMultipleTouchpoints: number;
  examples: {
    emailMatch: RedactedExample | null;
    phoneMatch: RedactedExample | null;
    unmatched: RedactedExample | null;
    ambiguous: RedactedExample | null;
    multiTouchFirstTouch: MultiTouchExample | null;
  };
}

// --- PII redaction ----------------------------------------------------------
function redactEmail(e: string | null): string | null {
  if (!e) return e;
  const [user, domain] = e.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}
function redactPhone(p: string | null): string | null {
  if (!p) return p;
  return p.length <= 4 ? "***" : `***${p.slice(-4)}`;
}
function redactId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function redactResult(r: MatchResult): RedactedExample {
  return {
    whatconverts_lead_id: r.whatconverts_lead_id,
    status: r.status,
    match_method: r.match_method,
    match_confidence: r.match_confidence,
    monday_item_id: r.monday_item_id,
    normalized_email: redactEmail(r.normalized_email),
    normalized_phone: redactPhone(r.normalized_phone),
    reason: r.match_reason ?? r.unmatched_reason ?? r.ambiguous_reason,
    ...(r.candidate_crm_lead_ids ? { candidate_count: r.candidate_crm_lead_ids.length } : {}),
  };
}

export function runDryRun(input: DryRunInput): DryRunReport {
  const { crmLeads, whatConvertsLeads, existingChannels = {}, options = {} } = input;

  const index = buildLeadIndex(crmLeads);
  const results = matchAll(whatConvertsLeads, index, options);

  const matched = results.filter((r) => r.status === "matched");
  const unmatched = results.filter((r) => r.status === "unmatched");
  const ambiguous = results.filter((r) => r.status === "ambiguous");

  const byMethod: Record<MatchMethod, number> = { email_phone: 0, email: 0, name_phone: 0, phone: 0 };
  const byConfidence: Record<string, number> = {};
  for (const r of matched) {
    if (r.match_method) byMethod[r.match_method] += 1;
    const key = r.match_confidence == null ? "null" : r.match_confidence.toFixed(2);
    byConfidence[key] = (byConfidence[key] ?? 0) + 1;
  }

  // Layer 2 — first touch (matched leads only).
  const wcById = new Map(whatConvertsLeads.map((w) => [String(w.lead_id), w]));
  const touches: MatchedTouch[] = matched
    .filter((r) => r.matched_crm_lead_id)
    .map((r) => ({
      crmLeadId: r.matched_crm_lead_id as string,
      mondayItemId: r.monday_item_id,
      wcLead: wcById.get(String(r.whatconverts_lead_id))!,
    }));
  const firstTouch = computeFirstTouch(touches);

  // Layer 3 — aggregate + reconcile.
  const agg = aggregateFirstTouchChannels(firstTouch);
  const reconciliation = reconcile(agg, existingChannels);

  const multi = firstTouch.find((ft) => ft.touchCount > 1) ?? null;
  const attributedLeadIds = new Set(firstTouch.map((ft) => ft.crmLeadId));

  const emailMatchR = matched.find((r) => r.match_method === "email" || r.match_method === "email_phone");
  const phoneMatchR = matched.find((r) => r.match_method === "phone" || r.match_method === "name_phone");

  return {
    matching: {
      totalWhatConvertsLeads: results.length,
      matched: matched.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      byMethod,
      byConfidence,
    },
    firstTouch: { byChannel: agg.byChannel, totalAttributed: agg.totalAttributed },
    reconciliation,
    crmLeadsWithNoAttribution: crmLeads.length - attributedLeadIds.size,
    whatConvertsWithNoMatch: unmatched.length,
    crmLeadsWithMultipleTouchpoints: firstTouch.filter((ft) => ft.touchCount > 1).length,
    examples: {
      emailMatch: emailMatchR ? redactResult(emailMatchR) : null,
      phoneMatch: phoneMatchR ? redactResult(phoneMatchR) : null,
      unmatched: unmatched.length ? redactResult(unmatched[0]) : null,
      ambiguous: ambiguous.length ? redactResult(ambiguous[0]) : null,
      multiTouchFirstTouch: multi
        ? {
            crm_lead_id_redacted: redactId(multi.crmLeadId),
            monday_item_id: multi.mondayItemId,
            touch_count: multi.touchCount,
            touches_in_order: multi.allTouchChannels,
            first_touch_channel: multi.channel,
            first_touch_display: multi.displayLabel,
          }
        : null,
    },
  };
}
