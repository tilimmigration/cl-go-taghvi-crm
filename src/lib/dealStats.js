// Extracts CE booked / CE completed / proposal sent / contract signed
// from each crm_deals row's Monday GROUP — the Kanban-style stage bucket
// a deal currently sits in, already synced as monday_group_title (see
// supabase/migrations/20260903000000_calls_and_deals.sql). These four
// stages are NOT separate Monday columns on the Deals board, they are
// literal group names.
//
// Revenue is the summed "Contract Value" of the Signed-up deals only.
// Contract Value is a Monday FORMULA column — SUM({Monthly fee} × {Term},
// {Upfront Fee}) — and Monday's API returns formula columns empty, so we
// recompute it from the three numeric columns it references (Monthly fee,
// Term, Upfront Fee), each present in custom_fields as
// { title, type, text, value } (columns not covered by the shared mapper's
// DEFAULT_TITLE_MAP land there — see
// supabase/functions/_shared/monday/mapper.ts). Formula confirmed against
// the Deals board's column settings on 2026-09-22.
//
// CE booked on the Dashboard is the SUM of two sources, not this file's
// ceBooked alone: crm_leads whose Status is "Case evaluation scheduled"
// (isCeBookedLead() in lib/leads.js) PLUS crm_deals currently in this
// file's "Case Evaluation Booked" group. The two boards aren't
// guaranteed to stay in lockstep (a deal can sit in that group without
// its originating lead's status still reading "scheduled"), so both are
// counted rather than picking one — see Dashboard.jsx.
//
// Group names are matched by exact title (case-insensitive, trimmed).
// Mapping confirmed with the client against the real Taghavi "Deals🤝"
// board on 2026-09-21 — the four Dashboard funnel stages line up with
// these board groups, in pipeline order:
//   CE booked          -> "Case Evaluation Booked"
//   CE completed       -> "Proposal (ST to Review)"  (case evaluation is
//                          done and the proposal is in internal review)
//   Proposal sent       -> "Pending Acceptance"       (proposal is out and
//                          awaiting the client's acceptance)
//   Contracts signed    -> "Signed up"
// If the board's group names ever change, update STAGE_GROUPS below.
//
// Note: a stage reads 0 whenever no synced deal currently sits in its
// group — which can also mean the board is only partially synced (the
// bulk import can be truncated by the Edge Function time limit on a large
// board). "Proposal (ST to Review)" in particular may report 0 until a
// complete import lands its deals. Any group name that never appears on a
// synced deal is surfaced via `unmatched` so a true naming mismatch stays
// visible rather than silently reading 0.
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
  ceCompleted: "proposal (st to review)",
  proposalSent: "pending acceptance",
  contractSigned: "signed up",
};

// "Contract Value" is a Monday FORMULA column that computes
//   SUM({Monthly fee} × {Term}, {Upfront Fee})
// (confirmed against the Deals board's column settings 2026-09-22:
// SUM({numbers_1}*{numbers_2},{numbers1})). Monday's API returns formula
// columns empty, so Revenue is recomputed from the three numeric columns
// it references, matched by their (case-insensitive, trimmed) titles.
const CONTRACT_VALUE_TITLES = { monthlyFee: "monthly fee", term: "term", upfrontFee: "upfront fee" };

export const FIELD_LABELS = {
  ceBooked: "CE booked",
  ceCompleted: "CE completed",
  proposalSent: "Proposal sent",
  contractSigned: "Contracts signed",
  revenue: "Revenue",
};

/** Find a custom field by its exact (case-insensitive, trimmed) title. */
function fieldByTitle(customFields, title) {
  return Object.values(customFields || {}).find((f) => f?.title && f.title.trim().toLowerCase() === title) ?? null;
}

/** Numeric value of a custom field's text, tolerating "$1,234.50" / "" / null. */
function numberFromField(field) {
  if (!field || field.text === null || field.text === undefined || field.text === "") return 0;
  const n = Number(String(field.text).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Contract Value = Monthly fee × Term + Upfront Fee (see CONTRACT_VALUE_TITLES). */
function contractValueOf(deal) {
  const cf = deal.custom_fields;
  const monthlyFee = numberFromField(fieldByTitle(cf, CONTRACT_VALUE_TITLES.monthlyFee));
  const term = numberFromField(fieldByTitle(cf, CONTRACT_VALUE_TITLES.term));
  const upfrontFee = numberFromField(fieldByTitle(cf, CONTRACT_VALUE_TITLES.upfrontFee));
  return monthlyFee * term + upfrontFee;
}

/** Whether ANY of the Contract Value component columns is present on a deal. */
function hasContractValueFields(deal) {
  return Object.values(CONTRACT_VALUE_TITLES).some((title) => fieldByTitle(deal.custom_fields, title) !== null);
}

function groupOf(deal) {
  return (deal.monday_group_title || "").trim().toLowerCase();
}

/** Per-deal extraction. Revenue is a deal's Contract Value, but only counts
 * toward the total once the deal is in the "Signed up" group. */
export function extractDealMetrics(deal) {
  const group = groupOf(deal);
  const contractSigned = group === STAGE_GROUPS.contractSigned;
  return {
    ceBooked: group === STAGE_GROUPS.ceBooked,
    ceCompleted: group === STAGE_GROUPS.ceCompleted,
    proposalSent: group === STAGE_GROUPS.proposalSent,
    contractSigned,
    revenue: contractSigned ? contractValueOf(deal) : 0,
    revenueFound: hasContractValueFields(deal),
  };
}

/**
 * Aggregates across all deals.
 * `unmatched` lists metric keys that show a likely naming mismatch
 * rather than a legitimately empty stage: for the four group-based
 * stages, the target group name never appeared on ANY synced deal at
 * all (vs. simply having 0 deals in it right now); for revenue, no deal
 * carried any of the Contract Value component columns (Monthly fee /
 * Term / Upfront Fee), so the column titles likely changed.
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
