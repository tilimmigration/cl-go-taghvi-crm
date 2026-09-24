// Read-layer helpers for the Dashboard's Channel Performance table.
//
// Marketing attribution / first-touch channel comes from the persisted
// WhatConverts data in public.lead_attribution (the fetch lives in
// hooks/useAttribution.js). Lifecycle outcomes (CE booked, Signed) continue
// to come from the existing CRM/Monday data (crm_leads status + crm_deals
// stage groups) — this module only JOINS the two per attributed lead; it does
// not change the lifecycle logic.
//
// Pure (no I/O, no Supabase, no dependency on the mock CHANNELS data), so the
// Dashboard derives every channel number dynamically and this file is
// unit-tested on its own.

export const CHANNEL_ORDER = ["Google Ads", "Meta Ads", "Organic", "Phone", "Referral", "Direct", "Other"];

// Display labels, consistent with the existing UI.
export const CHANNEL_DISPLAY_LABEL = {
  "Google Ads": "Google Ads",
  "Meta Ads": "Meta Ads",
  Organic: "Website — organic",
  Phone: "Phone — inbound",
  Referral: "Referrals",
  Direct: "Direct",
  Other: "Other",
};

// Lifecycle signals — the SAME ones the KPI tiles use (see lib/leads.js and
// lib/dealStats.js), reused per-lead here rather than redefined.
const CE_BOOKED_STATUS = "case evaluation scheduled";
const CE_BOOKED_GROUP = "case evaluation booked";
const SIGNED_GROUP = "signed up";

const lc = (v) => (v == null ? "" : String(v).trim().toLowerCase());
const canonicalChannel = (c) => (CHANNEL_ORDER.includes(c) ? c : "Other");

function pushInto(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/**
 * First touch per attributed CRM lead. Input: lead_attribution rows. ONLY
 * matched rows with a monday_item_id are attributed — unmatched/ambiguous rows
 * (monday_item_id NULL) are excluded. Returns a Map keyed by monday_item_id
 * (string) holding the EARLIEST attribution_created_at touch for that lead
 * (ties broken by the smaller whatconverts_lead_id, matching how the persisted
 * data is ordered). So each CRM lead resolves to exactly one first-touch row.
 */
export function firstTouchByLead(rows) {
  const byLead = new Map();
  for (const r of rows || []) {
    if (r.match_status !== "matched" || r.monday_item_id == null) continue;
    const key = String(r.monday_item_id);
    const ts = r.attribution_created_at ? Date.parse(r.attribution_created_at) : Number.POSITIVE_INFINITY;
    const wcId = String(r.whatconverts_lead_id ?? "");
    const cur = byLead.get(key);
    if (!cur || ts < cur.ts || (ts === cur.ts && wcId < cur.wcId)) {
      byLead.set(key, { channel: canonicalChannel(r.channel), ts, wcId, mondayItemId: key });
    }
  }
  return byLead;
}

/** Unique first-touch CRM leads per channel + total. Each lead counted once. */
export function channelCounts(firstTouch) {
  const counts = Object.fromEntries(CHANNEL_ORDER.map((c) => [c, 0]));
  for (const ft of firstTouch.values()) counts[ft.channel] += 1;
  return { counts, total: firstTouch.size };
}

/**
 * Joins each first-touch attributed CRM lead to the existing CRM lifecycle:
 *   CE booked = crm_leads.status "case evaluation scheduled", OR a linked
 *               crm_deal currently in the "Case Evaluation Booked" group.
 *   Signed    = a linked crm_deal currently in the "Signed up" group.
 * A lead is linked to a deal by monday item id (related_lead_monday_item_id)
 * or by crm id (related_lead_id). Each lead counts once per channel.
 */
export function channelLifecycle(firstTouch, crmLeads, crmDeals) {
  const leadByMonday = new Map();
  const crmIdByMonday = new Map();
  for (const l of crmLeads || []) {
    if (l.monday_item_id == null) continue;
    leadByMonday.set(String(l.monday_item_id), l);
    crmIdByMonday.set(String(l.monday_item_id), l.id);
  }
  const dealsByMonday = new Map();
  const dealsByCrmId = new Map();
  for (const d of crmDeals || []) {
    if (d.related_lead_monday_item_id != null) pushInto(dealsByMonday, String(d.related_lead_monday_item_id), d);
    if (d.related_lead_id != null) pushInto(dealsByCrmId, d.related_lead_id, d);
  }

  const per = Object.fromEntries(CHANNEL_ORDER.map((c) => [c, { leads: 0, ces: 0, signed: 0 }]));
  for (const [mondayKey, ft] of firstTouch) {
    const bucket = per[ft.channel];
    bucket.leads += 1;
    const lead = leadByMonday.get(mondayKey);
    const crmId = crmIdByMonday.get(mondayKey);
    const deals = [...(dealsByMonday.get(mondayKey) || []), ...(crmId != null ? dealsByCrmId.get(crmId) || [] : [])];
    const groups = new Set(deals.map((d) => lc(d.monday_group_title)));
    const isCeBooked = (lead && lc(lead.status) === CE_BOOKED_STATUS) || groups.has(CE_BOOKED_GROUP);
    const isSigned = groups.has(SIGNED_GROUP);
    if (isCeBooked) bucket.ces += 1;
    if (isSigned) bucket.signed += 1;
  }
  return per;
}

/**
 * Whether the CRM lifecycle signals can actually be connected to leads in the
 * current data. CE booked is observable if any lead carries the CE status OR
 * any deal links to a lead; Signed is observable only via a linked deal. When
 * a signal isn't connectable (e.g. the deal↔lead link column isn't populated),
 * the Dashboard shows "—" for it rather than inventing a definitive 0.
 */
export function lifecycleAvailability(crmLeads, crmDeals) {
  const anyCeStatus = (crmLeads || []).some((l) => lc(l.status) === CE_BOOKED_STATUS);
  const anyDealLink = (crmDeals || []).some((d) => d.related_lead_id != null || d.related_lead_monday_item_id != null);
  return { ceAvailable: anyCeStatus || anyDealLink, signedAvailable: anyDealLink };
}

/**
 * Builds the Channel Performance table from live data. Rows are in
 * CHANNEL_ORDER with display labels; `leads` is the unique first-touch count,
 * `ces`/`signed` come from the CRM lifecycle join. `ceAvailable`/
 * `signedAvailable` say whether those signals are connectable at all in the
 * current data — when false the Dashboard renders "—" instead of 0. Spend
 * metrics are NOT included here — there is no ad-spend source, so the
 * Dashboard renders CPL / CPCE / CAC as "—". `uniqueAttributed` is the
 * invariant check target (== sum of channel `leads`).
 */
export function buildChannelTable(attrRows, crmLeads, crmDeals) {
  const firstTouch = firstTouchByLead(attrRows);
  const lifecycle = channelLifecycle(firstTouch, crmLeads, crmDeals);
  const rows = CHANNEL_ORDER.map((channel) => ({
    channel,
    label: CHANNEL_DISPLAY_LABEL[channel],
    leads: lifecycle[channel].leads,
    ces: lifecycle[channel].ces,
    signed: lifecycle[channel].signed,
  }));
  const total = rows.reduce(
    (acc, r) => ({ leads: acc.leads + r.leads, ces: acc.ces + r.ces, signed: acc.signed + r.signed }),
    { leads: 0, ces: 0, signed: 0 },
  );
  const { ceAvailable, signedAvailable } = lifecycleAvailability(crmLeads, crmDeals);
  return { rows, total, uniqueAttributed: firstTouch.size, ceAvailable, signedAvailable };
}
