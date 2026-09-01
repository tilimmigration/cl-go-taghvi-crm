// Data-access layer for public.crm_leads / crm_calls / crm_deals. This is
// the only module the UI should import to read them — keeps the query,
// column lists and display-name fallback logic in one place.
//
// The CRM UI shows records from all three tables together in one list
// (each tagged with `_sourceType`), even though they're stored
// separately — a Lead, a Call and a Deal are different entities with
// their own Monday identity, but the Leads page is where the team wants
// to see all of them.

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

const LEAD_COLUMNS = [
  "id",
  "monday_board_id",
  "monday_item_id",
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "website",
  "address",
  "lead_type",
  "lead_source",
  "status",
  "stage",
  "owner_name",
  "city",
  "state",
  "country",
  "industry",
  "notes",
  "custom_fields",
  "created_at",
  "updated_at",
].join(", ");

const LINKED_RECORD_COLUMNS = [
  "id",
  "monday_board_id",
  "monday_item_id",
  "name",
  "email",
  "phone",
  "company",
  "status",
  "owner_name",
  "related_lead_id",
  "related_lead_monday_item_id",
  "custom_fields",
  "created_at",
  "updated_at",
].join(", ");

async function fetchTable(table, columns) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  return { data: data ?? [], error };
}

/**
 * Fetches active (non-deleted) records from crm_leads, crm_calls and
 * crm_deals, merged into one list sorted newest-first, each tagged with
 * `_sourceType` ("lead" | "call" | "deal").
 *
 * Returns `{ leads, error, configured }` rather than throwing, so callers
 * can render a clear state for each case:
 *   - configured: false  -> Supabase env vars aren't set yet
 *   - error: <message>   -> the Leads table itself errored (e.g. RLS) —
 *     treated as fatal, since Leads is the primary source
 *   - leads: []           -> connected fine, there's just no data yet
 *
 * A crm_calls/crm_deals-specific error is logged but non-fatal — Leads
 * still renders normally even if, say, only the Leads migration has run
 * so far and those tables don't exist yet.
 */
export async function fetchLeads() {
  if (!isSupabaseConfigured) {
    return { leads: [], error: null, configured: false };
  }

  try {
    const leadsResult = await fetchTable("crm_leads", LEAD_COLUMNS);
    if (leadsResult.error) {
      return { leads: [], error: leadsResult.error.message, configured: true };
    }

    const [callsResult, dealsResult] = await Promise.all([
      fetchTable("crm_calls", LINKED_RECORD_COLUMNS),
      fetchTable("crm_deals", LINKED_RECORD_COLUMNS),
    ]);
    if (callsResult.error) console.error("[leads] failed to load crm_calls:", callsResult.error.message);
    if (dealsResult.error) console.error("[leads] failed to load crm_deals:", dealsResult.error.message);

    const tagged = [
      ...leadsResult.data.map((r) => ({ ...r, _sourceType: "lead" })),
      ...(callsResult.error ? [] : callsResult.data.map((r) => ({ ...r, _sourceType: "call" }))),
      ...(dealsResult.error ? [] : dealsResult.data.map((r) => ({ ...r, _sourceType: "deal" }))),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return { leads: tagged, error: null, configured: true };
  } catch (err) {
    // A thrown/rejected fetch (network failure, CORS, DNS, etc.) rather
    // than a well-formed Supabase {error} response — must still resolve
    // to a state the UI can render instead of leaving it loading forever.
    return { leads: [], error: err instanceof Error ? err.message : String(err), configured: true };
  }
}

/** Prefers first_name/last_name when present, falls back to the Monday item name. */
export function leadDisplayName(lead) {
  const fromParts = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return fromParts || lead.name || "(unnamed lead)";
}

export const SOURCE_TYPE_LABELS = { lead: "Lead", call: "Call", deal: "Deal" };
