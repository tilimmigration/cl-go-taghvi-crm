// Layer 2 — First-touch attribution logic.
//
// SEPARATE from the matching engine (Layer 1) and the dashboard aggregation
// (Layer 3). Two responsibilities, both pure:
//   1. classifyChannel(): normalize a WhatConverts lead's raw source/medium/
//      lead_type into ONE of the fixed channels below. Raw values are always
//      carried through untouched, never overwritten.
//   2. computeFirstTouch(): for each matched CRM lead, order its WhatConverts
//      touches by the real WhatConverts date_created and keep only the
//      EARLIEST one — that channel is the lead's single first-touch credit.
//      A CRM lead is therefore counted once, under its first touch, never
//      across multiple channels.

import type { WhatConvertsLeadLike } from "./matching.ts";

export const CHANNELS = ["Google Ads", "Meta Ads", "Organic", "Phone", "Referral", "Direct", "Other"] as const;
export type Channel = (typeof CHANNELS)[number];

// Dashboard display labels. Only Organic and Phone differ from the channel
// name (per spec); Referral is shown as "Referrals" to line up with the
// existing dashboard's channel table.
export const CHANNEL_DISPLAY_LABEL: Record<Channel, string> = {
  "Google Ads": "Google Ads",
  "Meta Ads": "Meta Ads",
  Organic: "Website — organic",
  Phone: "Phone — inbound",
  Referral: "Referrals",
  Direct: "Direct",
  Other: "Other",
};

const PAID_MEDIA = new Set([
  "cpc", "ppc", "paid", "paidsearch", "paid search", "paid_search",
  "paidsocial", "paid social", "paid_social", "display", "cpm", "cpv",
]);
const SEARCH_ENGINES = new Set(["google", "bing", "yahoo", "duckduckgo", "ecosia"]);
const META_SOURCES = new Set(["facebook", "meta", "instagram", "fb", "ig", "facebook.com", "instagram.com", "m.facebook.com"]);

function lc(v: unknown): string {
  return v == null ? "" : String(v).trim().toLowerCase();
}
function has(v: unknown): boolean {
  return v != null && String(v).trim() !== "";
}

export interface ChannelClassification {
  channel: Channel;
  rawSource: string | null;
  rawMedium: string | null;
  rawCampaign: string | null;
}

/**
 * Normalize one WhatConverts lead into a channel. Order matters — paid
 * signals win over the lead_type, so a Google/Meta *call* is credited to the
 * ad, not to Phone. A call with no paid signal is Phone (the dashboard's
 * "Phone — inbound"). Raw source/medium/campaign are returned untouched.
 */
export function classifyChannel(wc: WhatConvertsLeadLike): ChannelClassification {
  const src = lc(wc.lead_source);
  const med = lc(wc.lead_medium);
  const type = lc(wc.lead_type);
  const gclid = has(wc.gclid);
  const fbclid = has(wc.fbclid);
  const paid = PAID_MEDIA.has(med);
  const raw = {
    rawSource: (wc.lead_source as string | null) ?? null,
    rawMedium: (wc.lead_medium as string | null) ?? null,
    rawCampaign: (wc.lead_campaign as string | null) ?? null,
  };

  // 1. Google Ads — a Google click id, or google + a paid medium.
  if (gclid || (src.includes("google") && paid)) return { channel: "Google Ads", ...raw };
  // 2. Meta Ads — a Facebook click id, or a Meta source that's paid/social.
  if (fbclid || (META_SOURCES.has(src) && (paid || med.includes("social")))) return { channel: "Meta Ads", ...raw };
  // 3. Phone — an inbound call with no paid signal captured above.
  if (type.includes("phone") || type.includes("call")) return { channel: "Phone", ...raw };
  // 4. Organic — organic medium, or a search engine with organic/no medium.
  if (med === "organic" || src === "organic" || (SEARCH_ENGINES.has(src) && (med === "organic" || med === ""))) {
    return { channel: "Organic", ...raw };
  }
  // 5. Referral — a referral medium, or a non-search referring domain.
  if (med === "referral" || (has(wc.referral_url) && !SEARCH_ENGINES.has(src) && src !== "direct")) {
    return { channel: "Referral", ...raw };
  }
  // 6. Direct — no source, or an explicitly direct/none source/medium.
  if (src === "" || src === "direct" || src === "(direct)" || med === "direct" || med === "none" || med === "(none)") {
    return { channel: "Direct", ...raw };
  }
  // 7. Other — anything left.
  return { channel: "Other", ...raw };
}

export interface MatchedTouch {
  crmLeadId: string;
  mondayItemId: number | string | null;
  wcLead: WhatConvertsLeadLike;
}

export interface FirstTouchResult {
  crmLeadId: string;
  mondayItemId: number | string | null;
  channel: Channel;
  displayLabel: string;
  firstTouchWhatconvertsLeadId: number | string;
  firstTouchDate: string | null;
  rawSource: string | null;
  rawMedium: string | null;
  rawCampaign: string | null;
  touchCount: number;
  /** Channels of every touch for this lead, in chronological order. */
  allTouchChannels: Channel[];
}

/** ms since epoch, or +Infinity for a missing/unparseable date (sorts last). */
function touchTime(v: unknown): number {
  const t = v ? Date.parse(String(v)) : Number.NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Group matched touches by CRM lead, order each group by the real
 * WhatConverts date_created, and keep the earliest as the first touch. One
 * FirstTouchResult per CRM lead — so downstream aggregation counts each lead
 * exactly once, under the first-touch channel.
 */
export function computeFirstTouch(touches: MatchedTouch[]): FirstTouchResult[] {
  const byLead = new Map<string, MatchedTouch[]>();
  for (const t of touches) {
    const arr = byLead.get(t.crmLeadId);
    if (arr) arr.push(t);
    else byLead.set(t.crmLeadId, [t]);
  }

  const results: FirstTouchResult[] = [];
  for (const [crmLeadId, group] of byLead) {
    const sorted = [...group].sort((a, b) => touchTime(a.wcLead.date_created) - touchTime(b.wcLead.date_created));
    const first = sorted[0];
    const cls = classifyChannel(first.wcLead);
    results.push({
      crmLeadId,
      mondayItemId: first.mondayItemId,
      channel: cls.channel,
      displayLabel: CHANNEL_DISPLAY_LABEL[cls.channel],
      firstTouchWhatconvertsLeadId: first.wcLead.lead_id,
      firstTouchDate: (first.wcLead.date_created as string | null) ?? null,
      rawSource: cls.rawSource,
      rawMedium: cls.rawMedium,
      rawCampaign: cls.rawCampaign,
      touchCount: sorted.length,
      allTouchChannels: sorted.map((t) => classifyChannel(t.wcLead).channel),
    });
  }
  return results;
}
