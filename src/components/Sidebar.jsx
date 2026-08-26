import { VIEWS, SOURCES } from "../data.js";

export default function Sidebar({ clientName, view, onNavigate }) {
  return (
    <aside
      style={{
        background: "var(--brill-navy)",
        color: "var(--fg-on-dark-1)",
        padding: "var(--space-6) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "0 var(--space-2)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>
          Brill Media
        </span>
        <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{clientName}</span>
        <span style={{ fontSize: 13, color: "var(--fg-on-dark-3)" }}>Unified CRM · live dashboard</span>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {Object.values(VIEWS).map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 500,
                padding: "10px var(--space-3)",
                border: 0,
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                background: active ? "var(--brill-navy-900)" : "transparent",
                color: active ? "#FFFFFF" : "var(--fg-on-dark-2)",
                transition: "background var(--duration-base) var(--ease-standard)",
              }}
            >
              <span>{item.label}</span>
              <span style={{ fontSize: 12, color: "var(--brill-orange)" }}>{active ? "→" : ""}</span>
            </button>
          );
        })}
      </nav>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-md)",
          background: "var(--brill-navy-900)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brill-orange)" }}>
          Data sources
        </span>
        {SOURCES.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", fontSize: 13, color: "var(--fg-on-dark-2)" }}>
            <span>{s.name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: s.color }}>{s.state}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
