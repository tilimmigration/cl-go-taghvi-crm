import { useState } from "react";
import { boardFor, DEDUPE } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { leadDisplayName, SOURCE_TYPE_LABELS } from "../lib/leads.js";

const SOURCE_TYPE_STYLES = {
  lead: { bg: "var(--brill-orange-100)", fg: "var(--brill-wine)" },
  call: { bg: "var(--brill-blue-100)", fg: "var(--brill-blue-700)" },
  deal: { bg: "var(--surface-muted)", fg: "var(--fg-2)" },
};

const LIVE_LEAD_DETAIL_FIELDS = [
  ["Lead type", "lead_type"],
  ["Lead source", "lead_source"],
  ["Stage", "stage"],
  ["Website", "website"],
  ["Address", "address"],
  ["City", "city"],
  ["State", "state"],
  ["Country", "country"],
  ["Industry", "industry"],
  ["Notes", "notes"],
];

export default function Pipeline({ showDedupeFlags, onOpenLead }) {
  const board = boardFor(showDedupeFlags);
  const liveLeads = useLeads();
  const [expandedLeadId, setExpandedLeadId] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: "var(--space-4)", alignItems: "start" }}>
        {board.map((col) => (
          <div key={col.name} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-2)",
                paddingBottom: "var(--space-2)",
                borderBottom: `2px solid ${col.accent}`,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{col.name}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "var(--radius-pill)",
                  background: "var(--surface-raised)",
                  color: "var(--fg-2)",
                  boxShadow: "var(--shadow-xs)",
                }}
              >
                {col.count}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.4 }}>{col.trigger}</span>
            {col.cards.map((card, i) => (
              <button
                key={col.name + i}
                type="button"
                onClick={() => onOpenLead(card.leadKey)}
                style={{
                  textAlign: "left",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-raised)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-xs)",
                  padding: "var(--space-3)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{card.name}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: "var(--radius-pill)",
                      background: card.caseBg,
                      color: card.caseFg,
                    }}
                  >
                    {card.case}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "3px 8px",
                      borderRadius: "var(--radius-pill)",
                      background: "var(--surface-muted)",
                      color: "var(--fg-2)",
                    }}
                  >
                    {card.source}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", fontSize: 11, color: "var(--fg-3)" }}>
                  <span>{card.age}</span>
                  <span style={{ color: card.ownerColor }}>{card.owner}</span>
                </div>
                {card.flag && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 8px",
                      borderRadius: "var(--radius-xs)",
                      background: "var(--brill-orange-100)",
                      color: "var(--brill-wine)",
                    }}
                  >
                    {card.flagText}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Deduplication queue</h2>
        <p style={{ margin: 0, fontSize: 15, color: "var(--fg-2)", lineHeight: 1.5, maxWidth: "80ch" }}>
          Email is the primary key, normalised 10-digit phone the secondary. A match appends activity to the existing record. A match with a different name stops here for a human to confirm.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {DEDUPE.map((d) => (
            <div
              key={d.name + d.matched}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.6fr 1fr auto",
                gap: "var(--space-4)",
                alignItems: "center",
                padding: "var(--space-4)",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-muted)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{d.name}</span>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{d.contact}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{d.matched}</span>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{d.detail}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>{d.verdict}</span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: "var(--radius-md)", background: "var(--brill-blue)", color: "var(--brill-white)" }}>
                  {d.action}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", color: "var(--fg-2)" }}>
                  Keep separate
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Leads (synced from Supabase)</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            Reads the crm_leads table directly. Populates automatically once Monday.com leads are imported — the board above stays illustrative until then.
          </p>
        </div>

        {liveLeads.status === "loading" && (
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>Loading leads…</span>
        )}

        {liveLeads.status === "not_configured" && (
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>
            Supabase isn't connected yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example) to enable this section.
          </span>
        )}

        {liveLeads.status === "error" && (
          <span style={{ fontSize: 14, color: "var(--brill-wine)" }}>Couldn't load leads: {liveLeads.error}</span>
        )}

        {liveLeads.status === "not_authorized" && (
          <span style={{ fontSize: 14, color: "var(--brill-wine)" }}>
            You're signed in, but this account isn't authorized to view leads. Ask Brill Media to add your email to the CRM access list.
          </span>
        )}

        {liveLeads.status === "ready" && liveLeads.leads.length === 0 && (
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>
            No leads yet. Leads will appear here automatically once Monday.com data is imported.
          </span>
        )}

        {liveLeads.status === "ready" && liveLeads.leads.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {liveLeads.leads.map((lead) => {
              const expanded = expandedLeadId === lead.id;
              const customFieldEntries = Object.entries(lead.custom_fields || {});
              const relatedLead = lead.related_lead_id ? liveLeads.leads.find((l) => l.id === lead.related_lead_id) : null;

              return (
                <div key={lead.id} style={{ display: "flex", flexDirection: "column" }}>
                  <button
                    type="button"
                    onClick={() => setExpandedLeadId(expanded ? null : lead.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr",
                      gap: "var(--space-4)",
                      alignItems: "center",
                      padding: "var(--space-4)",
                      borderRadius: expanded ? "var(--radius-sm) var(--radius-sm) 0 0" : "var(--radius-sm)",
                      background: "var(--surface-muted)",
                      border: 0,
                      fontFamily: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{leadDisplayName(lead)}</span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: "var(--radius-pill)",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            background: SOURCE_TYPE_STYLES[lead._sourceType]?.bg,
                            color: SOURCE_TYPE_STYLES[lead._sourceType]?.fg,
                          }}
                        >
                          {SOURCE_TYPE_LABELS[lead._sourceType] || "Lead"}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{lead.company || "—"}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead.email || "—"}</span>
                      <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{lead.phone || "—"}</span>
                    </div>
                    <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead.status || lead.stage || "—"}</span>
                    <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead.owner_name || "Unassigned"}</span>
                  </button>

                  {expanded && (
                    <div
                      style={{
                        padding: "var(--space-4)",
                        borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
                        background: "var(--surface-raised)",
                        border: "1px solid var(--border-subtle)",
                        borderTop: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-3)",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-3) var(--space-4)" }}>
                        {LIVE_LEAD_DETAIL_FIELDS.map(([label, key]) =>
                          lead[key] ? (
                            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                                {label}
                              </span>
                              <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead[key]}</span>
                            </div>
                          ) : null,
                        )}
                      </div>

                      {customFieldEntries.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                            Custom fields (from Monday)
                          </span>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "var(--space-3) var(--space-4)" }}>
                            {customFieldEntries.map(([columnId, field]) => (
                              <div key={columnId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-3)" }}>{field?.title || columnId}</span>
                                <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{field?.text || "—"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {lead._sourceType !== "lead" && (lead.related_lead_monday_item_id || relatedLead) && (
                        <span style={{ fontSize: 12, color: "var(--fg-2)" }}>
                          Linked to lead:{" "}
                          <span style={{ fontWeight: 600 }}>
                            {relatedLead ? leadDisplayName(relatedLead) : `Monday item ${lead.related_lead_monday_item_id} (not yet imported)`}
                          </span>
                        </span>
                      )}

                      <span style={{ fontSize: 11, color: "var(--fg-3)" }}>
                        Monday item {lead.monday_item_id} · board {lead.monday_board_id}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
