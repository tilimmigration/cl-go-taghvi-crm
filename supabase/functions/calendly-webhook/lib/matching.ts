// Lead matching by normalized email — MATCH ONLY. This never creates or
// modifies a CRM lead, and it never calls Monday. It reads crm_leads (service
// role) and returns a match only when EXACTLY ONE active lead's normalized email
// equals the invitee's. Zero matches or multiple matches → null (no guessing);
// the Calendly event is still stored, with lead_id / monday_item_id NULL.
//
// crm_leads.email is stored as Monday delivered it (unnormalized), so both sides
// are normalized (trim + lowercase) before comparison. The lead's
// monday_item_id comes from that same crm_leads row — an existing relationship,
// so no Monday API call is needed.

export interface LeadMatch {
  leadId: string;
  mondayItemId: number | null;
}

function norm(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s || null;
}

// deno-lint-ignore no-explicit-any
export async function matchLeadByEmail(supabase: any, normalizedEmail: string | null): Promise<LeadMatch | null> {
  if (!normalizedEmail) return null;

  const { data, error } = await supabase
    .from("crm_leads")
    .select("id, monday_item_id, email")
    .eq("is_deleted", false);
  if (error) throw new Error(`crm_leads read failed: ${error.message ?? String(error)}`);

  const rows = (data ?? []) as Array<{ id: string; monday_item_id: number | null; email: unknown }>;
  const matches = rows.filter((r) => norm(r.email) === normalizedEmail);

  // Distinct by lead id — exactly one unique lead is a safe association.
  const uniqueIds = [...new Set(matches.map((m) => m.id))];
  if (uniqueIds.length !== 1) return null;

  const lead = matches.find((m) => m.id === uniqueIds[0])!;
  return { leadId: lead.id, mondayItemId: lead.monday_item_id ?? null };
}
