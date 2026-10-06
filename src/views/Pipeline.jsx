import { useMemo, useState } from "react";
import { boardFor } from "../data.js";
import { useLeads } from "../hooks/useLeads.js";
import { useAttribution } from "../hooks/useAttribution.js";
import { useCalendly } from "../hooks/useCalendly.js";
import { leadDisplayName, SOURCE_TYPE_LABELS } from "../lib/leads.js";
import { firstTouchByLead, CHANNEL_DISPLAY_LABEL } from "../lib/attribution.js";
import DedupeQueue from "../components/DedupeQueue.jsx";

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
  // First-touch marketing source per lead, joined at read time from the
  // persisted WhatConverts attribution (public.lead_attribution). Read-only:
  // crm_leads is never written to (Monday's full-row upsert would clobber it),
  // so the source is displayed here from the same source of truth the
  // Dashboard's Channel Performance table uses, keyed by monday_item_id.
  const attribution = useAttribution();
  const attrReady = attribution.status === "ready";
  const firstTouchByMonday = useMemo(() => firstTouchByLead(attribution.rows || []), [attribution.rows]);
  // Calendly bookings (read-only, from calendly_events), used to surface a
  // lead's CE as "CE Booked" in the status column below, matched by email.
  // crm_leads.status itself is never written — Monday's full-row upsert would
  // clobber it (which is exactly why these matched leads still read "Booked"
  // from Monday) — so the "CE Booked" label is derived here at read time, the
  // same pattern the WhatConverts source uses. Survives every Monday re-sync.
  const calendly = useCalendly();
  const calendlyBookedEmails = useMemo(() => {
    const set = new Set();
    if (calendly.status !== "ready") return set;
    for (const r of calendly.rows) {
      if ((r.status || "") === "booked" && r.invitee_email) set.add(String(r.invitee_email).trim().toLowerCase());
    }
    return set;
  }, [calendly.status, calendly.rows]);
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

      <DedupeQueue leadRows={liveLeads.leads} ready={liveLeads.status === "ready"} />

      <section style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Leads (synced from Supabase)</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            Reads the crm_leads table directly. Populates automatically once Monday.com leads are imported — the board above stays illustrative until then. Each lead also shows its WhatConverts first-touch source, joined at read time from the attribution data (nothing is written back to the CRM record).
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
              // First-touch attribution for this lead. Attribution is keyed by
              // the Leads-board monday_item_id, so only lead rows can match;
              // calls/deals carry a different board's item id.
              const attrMatch = lead._sourceType === "lead" && lead.monday_item_id != null ? firstTouchByMonday.get(String(lead.monday_item_id)) ?? null : null;
              // A lead with a matching Calendly booking is shown as "CE Booked"
              // in the status column, whatever the raw Monday status reads (for
              // these it still reads "Booked" because the Monday sync overwrites
              // any status we'd write back). Only lead rows are relabelled —
              // calls/deals keep their own stage, which sits further down the
              // funnel and must not be pulled back to "CE Booked".
              const ceBookedFromCalendly =
                lead._sourceType === "lead" &&
                Boolean(lead.email) &&
                calendlyBookedEmails.has(String(lead.email).trim().toLowerCase());
              const attrChannel = attrMatch?.channel ?? null;
              const attrChannelLabel = attrChannel ? CHANNEL_DISPLAY_LABEL[attrChannel] || attrChannel : null;
              // The literal WhatConverts "Lead source" for the pill and detail —
              // falls back to the channel bucket only if the raw source is blank.
              const attrSourceLabel = attrMatch ? attrMatch.source || attrChannelLabel : null;
              // Detail cells for the expanded row's WhatConverts block.
              const wcCells =
                lead._sourceType !== "lead"
                  ? []
                  : !attrReady
                    ? [{ label: "First-touch source (WhatConverts)", value: "Loading…", muted: true }]
                    : attrMatch
                      ? [
                          { label: "Lead source (WhatConverts)", value: attrMatch.source || "—", muted: false },
                          ...(attrMatch.medium ? [{ label: "Medium", value: attrMatch.medium, muted: false }] : []),
                          ...(attrMatch.campaign ? [{ label: "Campaign", value: attrMatch.campaign, muted: false }] : []),
                          { label: "First-touch channel", value: attrChannelLabel || "—", muted: false },
                        ]
                      : [{ label: "First-touch source (WhatConverts)", value: "No WhatConverts match", muted: true }];

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
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{lead.company || "—"}</span>
                        {attrReady && attrSourceLabel && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "1px 7px",
                              borderRadius: "var(--radius-pill)",
                              border: "1px solid var(--border-default)",
                              color: "var(--fg-2)",
                            }}
                            title="Lead source (WhatConverts first touch)"
                          >
                            {attrSourceLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead.email || "—"}</span>
                      <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{lead.phone || "—"}</span>
                    </div>
                    {ceBookedFromCalendly ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          justifySelf: "start",
                          padding: "3px 8px",
                          borderRadius: "var(--radius-pill)",
                          background: "var(--brill-orange-100)",
                          color: "var(--brill-wine)",
                        }}
                        title="CE Booked — matched to a Calendly booking"
                      >
                        CE Booked
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{lead.status || lead.stage || "—"}</span>
                    )}
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
                        {wcCells.map((c) => (
                          <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                              {c.label}
                            </span>
                            <span style={{ fontSize: 13, color: c.muted ? "var(--fg-3)" : "var(--fg-2)" }}>{c.value}</span>
                          </div>
                        ))}
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
