// Data-access layer for public.crm_leads. This is the only module the UI
// should import to read leads — keeps the query, column list and
// display-name fallback logic in one place.

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

const SELECT_COLUMNS = [
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

/**
 * Fetches active (non-deleted) leads, newest first.
 *
 * Returns `{ leads, error, configured }` rather than throwing, so callers
 * can render a clear state for each case:
 *   - configured: false  -> Supabase env vars aren't set yet
 *   - error: <message>   -> Supabase responded with an error (e.g. RLS)
 *   - leads: []           -> connected fine, there's just no data yet
 */
export async function fetchLeads() {
  if (!isSupabaseConfigured) {
    return { leads: [], error: null, configured: false };
  }

  try {
    const { data, error } = await supabase
      .from("crm_leads")
      .select(SELECT_COLUMNS)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (error) {
      return { leads: [], error: error.message, configured: true };
    }

    return { leads: data ?? [], error: null, configured: true };
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
