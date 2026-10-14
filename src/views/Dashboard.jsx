import { kpisFor, FUNNEL, CASE_TYPES, ALERTS, NAVY, ORANGE, WINE } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { useAttribution } from "../hooks/useAttribution.js";
import { aggregateDealStats, isCeBookedDeal } from "../lib/dealStats.js";
import { buildChannelTable } from "../lib/attribution.js";
import { isCeBookedLead, isQualifiedCall } from "../lib/leads.js";

const card = { background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" };

// The month KPI tiles that are backed by live Supabase data (not illustrative
// mock). While their data is still loading we show a shimmer skeleton instead
// of the mock number, so a fake value doesn't flash and then change.
const LIVE_KPI_LABELS = new Set([
  "Total unique leads",
  "CE booked",
  "Proposal Pending Acceptance",
  "Contracts signed",
  "Revenue",
]);

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function verdictFor(ratePct, targetPct) {
  const diff = ratePct - targetPct;
  return diff >= 0 ? "On track" : `${Math.abs(diff)} points short`;
}

/** Builds the funnel-shaped rows the UI expects (same shape as data.js's mock FUNNEL) from real counts. */
function buildLiveFunnel(totalLeads, ceBooked, deals) {
  const stages = [
    { label: "Leads → CE booked", num: ceBooked, den: totalLeads, target: 40, bar: NAVY },
    { label: "CE booked → CE completed", num: deals.ceCompleted, den: ceBooked, target: 80, bar: WINE },
    { label: "CE completed → proposal sent", num: deals.proposalSent, den: deals.ceCompleted, target: 90, bar: NAVY },
    { label: "Proposal sent → signed", num: deals.contractSigned, den: deals.proposalSent, target: 45, bar: NAVY },
    { label: "Overall lead → signed", num: deals.contractSigned, den: totalLeads, target: 10, bar: ORANGE },
  ];
  return stages.map((s) => {
    const rate = pct(s.num, s.den);
    return {
      label: s.label,
      count: `${s.num} of ${s.den}`,
      rate: `${rate}%`,
      width: `${rate}%`,
      bar: s.bar,
      target: `${s.target}%`,
      verdict: verdictFor(rate, s.target),
    };
  });
}

/**
 * True when a record's Monday creation date falls within the inclusive
 * [from, to] bounds (either may be an empty string = unbounded). Records
 * are dated by monday_created_at — the real date the lead/deal was created
 * on Monday — not created_at, which is just when our sync first stored the
 * row (import day). A record with no date is kept rather than dropped.
 */
function createdInRange(record, from, to) {
  const raw = record.monday_created_at;
  if (!raw) return true;
  const day = String(raw).slice(0, 10); // "YYYY-MM-DD"
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export default function Dashboard({ dateFrom, dateTo, showTargets }) {
  const liveLeads = useLeads();
  const attribution = useAttribution();
  const rangeLabel = dateFrom || dateTo ? `${dateFrom || "earliest"} → ${dateTo || "today"}` : "All time";

  // Everything on this dashboard is illustrative mock data (see data.js)
  // except: the "Total unique leads" KPI tile, the CE booked/Proposal Pending
  // Acceptance/Contracts signed/Revenue KPI tiles, and the funnel
  // conversion section — all swapped for real counts once Supabase has
  // responded. Case-type performance, channel performance and the alert
  // cards still need data (spend, per-case-type CE/sign tracking) we
  // don't sync from Monday, so those stay illustrative.
  //
  // The "CE booked" KPI tile counts deals in the Deals board's CE/consultation
  // pipeline groups (isCeBookedDeal) — see below. CE completed/proposals/signed/
  // revenue come from the Deals board only — see lib/dealStats.js. (The funnel
  // section keeps its own leads+deals CE-booked basis; only the tile changed.)
  const ready = liveLeads.status === "ready";
  // The date filter applies to the live KPI tiles and the funnel: a record
  // counts only if it was created within the chosen range. (The case-type,
  // channel and alert sections below are still illustrative and unaffected.)
  const inRange = (l) => createdInRange(l, dateFrom, dateTo);
  const liveLeadRecords = ready ? liveLeads.leads.filter((l) => l._sourceType === "lead" && inRange(l)) : [];
  const liveLeadCount = ready ? liveLeadRecords.length : null;
  const liveDeals = ready ? liveLeads.leads.filter((l) => l._sourceType === "deal" && inRange(l)) : [];
  const dealStats = ready ? aggregateDealStats(liveDeals) : null;
  // Funnel basis (unchanged): crm_leads with status "Case evaluation scheduled"
  // plus crm_deals currently in the single "Case Evaluation Booked" group.
  const leadsCeBookedCount = ready ? liveLeadRecords.filter(isCeBookedLead).length : null;
  const ceBookedCount = ready ? leadsCeBookedCount + dealStats.ceBooked : null;

  // "CE booked" KPI tile = deals that have BOOKED a case evaluation, i.e. every
  // deal sitting in the Deals board's CE/consultation pipeline groups
  // (isCeBookedDeal — Case Evaluation Booked/Missed/Cancelled/Follow Up Required,
  // Consultation Required/Sent/Booked, Proposal (ST to review), Pending
  // Acceptance, Signed up). Per the team's definition this is the whole attached
  // pipeline, since a deal only reaches this board by booking a CE. Scoped to the
  // dashboard's Created date range like the other live tiles. (Only this tile
  // uses the pipeline-groups count; the funnel above keeps its own basis.)
  const ceBookedDealsCount = ready ? liveDeals.filter(isCeBookedDeal).length : null;

  // "Total unique leads" KPI = three Monday boards combined, per the team's
  // definition:
  //   • Lead Tracker  (crm_leads  / _sourceType "lead") — ALL groups
  //   • Deals         (crm_deals  / _sourceType "deal") — ALL groups
  //   • Call Leads    (crm_calls  / _sourceType "call") — ONLY rows marked
  //     "Qualified Leads" (isQualifiedCall), not every call log
  // Each table is fed by exactly one Monday board (see 20260903000000_calls_and_
  // deals.sql), so filtering by _sourceType is equivalent to selecting that
  // board's rows. All three are scoped to the dashboard's Created date range.
  // This is a straight SUM of the three boards, not cross-board de-duplication —
  // the same person appearing as both a lead and a deal is counted in each,
  // matching how the tile previously summed leads + call logs. The funnel
  // denominators below deliberately stay leads-only, so lead→CE→signed rates
  // aren't diluted by deal/call volume.
  const liveDealCount = ready ? liveDeals.length : null;
  const liveQualifiedCallCount = ready
    ? liveLeads.leads.filter((l) => l._sourceType === "call" && inRange(l) && isQualifiedCall(l)).length
    : null;
  const totalUniqueLeads = ready ? liveLeadCount + liveDealCount + liveQualifiedCallCount : null;

  const liveKpiValues = ready
    ? {
        "Total unique leads": String(totalUniqueLeads),
        "CE booked": String(ceBookedDealsCount),
        // "Proposal Pending Acceptance" shows the Deals board's "Pending
        // Acceptance" group count.
        "Proposal Pending Acceptance": String(dealStats.proposalSent),
        "Contracts signed": String(dealStats.contractSigned),
        "Revenue": `$${dealStats.revenue.toLocaleString()}`,
      }
    : {};
  // Per-tile subtitle overrides; other live tiles keep the generic label.
  const liveKpiDeltas = ready
    ? {
        "Total unique leads": `${liveLeadCount} leads · ${liveDealCount} deals · ${liveQualifiedCallCount} qual. calls`,
        "CE booked": "Live from Deals — pipeline groups",
      }
    : {};
  // Every month KPI is backed by live data, so while it is still loading we show
  // a skeleton rather than the mock number (which would otherwise flash and then
  // change under the user). When Supabase itself isn't connected (not_configured /
  // error / not_authorized, i.e. not "loading"), we keep the illustrative mock
  // numbers instead of a perpetual loader — the demo fallback, unchanged.
  const kpis = kpisFor("month").map((k) => {
    if (!LIVE_KPI_LABELS.has(k.label)) return k;
    if (liveLeads.status === "loading") return { ...k, loading: true };
    if (!ready) return k;
    return { ...k, value: liveKpiValues[k.label] ?? k.value, delta: liveKpiDeltas[k.label] || "Live from Monday.com" };
  });

  const funnel = ready ? buildLiveFunnel(liveLeadCount, ceBookedCount, dealStats) : FUNNEL;

  // Channel performance — real first-touch attribution from lead_attribution
  // (Layer: WhatConverts), joined to the existing CRM lifecycle for CE/Signed.
  // Date-filtered just like the KPIs and funnel: it uses the SAME in-range
  // lead/deal sets (liveLeadRecords/liveDeals) AND restricts the WhatConverts
  // touches to those whose matched lead is in range — the per-channel "Leads"
  // count is driven by the attribution rows, so both must be scoped for the
  // table to reflect the selected range and still reconcile to the in-range
  // unique attributed CRM-lead count. Spend metrics (CPL/CPCE/CAC) have no
  // source and render as "—".
  const attrReady = attribution.status === "ready";
  const inRangeLeadMondayIds = new Set(
    liveLeadRecords.map((l) => (l.monday_item_id != null ? String(l.monday_item_id) : null)).filter(Boolean),
  );
  const inRangeAttrRows = attrReady
    ? attribution.rows.filter((r) => r.monday_item_id != null && inRangeLeadMondayIds.has(String(r.monday_item_id)))
    : [];
  const channelTable = attrReady && ready ? buildChannelTable(inRangeAttrRows, liveLeadRecords, liveDeals) : null;
  const channelRows = channelTable
    ? [
        ...channelTable.rows.map((r) => ({ name: r.label, leads: r.leads, ces: r.ces, signed: r.signed, weight: 500, isTotal: false, muted: false })),
        // Full accounting: leads with no matched WhatConverts touch, so the
        // channels (attributed) + this row reconcile to every CRM lead.
        { name: "No WhatConverts match", leads: channelTable.unattributed, ces: null, signed: null, weight: 500, isTotal: false, muted: true },
        { name: "Total leads", leads: channelTable.totalLeads, ces: channelTable.total.ces, signed: channelTable.total.signed, weight: 700, isTotal: true, muted: false },
      ]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: "var(--space-4)" }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...card, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-3)", lineHeight: 1.35 }}>{k.label}</span>
            {k.loading ? (
              <span className="kpi-skeleton" role="status" aria-label={`Loading ${k.label}`} style={{ width: 92, height: 30, marginTop: 1 }} />
            ) : (
              <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</span>
            )}
            {k.loading ? (
              <span className="kpi-skeleton" aria-hidden="true" style={{ width: 64, height: 12 }} />
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: k.color }}>{k.delta}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "var(--space-5)" }}>
        <section style={{ ...card, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Funnel conversion</h2>
            <span style={{ fontSize: 13, color: "var(--fg-3)" }}>{ready ? `Live · current stage · ${rangeLabel}` : rangeLabel}</span>
          </div>
          {ready && (
            <span style={{ fontSize: 12, color: "var(--fg-3)", marginTop: -8 }}>
              Counts reflect deals currently sitting in each Monday stage/group, not cumulative historical conversion.
            </span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {funnel.map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", fontSize: 14 }}>
                  <span style={{ fontWeight: 500 }}>{f.label}</span>
                  <span style={{ color: "var(--fg-3)" }}>
                    <b style={{ color: "var(--fg-1)", fontWeight: 600 }}>{f.count}</b> · {f.rate}
                  </span>
                </div>
                <div style={{ height: 10, borderRadius: "var(--radius-pill)", background: "var(--surface-muted)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: "var(--radius-pill)", width: f.width, background: f.bar }} />
                </div>
                {showTargets && (
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    Target {f.target} · {f.verdict}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...card, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Case type performance</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {CASE_TYPES.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr repeat(4, minmax(0,1fr))",
                  gap: "var(--space-3)",
                  alignItems: "center",
                  padding: "var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--surface-muted)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: c.urgencyColor }}>{c.urgency}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "var(--fg-3)" }}>Leads</span>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{c.leads}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "var(--fg-3)" }}>CE rate</span>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{c.ceRate}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "var(--fg-3)" }}>Sign rate</span>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{c.signRate}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "var(--fg-3)" }}>Days to sign</span>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{c.days}</span>
                </div>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>
            Timelines match the urgency bands in the scope: deportation signs in days, employment in months. Compare each channel against the case types it actually produces.
          </p>
        </section>
      </div>

      <section style={{ ...card, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Channel performance — first touch</h2>
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}>
            {attrReady
              ? `First touch from WhatConverts · unique CRM leads · ${rangeLabel}`
              : attribution.status === "error"
                ? "Attribution unavailable"
                : "Loading attribution…"}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "var(--fg-3)", marginTop: -8 }}>
          Leads are unique CRM leads by their earliest WhatConverts touch (each counted once). CE and Signed come from the CRM/Monday lifecycle where the deal-to-lead link is available; cost metrics (CPL, CPCE, CAC) have no ad-spend source. Unavailable values show “—”.
        </span>
        {channelTable ? (
          <>
          <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
            {`${channelTable.uniqueAttributed} of ${channelTable.totalLeads} leads have a WhatConverts first touch · ${channelTable.unattributed} with no matched WhatConverts touch`}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(6, minmax(0,1fr))", gap: 0, fontSize: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "subgrid",
                gridColumn: "1 / -1",
                paddingBottom: "var(--space-2)",
                borderBottom: "1px solid var(--border-default)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
              }}
            >
              <span>Channel</span><span>Leads</span><span>CPL</span><span>CEs</span><span>CPCE</span><span>Signed</span><span>CAC</span>
            </div>
            {channelRows.map((ch) => (
              <div
                key={ch.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "subgrid",
                  gridColumn: "1 / -1",
                  padding: "var(--space-3) 0",
                  borderBottom: "1px solid var(--border-subtle)",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: ch.weight, color: ch.muted ? "var(--fg-3)" : undefined }}>{ch.name}</span>
                <span style={{ fontWeight: ch.isTotal ? 700 : 400 }}>{ch.leads}</span>
                <span style={{ color: "var(--fg-3)" }}>—</span>
                <span style={channelTable.ceAvailable && !ch.muted ? undefined : { color: "var(--fg-3)" }}>{channelTable.ceAvailable && !ch.muted && ch.ces != null ? ch.ces : "—"}</span>
                <span style={{ color: "var(--fg-3)" }}>—</span>
                <span style={channelTable.signedAvailable && !ch.muted ? undefined : { color: "var(--fg-3)" }}>{channelTable.signedAvailable && !ch.muted && ch.signed != null ? ch.signed : "—"}</span>
                <span style={{ color: "var(--fg-3)" }}>—</span>
              </div>
            ))}
          </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            {attribution.status === "error" ? "Channel attribution is temporarily unavailable." : "Loading channel attribution…"}
          </p>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-4)" }}>
        {ALERTS.map((a) => (
          <div
            key={a.tag}
            style={{
              background: "var(--brill-navy)",
              color: "var(--fg-on-dark-1)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>{a.tag}</span>
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>{a.title}</span>
            <span style={{ fontSize: 14, color: "var(--fg-on-dark-2)", lineHeight: 1.5 }}>{a.body}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
