import { PHASES, ACTIONS } from "../data.js";

export default function Roadmap() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-5)", alignItems: "start" }}>
        {PHASES.map((p) => (
          <section
            key={p.name}
            style={{
              background: p.bg,
              color: p.fg,
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-sm)",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: p.tagColor }}>{p.window}</span>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{p.name}</h2>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: p.subFg }}>{p.thesis}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {p.items.map((i, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: "var(--space-2)", fontSize: 14, lineHeight: 1.5 }}>
                  <span style={{ color: p.tagColor, fontWeight: 700 }}>→</span>
                  <span>{i.text}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "auto", paddingTop: "var(--space-3)", borderTop: `1px solid ${p.rule}`, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: p.tagColor }}>Done when</span>
              <span style={{ fontSize: 14, lineHeight: 1.5 }}>{p.doneWhen}</span>
            </div>
          </section>
        ))}
      </div>

      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Open items before the build meeting</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2.4fr 1fr 1fr",
              gap: "var(--space-4)",
              paddingBottom: "var(--space-2)",
              borderBottom: "1px solid var(--border-default)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            <span>Item</span><span>Owner</span><span>Status</span>
          </div>
          {ACTIONS.map((a, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "2.4fr 1fr 1fr",
                gap: "var(--space-4)",
                padding: "var(--space-3) 0",
                borderBottom: "1px solid var(--border-subtle)",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1.45 }}>{a.item}</span>
              <span style={{ fontSize: 14, color: "var(--fg-2)" }}>{a.owner}</span>
              <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", justifySelf: "start", background: a.bg, color: a.fg }}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
