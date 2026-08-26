import { LEADS, AI_LABELS } from "../data.js";

export default function LeadRecord({ leadKey, onSelectLead, aiTab, onAiTab, showAi }) {
  const lead = LEADS[leadKey] || LEADS.ana;
  const leadTabs = Object.keys(LEADS).map((k) => ({
    key: k,
    label: `${LEADS[k].name} · ${LEADS[k].stage}`,
  }));
  const aiRaw = lead.ai[aiTab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {leadTabs.map((t) => {
          const active = leadKey === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelectLead(t.key)}
              style={{
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 14px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                background: active ? "var(--brill-navy)" : "var(--surface-raised)",
                color: active ? "#FFFFFF" : "var(--fg-2)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: "var(--space-5)", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>{lead.name}</h2>
                <span style={{ fontSize: 14, color: "var(--fg-3)" }}>{lead.id} · merged from {lead.merged} touchpoints</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: "var(--radius-pill)", background: lead.stageBg, color: lead.stageFg }}>
                  {lead.stage}
                </span>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Owner {lead.owner}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-4) var(--space-5)" }}>
              {lead.fields.map((f) => (
                <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>{f.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{f.value}</span>
                  <span style={{ fontSize: 11, color: f.srcColor }}>{f.src}</span>
                </div>
              ))}
            </div>
          </section>

          <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Activity timeline</h2>
              <span style={{ fontSize: 13, color: "var(--fg-3)" }}>All sources, one thread</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {lead.timeline.map((e, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "96px 20px 1fr", gap: "var(--space-3)", alignItems: "start" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-3)", paddingTop: 3 }}>{e.date}</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, height: "100%" }}>
                    <span style={{ width: 11, height: 11, borderRadius: "50%", marginTop: 5, background: e.dot }} />
                    <span style={{ flex: 1, width: 2, background: "var(--border-subtle)", minHeight: 26 }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingBottom: "var(--space-4)" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)" }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{e.title}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: "var(--surface-muted)", color: "var(--fg-2)" }}>
                        {e.channel}
                      </span>
                    </div>
                    <span style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.5 }}>{e.body}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {showAi && (
          <section
            style={{
              background: "var(--brill-navy)",
              color: "var(--fg-on-dark-1)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-md)",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              position: "sticky",
              top: "var(--space-5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>AI layer</span>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Assist</h2>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: "var(--radius-pill)", border: "1px solid var(--fg-on-dark-3)", color: "var(--fg-on-dark-2)" }}>
                Phase 2
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(AI_LABELS).map((k) => {
                const active = aiTab === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onAiTab(k)}
                    style={{
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "7px 12px",
                      border: `1px solid ${active ? "var(--brill-orange)" : "var(--fg-on-dark-3)"}`,
                      borderRadius: "var(--radius-pill)",
                      cursor: "pointer",
                      background: active ? "var(--brill-orange)" : "transparent",
                      color: active ? "var(--brill-navy)" : "var(--fg-on-dark-2)",
                    }}
                  >
                    {AI_LABELS[k]}
                  </button>
                );
              })}
            </div>

            <div style={{ background: "var(--brill-navy-900)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 260 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brill-orange)" }}>{aiRaw.heading}</span>
              {aiRaw.lines.map((l, i) => (
                <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--fg-on-dark-2)" }}>{l}</p>
              ))}
              {aiRaw.hasList && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingTop: "var(--space-2)" }}>
                  {aiRaw.items.map((it, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: "var(--space-2)", fontSize: 14, lineHeight: 1.5, color: "var(--fg-on-dark-1)" }}>
                      <span style={{ color: "var(--brill-orange)", fontWeight: 700 }}>→</span>
                      <span>{it.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <span style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, padding: "11px var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--brill-blue)", color: "var(--brill-white)" }}>
                {aiRaw.cta}
              </span>
              <span style={{ textAlign: "center", fontSize: 13, fontWeight: 600, padding: "11px var(--space-4)", borderRadius: "var(--radius-md)", border: "1px solid var(--fg-on-dark-3)", color: "var(--fg-on-dark-1)" }}>
                Edit
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--fg-on-dark-3)", lineHeight: 1.5 }}>
              Nothing sends without a human. Drafts land in Alejandro's queue with the source thread attached.
            </span>
          </section>
        )}
      </div>
    </div>
  );
}
