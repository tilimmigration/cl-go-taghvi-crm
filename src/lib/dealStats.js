// Extracts CE booked / CE completed / proposal sent / contract signed
// from each crm_deals row's Monday GROUP — the Kanban-style stage bucket
// a deal currently sits in, already synced as monday_group_title (see
// supabase/migrations/20260903000000_calls_and_deals.sql). These four
// stages are NOT separate Monday columns on the Deals board, they are
// literal group names. Revenue, by contrast, IS a column, so it's still
// read from custom_fields (columns not covered by the shared mapper's
// DEFAULT_TITLE_MAP land there keyed by column id, as
// { title, type, text, value } — see
// supabase/functions/_shared/monday/mapper.ts).
//
// CE booked on the Dashboard is the SUM of two sources, not this file's
// ceBooked alone: crm_leads whose Status is "Case evaluation scheduled"
// (isCeBookedLead() in lib/leads.js) PLUS crm_deals currently in this
// file's "Case Evaluation Booked" group. The two boards aren't
// guaranteed to stay in lockstep (a deal can sit in that group without
// its originating lead's status still reading "scheduled"), so both are
// counted rather than picking one — see Dashboard.jsx.
//
// Group names are matched by exact title (case-insensitive, trimmed) —
// confirmed against the real Taghavi Deals board on 2026-09-03:
//   CE booked          -> "Case Evaluation Booked"
//   CE completed       -> "Case Evaluation Completed"
//   Proposal sent       -> "Proposal (ST to Review)"
//   Contracts signed    -> "Signed up"
// If the board's group names ever change, update STAGE_GROUPS below.
//
// IMPORTANT — these are CURRENT-STAGE counts (how many deals are sitting
// in that group right now), not cumulative "ever reached this stage"
// funnel counts: a deal that has since moved on to "Signed up" is no
// longer counted under "Case Evaluation Booked" even though it passed
// through it. True cumulative funnel counts would need the full ordered
// list of every group on the board (including non-funnel ones like
// "Case Evaluation Missed"/"Cancelled") to know which groups represent
// further progress vs. a dead end — we don't have that, so the
// Dashboard's funnel section reads these as a stage snapshot, not a
// strict conversion-rate funnel.

const STAGE_GROUPS = {
  ceBooked: "case evaluation booked",
  ceCompleted: "case evaluation completed",
  proposalSent: "proposal (st to review)",
  contractSigned: "signed up",
};

const REVENUE_KEYWORDS = ["revenue"];

export const FIELD_LABELS = {
  ceBooked: "CE booked",
  ceCompleted: "CE completed",
  proposalSent: "Proposal sent",
  contractSigned: "Contracts signed",
  revenue: "Revenue",
};

function findField(customFields, keywords) {
  const entries = Object.values(customFields || {}).filter((f) => f?.title);
  for (const kw of keywords) {
    const exact = entries.find((f) => f.title.trim().toLowerCase() === kw);
    if (exact) return exact;
  }
  for (const kw of keywords) {
    const partial = entries.find((f) => f.title.trim().toLowerCase().includes(kw));
    if (partial) return partial;
  }
  return null;
}

function parseCurrency(field) {
  if (!field?.text) return 0;
  const n = Number(String(field.text).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function groupOf(deal) {
  return (deal.monday_group_title || "").trim().toLowerCase();
}

/** Per-deal extraction. */
export function extractDealMetrics(deal) {
  const group = groupOf(deal);
  const revenueField = findField(deal.custom_fields, REVENUE_KEYWORDS);
  return {
    ceBooked: group === STAGE_GROUPS.ceBooked,
    ceCompleted: group === STAGE_GROUPS.ceCompleted,
    proposalSent: group === STAGE_GROUPS.proposalSent,
    contractSigned: group === STAGE_GROUPS.contractSigned,
    revenue: parseCurrency(revenueField),
    revenueFound: revenueField !== null,
  };
}

/**
 * Aggregates across all deals.
 * `unmatched` lists metric keys that show a likely naming mismatch
 * rather than a legitimately empty stage: for the four group-based
 * stages, the target group name never appeared on ANY synced deal at
 * all (vs. simply having 0 deals in it right now); for revenue, no deal
 * had a column recognizable as "Revenue".
 */
export function aggregateDealStats(deals) {
  const totals = { ceBooked: 0, ceCompleted: 0, proposalSent: 0, contractSigned: 0, revenue: 0 };
  const seenGroups = new Set(deals.map(groupOf).filter(Boolean));
  let revenueFoundAny = false;

  for (const deal of deals) {
    const m = extractDealMetrics(deal);
    if (m.ceBooked) totals.ceBooked++;
    if (m.ceCompleted) totals.ceCompleted++;
    if (m.proposalSent) totals.proposalSent++;
    if (m.contractSigned) totals.contractSigned++;
    totals.revenue += m.revenue;
    if (m.revenueFound) revenueFoundAny = true;
  }

  const unmatched = [];
  if (deals.length > 0) {
    for (const [key, groupName] of Object.entries(STAGE_GROUPS)) {
      if (!seenGroups.has(groupName)) unmatched.push(key);
    }
    if (!revenueFoundAny) unmatched.push("revenue");
  }

  return { ...totals, dealCount: deals.length, unmatched };
}
