const DATE_INPUT_STYLE = {
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  padding: "6px 10px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xs)",
  background: "var(--surface-raised)",
  color: "var(--fg-1)",
  colorScheme: "light dark",
};

export default function Header({ overline, title, sub, showDateFilter, dateFrom, dateTo, onDateFrom, onDateTo }) {
  const hasRange = Boolean(dateFrom || dateTo);
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
        {showDateFilter && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 6px",
              background: "var(--surface-muted)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-3)", whiteSpace: "nowrap" }}>Created</span>
            <input
              type="date"
              aria-label="Created from"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => onDateFrom(e.target.value)}
              style={DATE_INPUT_STYLE}
            />
            <span style={{ fontSize: 13, color: "var(--fg-3)" }}>→</span>
            <input
              type="date"
              aria-label="Created to"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => onDateTo(e.target.value)}
              style={DATE_INPUT_STYLE}
            />
            <button
              type="button"
              onClick={() => {
                onDateFrom("");
                onDateTo("");
              }}
              disabled={!hasRange}
              title="Show all dates"
              style={{
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 10px",
                border: 0,
                borderRadius: "var(--radius-xs)",
                cursor: hasRange ? "pointer" : "default",
                background: hasRange ? "var(--brill-navy)" : "transparent",
                color: hasRange ? "#FFFFFF" : "var(--fg-3)",
                opacity: hasRange ? 1 : 0.5,
              }}
            >
              All
            </button>
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
