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

const PRESETS = [
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "thisQuarter", label: "This quarter" },
  { key: "thisYear", label: "This year" },
];

/** Local-time YYYY-MM-DD, matching what <input type="date"> produces. */
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive {from, to} range for a named preset, as YYYY-MM-DD strings. Weeks start Monday. */
function presetRange(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (today.getDay() + 6) % 7; // days since this week's Monday
  switch (key) {
    case "thisWeek": {
      const start = new Date(today);
      start.setDate(today.getDate() - mondayOffset);
      return { from: toYMD(start), to: toYMD(today) };
    }
    case "lastWeek": {
      const start = new Date(today);
      start.setDate(today.getDate() - mondayOffset - 7);
      const end = new Date(today);
      end.setDate(today.getDate() - mondayOffset - 1);
      return { from: toYMD(start), to: toYMD(end) };
    }
    case "thisMonth":
      return { from: toYMD(new Date(today.getFullYear(), today.getMonth(), 1)), to: toYMD(today) };
    case "lastMonth":
      return {
        from: toYMD(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: toYMD(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "thisQuarter":
      return { from: toYMD(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)), to: toYMD(today) };
    case "thisYear":
      return { from: toYMD(new Date(today.getFullYear(), 0, 1)), to: toYMD(today) };
    default:
      return { from: "", to: "" };
  }
}

export default function Header({ overline, title, sub, showDateFilter, dateFrom, dateTo, onDateFrom, onDateTo }) {
  const hasRange = Boolean(dateFrom || dateTo);
  function applyPreset(key) {
    const { from, to } = presetRange(key);
    onDateFrom(from);
    onDateTo(to);
  }
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

      {showDateFilter && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 4 }}>
            {PRESETS.map((p) => {
              const r = presetRange(p.key);
              const active = hasRange && dateFrom === r.from && dateTo === r.to;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  style={{
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "6px 11px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-pill)",
                    cursor: "pointer",
                    background: active ? "var(--brill-navy)" : "var(--surface-raised)",
                    color: active ? "#FFFFFF" : "var(--fg-2)",
                    borderColor: active ? "var(--brill-navy)" : "var(--border-subtle)",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

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
        </div>
      )}
    </header>
  );
}
