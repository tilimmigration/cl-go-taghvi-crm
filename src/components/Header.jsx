import DateFilter from "./DateFilter.jsx";

export default function Header({ overline, title, sub, showDateFilter, dateFrom, dateTo, onDateFrom, onDateTo }) {
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
        <DateFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} />
      )}
    </header>
  );
}
