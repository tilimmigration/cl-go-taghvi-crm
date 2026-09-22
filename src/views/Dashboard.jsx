import { kpisFor, FUNNEL, CASE_TYPES, CHANNELS, ALERTS, NAVY, ORANGE, WINE } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { aggregateDealStats } from "../lib/dealStats.js";
import { isCeBookedLead } from "../lib/leads.js";

const card = { background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" };

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
  const rangeLabel = dateFrom || dateTo ? `${dateFrom || "earliest"} → ${dateTo || "today"}` : "All time";

  // Everything on this dashboard is illustrative mock data (see data.js)
  // except: the "Total unique leads" KPI tile, the CE booked/CE completed/
  // Proposals sent/Contracts signed/Revenue KPI tiles, and the funnel
  // conversion section — all swapped for real counts once Supabase has
  // responded. Case-type performance, channel performance and the alert
  // cards still need data (spend, per-case-type CE/sign tracking) we
  // don't sync from Monday, so those stay illustrative.
  //
  // CE booked sums two sources: crm_leads with status "Case evaluation
  // scheduled" (Leads board) plus crm_deals currently in the "Case
  // Evaluation Booked" group (Deals board) — the two boards aren't
  // guaranteed to stay in lockstep, so both count. CE completed/
  // proposals/signed/revenue come from the Deals board only — see
  // lib/leads.js and lib/dealStats.js.
  const ready = liveLeads.status === "ready";
  // The date filter applies to the live KPI tiles and the funnel: a record
  // counts only if it was created within the chosen range. (The case-type,
  // channel and alert sections below are still illustrative and unaffected.)
  const inRange = (l) => createdInRange(l, dateFrom, dateTo);
  const liveLeadRecords = ready ? liveLeads.leads.filter((l) => l._sourceType === "lead" && inRange(l)) : [];
  const liveLeadCount = ready ? liveLeadRecords.length : null;
  const liveDeals = ready ? liveLeads.leads.filter((l) => l._sourceType === "deal" && inRange(l)) : [];
  const dealStats = ready ? aggregateDealStats(liveDeals) : null;
  const leadsCeBookedCount = ready ? liveLeadRecords.filter(isCeBookedLead).length : null;
  const ceBookedCount = ready ? leadsCeBookedCount + dealStats.ceBooked : null;

  const liveKpiValues = ready
    ? {
        "Total unique leads": String(liveLeadCount),
        "CE booked": String(ceBookedCount),
        // "Proposal Pending Acceptance" mirrors "Proposals sent" on
        // purpose — both show the Deals board's "Pending Acceptance" group
        // count, per the client's request that the two tiles read the same.
        "Proposal Pending Acceptance": String(dealStats.proposalSent),
        "Proposals sent": String(dealStats.proposalSent),
        "Contracts signed": String(dealStats.contractSigned),
        "Revenue": `$${dealStats.revenue.toLocaleString()}`,
      }
    : {};
  const kpis = kpisFor("month").map((k) =>
    liveKpiValues[k.label] !== undefined ? { ...k, value: liveKpiValues[k.label], delta: "Live from Monday.com" } : k,
  );

  const funnel = ready ? buildLiveFunnel(liveLeadCount, ceBookedCount, dealStats) : FUNNEL;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: "var(--space-4)" }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...card, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-3)", lineHeight: 1.35 }}>{k.label}</span>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: k.color }}>{k.delta}</span>
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
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Blended CAC alongside channel CAC. Multi-touch leads keep first-touch credit.</span>
        </div>
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
          {CHANNELS.map((ch) => (
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
              <span style={{ fontWeight: ch.weight }}>{ch.name}</span>
              <span>{ch.leads}</span>
              <span>{ch.cpl}</span>
              <span>{ch.ces}</span>
              <span>{ch.cpce}</span>
              <span>{ch.signed}</span>
              <span style={{ fontWeight: 600, color: ch.cacColor }}>{ch.cac}</span>
            </div>
          ))}
        </div>
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
