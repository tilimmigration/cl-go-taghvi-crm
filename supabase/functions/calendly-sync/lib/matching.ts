// Email matching for the historical sync — ambiguous-aware.
//
// Matches ONLY on normalized email: lower(trim(invitee.email)) =
// lower(trim(crm_leads.email)). Never name, never phone, never fuzzy — exactly
// the rule the spec fixes. Unlike the webhook (which collapses zero/multiple to
// a null lead_id), the sync must DISTINGUISH the outcome so it can be stored:
//   matched   -> exactly one CRM lead
//   unmatched -> zero CRM leads
//   ambiguous -> two or more CRM leads (never guessed)

export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export interface CrmLeadLike {
  id: string;
  email: unknown;
  monday_item_id: number | null;
}

export interface SyncMatch {
  status: MatchStatus;
  leadId: string | null;
  mondayItemId: number | null;
}

function norm(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s && s.includes("@") ? s : null;
}

/** Index active CRM leads by normalized email → the leads sharing that email. */
export function buildLeadEmailIndex(leads: CrmLeadLike[]): Map<string, CrmLeadLike[]> {
  const idx = new Map<string, CrmLeadLike[]>();
  for (const l of leads) {
    const e = norm(l.email);
    if (!e) continue;
    const arr = idx.get(e);
    if (arr) arr.push(l);
    else idx.set(e, [l]);
  }
  return idx;
}

/**
 * Resolves a normalized invitee email against the lead index. The input email
 * is expected already normalized (from normalizeSyncEvent); it is normalized
 * again defensively so the two sides always use identical rules.
 */
export function matchEmail(index: Map<string, CrmLeadLike[]>, inviteeEmail: string | null): SyncMatch {
  const email = norm(inviteeEmail);
  if (!email) return { status: "unmatched", leadId: null, mondayItemId: null };

  const rows = index.get(email) ?? [];
  const uniqueIds = [...new Set(rows.map((r) => r.id))];

  if (uniqueIds.length === 1) {
    const lead = rows.find((r) => r.id === uniqueIds[0])!;
    return { status: "matched", leadId: lead.id, mondayItemId: lead.monday_item_id ?? null };
  }
  if (uniqueIds.length === 0) return { status: "unmatched", leadId: null, mondayItemId: null };
  return { status: "ambiguous", leadId: null, mondayItemId: null };
}
