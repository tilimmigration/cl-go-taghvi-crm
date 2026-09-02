// Aggregates the live crm_leads / crm_calls / crm_deals rows (as returned by
// fetchLeads(), each tagged with _sourceType) into the counts the Dashboard
// can honestly show.
//
// Deliberately NOT modeled here: revenue, ad spend/CAC/CPL, CE booked/
// completed, proposals sent, contracts signed. None of that is data the
// synced Monday.com boards (Leads, Call Log Tracker, Deals) actually carry
// — there is no live equivalent to compute, so the Dashboard shows only
// what's below rather than filling those in with placeholder numbers.

const TIMEFRAME_DAYS = { week: 7, month: 30, quarter: 90 };

function withinTimeframe(record, tf) {
  const days = TIMEFRAME_DAYS[tf] ?? TIMEFRAME_DAYS.month;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(record.created_at).getTime() >= cutoff;
}

function countBy(records, field) {
  const counts = new Map();
  for (const r of records) {
    const key = (r[field] || "").trim() || "Not set";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = records.length;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * @param {Array} allRecords - the merged, _sourceType-tagged list from fetchLeads()
 * @param {"week"|"month"|"quarter"} tf
 */
export function computeDashboardStats(allRecords, tf) {
  const leads = allRecords.filter((r) => r._sourceType === "lead");
  const calls = allRecords.filter((r) => r._sourceType === "call");
  const deals = allRecords.filter((r) => r._sourceType === "deal");

  return {
    totalLeads: leads.length,
    totalCalls: calls.length,
    totalDeals: deals.length,
    newLeadsInPeriod: leads.filter((l) => withinTimeframe(l, tf)).length,
    statusBreakdown: countBy(leads, "status"),
    typeBreakdown: countBy(leads, "lead_type"),
    sourceBreakdown: countBy(leads, "lead_source"),
  };
}
