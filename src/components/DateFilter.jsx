import { useEffect, useRef, useState } from "react";

// Dashboard "created on" date filter: a compact dropdown with quick presets
// plus a custom From/To range. The selected range is owned by the parent
// (App) as two "YYYY-MM-DD" strings (empty = unbounded); this component is
// just the control surface.

const PRESETS = [
  { key: "all", label: "All time" },
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

/** Inclusive {from, to} for a named preset, as YYYY-MM-DD (weeks start Monday). "all" clears both. */
function presetRange(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (today.getDay() + 6) % 7;
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

function matchesPreset(key, from, to) {
  const r = presetRange(key);
  return r.from === from && r.to === to;
}

/** The label to show on the trigger: the matching preset's name, else the raw range, else "All time". */
function currentLabel(from, to) {
  if (!from && !to) return "All time";
  const preset = PRESETS.find((p) => p.key !== "all" && matchesPreset(p.key, from, to));
  if (preset) return preset.label;
  return `${from || "earliest"} → ${to || "today"}`;
}

const DATE_INPUT_STYLE = {
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  padding: "6px 8px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xs)",
  background: "var(--surface-raised)",
  color: "var(--fg-1)",
  colorScheme: "light dark",
  width: "100%",
};

export default function DateFilter({ dateFrom, dateTo, onDateFrom, onDateTo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyPreset(key) {
    const { from, to } = presetRange(key);
    onDateFrom(from);
    onDateTo(to);
    setOpen(false);
  }

  const label = currentLabel(dateFrom, dateTo);
  const isCustom = (dateFrom || dateTo) && !PRESETS.some((p) => p.key !== "all" && matchesPreset(p.key, dateFrom, dateTo));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          padding: "8px 12px",
          minWidth: 150,
          justifyContent: "space-between",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          background: "var(--surface-raised)",
          color: "var(--fg-1)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
            Created
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </span>
        <span aria-hidden style={{ color: "var(--fg-3)", fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            width: 240,
            padding: "var(--space-2)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {PRESETS.map((p) => {
            const active = p.key === "all" ? !dateFrom && !dateTo : matchesPreset(p.key, dateFrom, dateTo);
            return (
              <button
                key={p.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => applyPreset(p.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  textAlign: "left",
                  padding: "8px 10px",
                  border: 0,
                  borderRadius: "var(--radius-xs)",
                  cursor: "pointer",
                  background: active ? "var(--surface-muted)" : "transparent",
                  color: "var(--fg-1)",
                }}
              >
                {p.label}
                {active && <span aria-hidden style={{ color: "var(--brill-navy)", fontWeight: 700 }}>✓</span>}
              </button>
            );
          })}

          <div style={{ height: 1, background: "var(--border-subtle)", margin: "6px 4px" }} />

          <div style={{ padding: "2px 6px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isCustom ? "var(--brill-navy)" : "var(--fg-3)" }}>
              Custom range
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <span style={{ width: 34 }}>From</span>
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => onDateFrom(e.target.value)} style={DATE_INPUT_STYLE} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <span style={{ width: 34 }}>To</span>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => onDateTo(e.target.value)} style={DATE_INPUT_STYLE} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
