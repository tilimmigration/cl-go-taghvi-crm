// Duplicate-detection for the Pre-CE "Deduplication queue".
//
// Pure (no I/O, no Supabase import) so the Dashboard derives candidates
// dynamically from the live crm_leads and this file is unit-tested on its own,
// exactly like lib/attribution.js. It reads ONLY the lead records the UI
// already has; it never writes anything. The human's Merge / Keep-separate
// decision is persisted separately (lib/dedupeDecisions.js) — never into
// crm_leads and never back to Monday.
//
// Matching rule (mirrors the queue's own description): email is the primary
// key, a normalised 10-digit phone the secondary. Leads that share either are
// grouped; the earliest lead in a group is the "existing record" (the
// survivor) and each later lead is a duplicate candidate paired against it.

// A group's older record is treated as a re-engagement (rather than a plain
// duplicate) when the new lead arrives at least this many days later.
export const RE_ENGAGE_GAP_DAYS = 90;

// Verdict display tones, consumed by the queue UI for colour.
export const VERDICT_TONE = { alert: "alert", warn: "warn", muted: "muted", ok: "ok" };
// Sort order for the queue: the ones a human most needs to confirm first.
const TONE_PRIORITY = { alert: 0, warn: 1, muted: 2, ok: 3 };

function displayName(lead) {
  const parts = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim();
  return parts || lead?.name || "(unnamed lead)";
}

const digitsOf = (v) => String(v ?? "").replace(/\D/g, "");

/** Normalised email (lowercased/trimmed) or null. */
export function normEmail(lead) {
  const e = String(lead?.email ?? "").trim().toLowerCase();
  return e || null;
}

/** Phone from custom_fields — crm_leads.phone is often empty; Monday keeps it
 *  in a "Phone Number" custom column ({ title, text }). Returns raw digits. */
export function customFieldPhoneDigits(lead) {
  const cf = lead?.custom_fields;
  if (!cf || typeof cf !== "object") return "";
  for (const v of Object.values(cf)) {
    const title = String(v?.title ?? "").toLowerCase();
    if (title.includes("phone")) {
      const d = digitsOf(v?.text);
      if (d.length >= 10) return d;
    }
  }
  return "";
}

/** Normalised last-10-digit phone (from the phone column or a Phone custom
 *  field), or null when neither yields at least 10 digits. */
export function normPhone(lead) {
  const a = digitsOf(lead?.phone);
  if (a.length >= 10) return a.slice(-10);
  const b = customFieldPhoneDigits(lead);
  return b.length >= 10 ? b.slice(-10) : null;
}

/** Stable, order-independent key for a pair of leads (by monday_item_id), so a
 *  decision is idempotent regardless of which side is the survivor. */
export function pairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  const lo = Math.min(x, y);
  const hi = Math.max(x, y);
  return `${lo}-${hi}`;
}

function createdMs(lead) {
  const t = Date.parse(lead?.monday_created_at || lead?.created_at || "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function isInitialName(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .some((tok) => /^[a-z]\.?$/i.test(tok));
}

function formatPhone(p10) {
  if (!p10 || p10.length !== 10) return p10 || "";
  return `(${p10.slice(0, 3)}) ${p10.slice(3, 6)}-${p10.slice(6)}`;
}

function shortDate(lead) {
  const t = Date.parse(lead?.monday_created_at || lead?.created_at || "");
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function contactLine(lead) {
  const email = normEmail(lead);
  const phone = formatPhone(normPhone(lead));
  return [email || "no email", phone].filter(Boolean).join(" · ");
}

function buildCandidate(survivor, dup, reEngageGapDays) {
  const sEmail = normEmail(survivor);
  const sPhone = normPhone(survivor);
  const emailMatch = Boolean(sEmail && sEmail === normEmail(dup));
  const phoneMatch = Boolean(sPhone && sPhone === normPhone(dup));
  const basis = emailMatch && phoneMatch ? "email_phone" : emailMatch ? "email" : "phone";

  const sName = displayName(survivor).trim().toLowerCase();
  const dName = displayName(dup).trim().toLowerCase();
  const namesMatch = Boolean(sName && dName && sName === dName);
  const dupPartial = !normEmail(dup) || isInitialName(displayName(dup));

  const gapDays = (createdMs(dup) - createdMs(survivor)) / 86_400_000;
  const staleGap = Number.isFinite(gapDays) && gapDays >= reEngageGapDays;

  let verdict;
  let verdictTone;
  let action;
  let defaultDecision;
  if (namesMatch) {
    if (staleGap) {
      verdict = "Same person — re-engagement";
      verdictTone = VERDICT_TONE.warn;
      action = "Merge and reopen";
      defaultDecision = "reopened";
    } else {
      verdict = "Same person";
      verdictTone = VERDICT_TONE.ok;
      action = "Merge";
      defaultDecision = "merged";
    }
  } else if (basis === "phone" && dupPartial) {
    verdict = "Likely same household";
    verdictTone = VERDICT_TONE.muted;
    action = "Merge";
    defaultDecision = "merged";
  } else {
    verdict = "Name differs — confirm";
    verdictTone = VERDICT_TONE.alert;
    action = "Merge";
    defaultDecision = "merged";
  }

  const basisText = basis === "email_phone" ? "Email and phone match" : basis === "email" ? "Email match" : "Phone match";
  const dates = [shortDate(survivor), shortDate(dup)].filter(Boolean);
  const dateNote = dates.length === 2 ? ` Existing ${dates[0]}, new submission ${dates[1]}.` : "";
  const nameNote = !namesMatch ? ` New record name "${displayName(dup)}".` : "";

  return {
    pairKey: pairKey(survivor.monday_item_id, dup.monday_item_id),
    survivor,
    duplicate: dup,
    survivorName: displayName(survivor),
    duplicateName: displayName(dup),
    basis,
    namesMatch,
    verdict,
    verdictTone,
    action,
    defaultDecision,
    contact: contactLine(dup),
    survivorContact: contactLine(survivor),
    matchLabel: `Matches existing record #${survivor.monday_item_id}`,
    detail: `${basisText}.${dateNote}${nameNote}`.trim(),
  };
}

/**
 * Finds duplicate candidate pairs among the given records. Only `lead`
 * records (crm_leads) with a monday_item_id are considered — calls/deals carry
 * a different board's identity. Leads are grouped by shared email OR shared
 * phone (transitively, via union-find), and within each group the earliest
 * lead is paired against every later one. Returns candidates sorted with the
 * ones most needing human confirmation first.
 */
export function detectDuplicates(rows, opts = {}) {
  const reEngageGapDays = opts.reEngageGapDays ?? RE_ENGAGE_GAP_DAYS;
  const leads = (rows || []).filter((r) => (r?._sourceType ?? "lead") === "lead" && r?.monday_item_id != null);

  const parent = leads.map((_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byEmail = new Map();
  const byPhone = new Map();
  leads.forEach((l, i) => {
    const e = normEmail(l);
    if (e) {
      if (byEmail.has(e)) union(i, byEmail.get(e));
      else byEmail.set(e, i);
    }
    const p = normPhone(l);
    if (p) {
      if (byPhone.has(p)) union(i, byPhone.get(p));
      else byPhone.set(p, i);
    }
  });

  const clusters = new Map();
  leads.forEach((_, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(leads[i]);
  });

  const candidates = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => createdMs(a) - createdMs(b));
    const survivor = sorted[0];
    for (let k = 1; k < sorted.length; k++) {
      candidates.push(buildCandidate(survivor, sorted[k], reEngageGapDays));
    }
  }

  candidates.sort((a, b) => {
    const t = (TONE_PRIORITY[a.verdictTone] ?? 9) - (TONE_PRIORITY[b.verdictTone] ?? 9);
    return t !== 0 ? t : a.survivorName.localeCompare(b.survivorName);
  });
  return candidates;
}
