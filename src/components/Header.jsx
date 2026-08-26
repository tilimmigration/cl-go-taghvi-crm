const TIMEFRAMES = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
];

export default function Header({ overline, title, sub, showTimeframe, tf, onTf }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-5)",
        padding: "var(--space-6) var(--space-7) var(--space-5)",
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>
          {overline}
        </span>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.25 }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 15, color: "var(--fg-3)", maxWidth: "70ch" }}>{sub}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {showTimeframe && (
          <div style={{ display: "flex", gap: 2, padding: 3, background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            {TIMEFRAMES.map((t) => {
              const active = tf === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTf(t.key)}
                  style={{
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "7px 14px",
                    border: 0,
                    borderRadius: "var(--radius-xs)",
                    cursor: "pointer",
                    background: active ? "var(--brill-navy)" : "transparent",
                    color: active ? "#FFFFFF" : "var(--fg-2)",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 12px",
            borderRadius: "var(--radius-pill)",
            background: "var(--brill-navy)",
            color: "var(--brill-white)",
          }}
        >
          Concept · not live data
        </span>
      </div>
    </header>
  );
}
