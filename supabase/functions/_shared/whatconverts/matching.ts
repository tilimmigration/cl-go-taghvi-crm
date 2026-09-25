// Layer 1 — Matching engine (read-only / dry-run).
//
// Matches WhatConverts leads to existing crm_leads. SEPARATE from first-touch
// attribution (Layer 2) and dashboard aggregation (Layer 3). Pure: it takes
// already-fetched crm_leads + WhatConverts leads and returns a decision per
// WhatConverts lead. It NEVER writes to crm_leads or lead_attribution, and
// never auto-resolves an ambiguous match.
//
// Priority (highest-confidence match wins for a resolved lead):
//   email + phone  (0.99)  both identifiers agree on one lead
//   email          (0.95)  exact normalized email
//   name + phone   (0.90)  phone agrees and the name agrees too
//   phone          (0.85)  exact normalized phone
// Name is NEVER used alone — it only strengthens or disambiguates a phone
// match. When more than one CRM lead remains after date filtering and can't
// be narrowed by a stronger identifier, the result is `ambiguous` and no
// lead is chosen.

import { normalizeEmail, normalizeName, normalizePhone } from "./normalize.ts";

export interface CrmLeadLike {
  id: string;
  monday_item_id: number | string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  custom_fields?: Record<string, { title?: string | null; type?: string | null; text?: string | null; value?: unknown }> | null;
  raw_column_values?: Array<{ id?: string; title?: string | null; type?: string | null; text?: string | null; column?: { title?: string | null } | null }> | null;
  monday_created_at?: string | null;
}

export interface WhatConvertsLeadLike {
  lead_id: number | string;
  date_created?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  contact_name?: string | null;
  lead_type?: string | null;
  lead_source?: string | null;
  lead_medium?: string | null;
  lead_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  referral_url?: string | null;
  [k: string]: unknown;
}

export const MATCH_CONFIDENCE = {
  email_phone: 0.99,
  email: 0.95,
  name_phone: 0.9,
  phone: 0.85,
} as const;
export type MatchMethod = keyof typeof MATCH_CONFIDENCE;

export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export interface MatchResult {
  whatconverts_lead_id: number | string;
  matched_crm_lead_id: string | null;
  monday_item_id: number | string | null;
  match_method: MatchMethod | null;
  match_confidence: number | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  status: MatchStatus;
  match_reason: string | null;
  unmatched_reason: string | null;
  ambiguous_reason: string | null;
  candidate_crm_lead_ids?: string[];
}

export interface MatchOptions {
  /** WhatConverts touch may be at most this many days BEFORE the CRM lead's created date. */
  toleranceDaysBefore?: number;
  /** ...and at most this many days AFTER. Outside the window a candidate is dropped. */
  toleranceDaysAfter?: number;
}
const DEFAULT_TOLERANCE: Required<MatchOptions> = { toleranceDaysBefore: 365, toleranceDaysAfter: 365 };

// crm_leads.phone is empty on the live board; the real phone lives in
// custom_fields under the title "Phone Number" (276/277 leads). Extraction
// therefore falls through: dedicated column -> custom_fields -> raw_column_values.
const PHONE_TITLE_RE = /(phone|mobile|cell|tel\b|contact ?number|whatsapp)/i;
const EMAIL_TITLE_RE = /e-?mail/i;

export function crmEmailOf(lead: CrmLeadLike): string | null {
  if (lead.email) return String(lead.email);
  for (const f of Object.values(lead.custom_fields ?? {})) {
    if (f?.text && f.title && EMAIL_TITLE_RE.test(f.title)) return String(f.text);
  }
  return null;
}

export function crmPhoneOf(lead: CrmLeadLike): string | null {
  if (lead.phone) return String(lead.phone);
  for (const f of Object.values(lead.custom_fields ?? {})) {
    if (f?.text && ((f.title && PHONE_TITLE_RE.test(f.title)) || f.type === "phone")) return String(f.text);
  }
  for (const cv of lead.raw_column_values ?? []) {
    const title = cv?.column?.title ?? cv?.title ?? null;
    if (cv?.text && ((title && PHONE_TITLE_RE.test(title)) || cv.type === "phone")) return String(cv.text);
  }
  return null;
}

export function crmNameOf(lead: CrmLeadLike): string | null {
  const parts = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return parts || lead.name || null;
}

export interface LeadIndex {
  byEmail: Map<string, CrmLeadLike[]>;
  byPhone: Map<string, CrmLeadLike[]>;
  phoneByLeadId: Map<string, string | null>;
  nameByLeadId: Map<string, string | null>;
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function buildLeadIndex(crmLeads: CrmLeadLike[]): LeadIndex {
  const byEmail = new Map<string, CrmLeadLike[]>();
  const byPhone = new Map<string, CrmLeadLike[]>();
  const phoneByLeadId = new Map<string, string | null>();
  const nameByLeadId = new Map<string, string | null>();
  for (const lead of crmLeads) {
    const e = normalizeEmail(crmEmailOf(lead));
    const p = normalizePhone(crmPhoneOf(lead));
    phoneByLeadId.set(lead.id, p);
    nameByLeadId.set(lead.id, normalizeName(crmNameOf(lead)));
    if (e) pushTo(byEmail, e, lead);
    if (p) pushTo(byPhone, p, lead);
  }
  return { byEmail, byPhone, phoneByLeadId, nameByLeadId };
}

function parseDate(v: unknown): number | null {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** True if the WhatConverts touch falls within the tolerance window around the CRM lead's created date. Unknown dates never exclude. */
function withinTolerance(wcMs: number | null, crmCreated: unknown, opts: Required<MatchOptions>): boolean {
  const crmMs = parseDate(crmCreated);
  if (wcMs === null || crmMs === null) return true;
  const day = 86_400_000;
  const before = wcMs < crmMs ? (crmMs - wcMs) / day : 0;
  const after = wcMs > crmMs ? (wcMs - crmMs) / day : 0;
  return before <= opts.toleranceDaysBefore && after <= opts.toleranceDaysAfter;
}

/**
 * Match a single WhatConverts lead against the CRM index. Returns a full
 * decision record; on `ambiguous` it lists candidate ids and picks nothing.
 */
export function matchWhatConvertsLead(wc: WhatConvertsLeadLike, index: LeadIndex, options: MatchOptions = {}): MatchResult {
  const opts = { ...DEFAULT_TOLERANCE, ...options };
  const E = normalizeEmail(wc.email_address);
  const P = normalizePhone(wc.phone_number);
  const N = normalizeName(wc.contact_name);
  const wcMs = parseDate(wc.date_created);

  const base: MatchResult = {
    whatconverts_lead_id: wc.lead_id,
    matched_crm_lead_id: null,
    monday_item_id: null,
    match_method: null,
    match_confidence: null,
    normalized_email: E,
    normalized_phone: P,
    status: "unmatched",
    match_reason: null,
    unmatched_reason: null,
    ambiguous_reason: null,
  };

  if (!E && !P) return { ...base, unmatched_reason: "WhatConverts lead has no usable email or phone" };

  const emailAll = E ? index.byEmail.get(E) ?? [] : [];
  const phoneAll = P ? index.byPhone.get(P) ?? [] : [];
  const emailCands = emailAll.filter((c) => withinTolerance(wcMs, c.monday_created_at, opts));
  const phoneCands = phoneAll.filter((c) => withinTolerance(wcMs, c.monday_created_at, opts));

  const matched = (lead: CrmLeadLike, method: MatchMethod, reason: string): MatchResult => ({
    ...base,
    status: "matched",
    matched_crm_lead_id: lead.id,
    monday_item_id: lead.monday_item_id ?? null,
    match_method: method,
    match_confidence: MATCH_CONFIDENCE[method],
    match_reason: reason,
  });

  // Priority 1 / 3 — email, upgraded to email+phone when the phone agrees.
  if (emailCands.length === 1) {
    const le = emailCands[0];
    const phoneAgrees = P !== null && index.phoneByLeadId.get(le.id) === P;
    return phoneAgrees
      ? matched(le, "email_phone", "exact normalized email and phone")
      : matched(le, "email", "exact normalized email");
  }
  if (emailCands.length > 1) {
    const inter = phoneCands.length ? emailCands.filter((c) => phoneCands.includes(c)) : [];
    if (inter.length === 1) return matched(inter[0], "email_phone", `email matched ${emailCands.length} leads; phone narrowed to 1`);
    return {
      ...base,
      status: "ambiguous",
      ambiguous_reason: `email matches ${emailCands.length} CRM leads and phone did not narrow to one`,
      candidate_crm_lead_ids: emailCands.map((c) => c.id),
    };
  }

  // Priority 2 / 4 — phone, upgraded to name+phone when the name agrees.
  if (P !== null) {
    if (phoneCands.length === 1) {
      const lp = phoneCands[0];
      const nameAgrees = N !== null && index.nameByLeadId.get(lp.id) === N;
      return nameAgrees
        ? matched(lp, "name_phone", "exact normalized phone and name")
        : matched(lp, "phone", "exact normalized phone");
    }
    if (phoneCands.length > 1) {
      const nameMatches = N ? phoneCands.filter((c) => index.nameByLeadId.get(c.id) === N) : [];
      if (nameMatches.length === 1) return matched(nameMatches[0], "name_phone", `phone matched ${phoneCands.length} leads; name narrowed to 1`);
      return {
        ...base,
        status: "ambiguous",
        ambiguous_reason: `phone matches ${phoneCands.length} CRM leads${N ? "; name did not narrow to one" : "; no name to disambiguate"}`,
        candidate_crm_lead_ids: phoneCands.map((c) => c.id),
      };
    }
  }

  // No candidate survived. Distinguish "found but out of date window" from "nothing matched".
  if (emailAll.length + phoneAll.length > 0) {
    return { ...base, unmatched_reason: "matching contact found but outside the date tolerance window" };
  }
  return { ...base, unmatched_reason: "no CRM lead with a matching email or phone" };
}

/** Convenience: match every WhatConverts lead. */
export function matchAll(wcLeads: WhatConvertsLeadLike[], index: LeadIndex, options: MatchOptions = {}): MatchResult[] {
  return wcLeads.map((wc) => matchWhatConvertsLead(wc, index, options));
}
