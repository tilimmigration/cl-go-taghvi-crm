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
  "monday_created_at",
  "created_at",
  "updated_at",
].join(", ");

const LINKED_RECORD_COLUMNS = [
  "id",
  "monday_board_id",
  "monday_item_id",
  "monday_group_id",
  "monday_group_title",
  "name",
  "email",
  "phone",
  "company",
  "status",
  "owner_name",
  "related_lead_id",
  "related_lead_monday_item_id",
  "custom_fields",
  "monday_created_at",
  "created_at",
  "updated_at",
].join(", ");

/**
 * True when the signed-in user's email has a row in crm_allowed_users.
 * RLS on that table only ever exposes the caller's own row, so this is a
 * yes/no lookup, not a way to list who else has access.
 */
async function isAllowlisted() {
  const { data: userData } = await supabase.auth.getUser();
  const email = userData?.user?.email?.toLowerCase();
  if (!email) return false;
  const { data, error } = await supabase
    .from("crm_allowed_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return !error && Boolean(data);
}

// Supabase/PostgREST caps a single response at the project's "Max rows"
// setting (1000 by default). crm_deals alone is already past that as the
// Monday Deals board has grown, so a plain select silently drops the
// overflow and the Dashboard undercounts (e.g. "Contracts signed"). Page
// through with .range() until a short page returns, so every active row is
// counted no matter how large a board gets. created_at is not unique, so
// id is added as a stable tiebreaker to keep the page boundaries from
// skipping or duplicating rows.
const FETCH_PAGE_SIZE = 1000;

async function fetchTable(table, columns) {
  const rows = [];
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    if (data?.length) rows.push(...data);
    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/**
 * Fetches active (non-deleted) records from crm_leads, crm_calls and
 * crm_deals, merged into one list sorted newest-first, each tagged with
 * `_sourceType` ("lead" | "call" | "deal").
 *
 * Returns `{ leads, error, configured, authorized }` rather than throwing,
 * so callers can render a clear state for each case:
 *   - configured: false  -> Supabase env vars aren't set yet
 *   - error: <message>   -> the Leads table itself errored — treated as
 *     fatal, since Leads is the primary source
 *   - authorized: false  -> signed in, but this account's email is not on
 *     the crm_allowed_users allowlist, so RLS returns no rows. Told apart
 *     from "no data yet" by checking the allowlist for the current user.
 *   - leads: []           -> connected and authorized, just no data yet
 *
 * A crm_calls/crm_deals-specific error is logged but non-fatal — Leads
 * still renders normally even if, say, only the Leads migration has run
 * so far and those tables don't exist yet.
 */
export async function fetchLeads() {
  if (!isSupabaseConfigured) {
    return { leads: [], error: null, configured: false, authorized: false };
  }

  try {
    const leadsResult = await fetchTable("crm_leads", LEAD_COLUMNS);
    if (leadsResult.error) {
      return { leads: [], error: leadsResult.error.message, configured: true, authorized: true };
    }
    // RLS hides rows rather than erroring, so an empty result is ambiguous:
    // no leads yet, or this account isn't allowlisted. Check the allowlist
    // only in the empty case to keep the common path to one round trip.
    if (leadsResult.data.length === 0 && !(await isAllowlisted())) {
      return { leads: [], error: null, configured: true, authorized: false };
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

    return { leads: tagged, error: null, configured: true, authorized: true };
  } catch (err) {
    // A thrown/rejected fetch (network failure, CORS, DNS, etc.) rather
    // than a well-formed Supabase {error} response — must still resolve
    // to a state the UI can render instead of leaving it loading forever.
    return { leads: [], error: err instanceof Error ? err.message : String(err), configured: true, authorized: true };
  }
}

/** Prefers first_name/last_name when present, falls back to the Monday item name. */
export function leadDisplayName(lead) {
  const fromParts = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return fromParts || lead.name || "(unnamed lead)";
}

const CE_BOOKED_STATUS = "case evaluation scheduled";

/**
 * True when a lead's Monday Status column reads "Case evaluation
 * scheduled" — the Leads-board source of truth for the Dashboard's "CE
 * booked" KPI. Not every scheduled case evaluation necessarily has a
 * matching crm_deals item yet, so this counts from the Leads board
 * directly rather than from the Deals board's group (see dealStats.js,
 * which covers the later funnel stages that ARE read from Deals groups).
 */
export function isCeBookedLead(lead) {
  return (lead.status || "").trim().toLowerCase() === CE_BOOKED_STATUS;
}

export const SOURCE_TYPE_LABELS = { lead: "Lead", call: "Call", deal: "Deal" };
