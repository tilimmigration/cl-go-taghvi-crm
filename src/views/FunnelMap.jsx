import { MAP_SOURCES, MAP_STAGES, AUTOMATIONS, LANES, MAP_POST } from "../data.js";

export default function FunnelMap() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>Pre-CE</span>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>First touch → consultation booked</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "var(--space-4)" }}>
          {MAP_SOURCES.map((s) => (
            <div key={s.name} style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: 6, background: "var(--surface-muted)" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>{s.detail}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brill-blue)" }}>{s.method}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", fontSize: 20, color: "var(--brill-orange)" }}>↓</div>

        <div style={{ border: "1px solid var(--brill-navy)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: 6, textAlign: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Ingest &amp; dedupe layer</span>
          <span style={{ fontSize: 13, color: "var(--fg-2)" }}>
            Google Sheets and webhooks normalise name, email, phone, source, UTM and case type. Match on email, then 10-digit phone, before anything is created.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", fontSize: 20, color: "var(--brill-orange)" }}>↓</div>

        <div style={{ background: "var(--brill-navy)", borderRadius: "var(--radius-md)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>Monday.com — marketing leads board</span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            {MAP_STAGES.map((st) => (
              <div key={st.name} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div style={{ border: `1px solid ${st.border}`, borderRadius: "var(--radius-sm)", padding: "var(--space-3) var(--space-4)", display: "flex", flexDirection: "column", gap: 3, minWidth: 150, background: st.bg }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: st.fg }}>{st.name}</span>
                  <span style={{ fontSize: 11, color: "var(--fg-on-dark-3)" }}>{st.trigger}</span>
                </div>
                <span style={{ fontSize: 16, color: "var(--brill-orange)" }}>{st.arrow}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-4)" }}>
          {AUTOMATIONS.map((a) => (
            <div key={a.trigger} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brill-wine)" }}>{a.trigger}</span>
              {a.steps.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: "var(--space-2)", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>
                  <span style={{ color: "var(--brill-orange)" }}>→</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>Post-CE</span>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Consultation completed → signed client</h2>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ border: "1px solid var(--brill-navy)", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-6)", fontSize: 16, fontWeight: 600 }}>CE completed</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: 20, color: "var(--brill-orange)" }}>↓</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-4)" }}>
          {LANES.map((l) => (
            <div key={l.name} style={{ borderTop: `3px solid ${l.color}`, borderRadius: "var(--radius-sm)", padding: "var(--space-4) 0", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{l.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: l.color }}>{l.urgency} · {l.window}</span>
              <span style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>{l.note}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {MAP_POST.map((p) => (
            <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-4)", alignItems: "center", padding: "var(--space-4)", borderRadius: "var(--radius-sm)", background: p.bg }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: p.fg }}>{p.name}</span>
                <span style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>{p.detail}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: p.tagColor }}>{p.tag}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
