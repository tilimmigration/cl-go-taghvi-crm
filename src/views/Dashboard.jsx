import { TF_LABELS } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { computeDashboardStats } from "../lib/dashboardStats.js";

const card = { background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" };

const BAR_COLORS = ["var(--brill-navy)", "var(--brill-orange)", "var(--brill-wine)", "var(--brill-blue)", "var(--fg-3)"];

function Breakdown({ title, entries, emptyLabel }) {
  return (
    <section style={{ ...card, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
      {entries.length === 0 ? (
        <span style={{ fontSize: 14, color: "var(--fg-3)" }}>{emptyLabel}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {entries.map((e, i) => (
            <div key={e.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", fontSize: 14 }}>
                <span style={{ fontWeight: 500 }}>{e.label}</span>
                <span style={{ color: "var(--fg-3)" }}>
                  <b style={{ color: "var(--fg-1)", fontWeight: 600 }}>{e.count}</b> · {e.pct}%
                </span>
              </div>
              <div style={{ height: 10, borderRadius: "var(--radius-pill)", background: "var(--surface-muted)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: "var(--radius-pill)", width: `${e.pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ tf }) {
  const liveLeads = useLeads();
  const tfLabel = TF_LABELS[tf];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {liveLeads.status === "loading" && (
        <div style={{ ...card, padding: "var(--space-5)" }}>
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>Loading dashboard…</span>
        </div>
      )}

      {liveLeads.status === "not_configured" && (
        <div style={{ ...card, padding: "var(--space-5)" }}>
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>
            Supabase isn't connected yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example) to enable this dashboard.
          </span>
        </div>
      )}

      {liveLeads.status === "error" && (
        <div style={{ ...card, padding: "var(--space-5)" }}>
          <span style={{ fontSize: 14, color: "var(--brill-wine)" }}>Couldn't load dashboard data: {liveLeads.error}</span>
        </div>
      )}

      {liveLeads.status === "ready" && (
        <>
          {liveLeads.leads.length === 0 ? (
            <div style={{ ...card, padding: "var(--space-5)" }}>
              <span style={{ fontSize: 14, color: "var(--fg-3)" }}>
                No leads yet. This dashboard populates automatically once Monday.com data is imported.
              </span>
            </div>
          ) : (
            (() => {
              const stats = computeDashboardStats(liveLeads.leads, tf);
              const kpis = [
                { label: "Total leads", value: stats.totalLeads },
                { label: `New leads — ${tfLabel.toLowerCase()}`, value: stats.newLeadsInPeriod },
                { label: "Total calls", value: stats.totalCalls },
                { label: "Total deals", value: stats.totalDeals },
              ];

              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "var(--space-4)" }}>
                    {kpis.map((k) => (
                      <div key={k.label} style={{ ...card, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-3)", lineHeight: 1.35 }}>{k.label}</span>
                        <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-5)" }}>
                    <Breakdown title="Leads by status" entries={stats.statusBreakdown} emptyLabel="No status data yet." />
                    <Breakdown title="Leads by type" entries={stats.typeBreakdown} emptyLabel="No lead type data yet." />
                  </div>

                  <Breakdown title="Leads by source" entries={stats.sourceBreakdown} emptyLabel="No lead source data yet." />

                  <div style={{ ...card, padding: "var(--space-4) var(--space-5)" }}>
                    <span style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>
                      This dashboard reads crm_leads/crm_calls/crm_deals directly from Supabase. Revenue, ad spend/CAC, CE booking and
                      proposal/signed tracking aren't part of the synced Monday.com data yet, so those metrics aren't shown here.
                    </span>
                  </div>
                </>
              );
            })()
          )}
        </>
      )}
    </div>
  );
}
