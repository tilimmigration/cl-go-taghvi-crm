// Extracts CE booked / CE completed / proposal sent / contract signed /
// revenue for each crm_deals row from its custom_fields. These five
// Monday.com Deals-board columns aren't part of the shared mapper's
// DEFAULT_TITLE_MAP (see supabase/functions/_shared/monday/mapper.ts), so
// they land in custom_fields keyed by Monday column id, as
// { title, type, text, value } — same as any other unmapped column.
//
// Matched by column TITLE (case-insensitive), the same tradeoff the
// mapper itself documents: resilient to the column id being unknown
// ahead of time, but breaks if the Monday board renames these columns —
// if that happens, update the keyword lists below to match.

const FIELD_KEYWORDS = {
  ceBooked: ["ce booked", "consultation booked"],
  ceCompleted: ["ce completed", "consultation completed"],
  proposalSent: ["proposal sent"],
  contractSigned: ["contracts signed", "contract signed"],
  revenue: ["revenue"],
};

export const FIELD_LABELS = {
  ceBooked: "CE booked",
  ceCompleted: "CE completed",
  proposalSent: "Proposal sent",
  contractSigned: "Contracts signed",
  revenue: "Revenue",
};

// Values that mean "not set" even though the column has text — covers a
// Monday status/checkbox column's negative label as well as a genuinely
// empty cell.
const FALSY_TEXT = new Set(["", "no", "false", "0", "not booked", "not completed", "n/a", "-", "—", "pending", "unchecked"]);

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

function isTruthy(field) {
  if (!field) return false;
  const text = (field.text ?? "").trim().toLowerCase();
  return text.length > 0 && !FALSY_TEXT.has(text);
}

function parseCurrency(field) {
  if (!field?.text) return 0;
  const n = Number(String(field.text).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Per-deal extraction. `found` marks whether a matching column existed at all, regardless of its value. */
export function extractDealMetrics(deal) {
  const cf = deal.custom_fields || {};
  const fields = {
    ceBooked: findField(cf, FIELD_KEYWORDS.ceBooked),
    ceCompleted: findField(cf, FIELD_KEYWORDS.ceCompleted),
    proposalSent: findField(cf, FIELD_KEYWORDS.proposalSent),
    contractSigned: findField(cf, FIELD_KEYWORDS.contractSigned),
    revenue: findField(cf, FIELD_KEYWORDS.revenue),
  };
  return {
    ceBooked: isTruthy(fields.ceBooked),
    ceCompleted: isTruthy(fields.ceCompleted),
    proposalSent: isTruthy(fields.proposalSent),
    contractSigned: isTruthy(fields.contractSigned),
    revenue: parseCurrency(fields.revenue),
    found: {
      ceBooked: fields.ceBooked !== null,
      ceCompleted: fields.ceCompleted !== null,
      proposalSent: fields.proposalSent !== null,
      contractSigned: fields.contractSigned !== null,
      revenue: fields.revenue !== null,
    },
  };
}

/**
 * Aggregates across all deals. `unmatched` lists metric keys where NOT A
 * SINGLE deal had a recognizable column — a strong signal the Monday
 * board uses different column titles than the keywords above expect, so
 * the caller can surface that instead of silently showing zeros.
 */
export function aggregateDealStats(deals) {
  const totals = { ceBooked: 0, ceCompleted: 0, proposalSent: 0, contractSigned: 0, revenue: 0 };
  const foundAny = { ceBooked: false, ceCompleted: false, proposalSent: false, contractSigned: false, revenue: false };

  for (const deal of deals) {
    const m = extractDealMetrics(deal);
    if (m.ceBooked) totals.ceBooked++;
    if (m.ceCompleted) totals.ceCompleted++;
    if (m.proposalSent) totals.proposalSent++;
    if (m.contractSigned) totals.contractSigned++;
    totals.revenue += m.revenue;
    for (const key of Object.keys(foundAny)) {
      if (m.found[key]) foundAny[key] = true;
    }
  }

  const unmatched = deals.length > 0 ? Object.keys(foundAny).filter((k) => !foundAny[k]) : [];

  return { ...totals, dealCount: deals.length, unmatched };
}
