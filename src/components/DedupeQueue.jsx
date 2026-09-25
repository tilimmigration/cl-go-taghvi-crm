import { useEffect, useMemo, useState } from "react";
import { detectDuplicates } from "../lib/dedupe.js";
import { useDedupeDecisions } from "../hooks/useDedupeDecisions.js";

// The Pre-CE "Deduplication queue", driven by live crm_leads. Suspected
// duplicate pairs are detected from the data (email primary, phone secondary);
// the human's Merge / Merge-and-reopen / Keep-separate decision is recorded in
// public.lead_dedup_decisions via RLS. Read-only toward crm_leads and Monday —
// a decision is a separate, reversible record the dashboard reflects.

const VERDICT_COLOR = {
  alert: "var(--brill-wine)",
  warn: "var(--brill-orange-700)",
  muted: "var(--fg-3)",
  ok: "var(--brill-blue-700)",
};

const DECISION_LABEL = {
  merged: "Merged",
  reopened: "Merged & reopened",
  kept_separate: "Kept separate",
};

const cardStyle = {
  background: "var(--surface-raised)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "var(--space-5)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

export default function DedupeQueue({ leadRows, ready }) {
  const candidates = useMemo(() => detectDuplicates(leadRows || []), [leadRows]);
  const { status, byPair, error, decide, undo } = useDedupeDecisions();
  // Pending confirmation: { candidate, decision } while the popup is open.
  const [confirming, setConfirming] = useState(null);

  const canWrite = status === "ready";
  const pending = candidates.filter((c) => !byPair.has(c.pairKey));
  const resolved = candidates.filter((c) => byPair.has(c.pairKey));

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Deduplication queue</h2>
          {ready && candidates.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
              {pending.length} to review · {resolved.length} resolved
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 15, color: "var(--fg-2)", lineHeight: 1.5, maxWidth: "80ch" }}>
          Email is the primary key, normalised 10-digit phone the secondary. A match appends activity to the existing record. A match with a different name stops here for a human to confirm. Decisions are saved to the CRM dashboard only — never written back to Monday.com.
        </p>
      </div>

      {!ready && <span style={{ fontSize: 14, color: "var(--fg-3)" }}>Loading leads…</span>}

      {ready && candidates.length === 0 && (
        <span style={{ fontSize: 14, color: "var(--fg-3)" }}>No suspected duplicates in the current leads. New matches appear here automatically.</span>
      )}

      {status === "error" && (
        <span style={{ fontSize: 13, color: "var(--brill-wine)" }}>Couldn&apos;t load saved decisions: {error}. You can review below, but changes won&apos;t save until this resolves.</span>
      )}
      {status === "not_configured" && (
        <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Connect Supabase to save merge / keep-separate decisions.</span>
      )}

      {ready && pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {pending.map((c) => {
            const saving = byPair.get(c.pairKey)?._pending;
            return (
              <div
                key={c.pairKey}
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
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{c.duplicateName}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{c.contact}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{c.matchLabel}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{c.detail}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: VERDICT_COLOR[c.verdictTone] || "var(--fg-2)" }}>{c.verdict}</span>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button
                    type="button"
                    disabled={!canWrite || saving}
                    onClick={() => setConfirming({ candidate: c, decision: c.defaultDecision })}
                    style={{
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 14px",
                      borderRadius: "var(--radius-md)",
                      border: 0,
                      background: "var(--brill-blue)",
                      color: "var(--brill-white)",
                      cursor: canWrite && !saving ? "pointer" : "default",
                      opacity: canWrite && !saving ? 1 : 0.6,
                    }}
                  >
                    {saving ? "Saving…" : c.action}
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite || saving}
                    onClick={() => setConfirming({ candidate: c, decision: "kept_separate" })}
                    style={{
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-default)",
                      background: "var(--surface-raised)",
                      color: "var(--fg-2)",
                      cursor: canWrite && !saving ? "pointer" : "default",
                      opacity: canWrite && !saving ? 1 : 0.6,
                    }}
                  >
                    Keep separate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ready && resolved.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>Resolved</span>
          {resolved.map((c) => {
            const d = byPair.get(c.pairKey);
            return (
              <div
                key={c.pairKey}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1.6fr 1fr auto",
                  gap: "var(--space-4)",
                  alignItems: "center",
                  padding: "var(--space-3) var(--space-4)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{c.duplicateName}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{c.contact}</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{c.matchLabel}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: d?.decision === "kept_separate" ? "var(--fg-3)" : "var(--brill-blue-700)" }}>
                  {DECISION_LABEL[d?.decision] || "Resolved"}
                </span>
                <button
                  type="button"
                  disabled={!canWrite || d?._pending}
                  onClick={() => undo(c.pairKey)}
                  style={{
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "6px 12px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-default)",
                    background: "transparent",
                    color: "var(--fg-2)",
                    cursor: canWrite && !d?._pending ? "pointer" : "default",
                    opacity: canWrite && !d?._pending ? 1 : 0.6,
                  }}
                >
                  Undo
                </button>
              </div>
            );
          })}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          confirming={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            decide(confirming.candidate, confirming.decision);
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
}

function actionCopy(candidate, decision) {
  if (decision === "kept_separate") {
    return {
      title: "Keep these separate?",
      lead: "Mark these two records as different people.",
      detail: "They stay as separate leads and leave the review queue — nothing is merged. Recorded in the CRM dashboard only; Monday.com and the CRM lead records are not changed, and you can undo it.",
      confirmLabel: "Keep separate",
      primary: false,
    };
  }
  if (decision === "reopened") {
    return {
      title: "Merge and reopen?",
      lead: `Fold "${candidate.duplicateName}" into the existing record and mark it as a returning lead (re-engagement).`,
      detail: "Recorded in the CRM dashboard only; Monday.com and the CRM lead records are not changed, and you can undo it.",
      confirmLabel: "Merge and reopen",
      primary: true,
    };
  }
  return {
    title: "Merge these records?",
    lead: `Fold "${candidate.duplicateName}" into the existing record "${candidate.survivorName}".`,
    detail: "Recorded in the CRM dashboard only; Monday.com and the CRM lead records are not changed, and you can undo it.",
    confirmLabel: "Merge",
    primary: true,
  };
}

function Party({ label, name, contact }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
      <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{contact}</span>
    </div>
  );
}

// Confirmation popup shown before a Merge / Merge-and-reopen / Keep-separate
// decision is recorded. Cancel or Escape or an overlay click dismisses it.
function ConfirmDialog({ confirming, onConfirm, onCancel }) {
  const { candidate, decision } = confirming;
  const copy = actionCopy(candidate, decision);
  const keepSeparate = decision === "kept_separate";

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 20, 40, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-md)",
          padding: "var(--space-5)",
          width: "min(460px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{copy.title}</h3>
        <p style={{ margin: 0, fontSize: 14, color: "var(--fg-2)", lineHeight: 1.5 }}>{copy.lead}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--surface-muted)" }}>
          <Party label={keepSeparate ? "Record A" : "Keeps (existing)"} name={candidate.survivorName} contact={candidate.survivorContact} />
          <Party label={keepSeparate ? "Record B" : "Folds in"} name={candidate.duplicateName} contact={candidate.contact} />
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>{copy.detail}</p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
              background: "var(--surface-raised)",
              color: "var(--fg-2)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: "var(--radius-md)",
              border: 0,
              background: copy.primary ? "var(--brill-blue)" : "var(--brill-navy)",
              color: "var(--brill-white)",
              cursor: "pointer",
            }}
          >
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
