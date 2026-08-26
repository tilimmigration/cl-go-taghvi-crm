import { LANES, POST_STAGES, CADENCE } from "../data.js";

export default function PostCE() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <section
        style={{
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-sm)",
          padding: "var(--space-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          overflowX: "auto",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Post-CE stages by case type</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(3, minmax(180px,1fr))", gap: "var(--space-3)", minWidth: 720 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "subgrid",
              gridColumn: "1 / -1",
              alignItems: "end",
              paddingBottom: "var(--space-2)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>Stage</span>
            {LANES.map((l) => (
              <div key={l.name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{l.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: l.color }}>{l.urgency}</span>
              </div>
            ))}
          </div>
          {POST_STAGES.map((s) => (
            <div
              key={s.name}
              style={{
                display: "grid",
                gridTemplateColumns: "subgrid",
                gridColumn: "1 / -1",
                alignItems: "center",
                padding: "var(--space-3) 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{s.trigger}</span>
              </div>
              {s.cells.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    padding: "10px var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    background: c.bg,
                  }}
                >
                  <span style={{ fontSize: 20, fontWeight: 700, color: c.fg }}>{c.n}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.35 }}>{c.note}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-4)" }}>
        {CADENCE.map((c) => (
          <div
            key={c.name}
            style={{
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-sm)",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: c.color }}>{c.window}</span>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{c.name}</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {c.steps.map((st, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "74px 1fr",
                    gap: "var(--space-3)",
                    padding: "9px 0",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: 14,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--fg-3)" }}>{st.when}</span>
                  <span style={{ color: "var(--fg-2)" }}>{st.what}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>{c.exit}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
