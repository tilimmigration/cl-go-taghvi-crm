import { kpisFor, FUNNEL, CASE_TYPES, CHANNELS, ALERTS, TF_LABELS, NAVY, ORANGE, WINE } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { aggregateDealStats, FIELD_LABELS } from "../lib/dealStats.js";
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

export default function Dashboard({ tf, showTargets }) {
  const liveLeads = useLeads();
  const tfLabel = TF_LABELS[tf];

  // Everything on this dashboard is illustrative mock data (see data.js)
  // except: the "Total unique leads" KPI tile, the CE booked/CE completed/
  // Proposals sent/Contracts signed/Revenue KPI tiles, and the funnel
  // conversion section — all swapped for real counts once Supabase has
  // responded. Case-type performance, channel performance and the alert
  // cards still need data (spend, per-case-type CE/sign tracking) we
  // don't sync from Monday, so those stay illustrative.
  //
  // CE booked is read from the Leads board (status "Case evaluation
  // scheduled"); CE completed/proposals/signed/revenue come from the
  // Deals board instead — see lib/leads.js and lib/dealStats.js.
  const ready = liveLeads.status === "ready";
  const liveLeadRecords = ready ? liveLeads.leads.filter((l) => l._sourceType === "lead") : [];
  const liveLeadCount = ready ? liveLeadRecords.length : null;
  const liveDeals = ready ? liveLeads.leads.filter((l) => l._sourceType === "deal") : [];
  const dealStats = ready ? aggregateDealStats(liveDeals) : null;
  const ceBookedCount = ready ? liveLeadRecords.filter(isCeBookedLead).length : null;

  const liveKpiValues = ready
    ? {
        "Total unique leads": String(liveLeadCount),
        "CE booked": String(ceBookedCount),
        "CE completed": String(dealStats.ceCompleted),
        "Proposals sent": String(dealStats.proposalSent),
        "Contracts signed": String(dealStats.contractSigned),
        "Revenue": `$${dealStats.revenue.toLocaleString()}`,
      }
    : {};
  const kpis = kpisFor(tf).map((k) =>
    liveKpiValues[k.label] !== undefined ? { ...k, value: liveKpiValues[k.label], delta: "Live from Supabase" } : k,
  );

  const funnel = ready ? buildLiveFunnel(liveLeadCount, ceBookedCount, dealStats) : FUNNEL;
  const unmatchedKeys = [
    ...(dealStats && dealStats.dealCount > 0 ? dealStats.unmatched : []),
    ...(ready && liveLeadCount > 0 && ceBookedCount === 0 ? ["ceBooked"] : []),
  ];
  const unmatchedFieldLabels = unmatchedKeys.map((k) => FIELD_LABELS[k]);

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

      {unmatchedFieldLabels.length > 0 && (
        <div style={{ ...card, padding: "var(--space-4) var(--space-5)", border: "1px solid var(--brill-orange)" }}>
          <span style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>
            Couldn't find a Monday column matching: <b>{unmatchedFieldLabels.join(", ")}</b> on any synced deal. Those figures may
            read 0 above — check the column titles on the Deals board match, or that the import has synced them.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "var(--space-5)" }}>
        <section style={{ ...card, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Funnel conversion</h2>
            <span style={{ fontSize: 13, color: "var(--fg-3)" }}>{ready ? "Live from Supabase — current stage" : tfLabel}</span>
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
