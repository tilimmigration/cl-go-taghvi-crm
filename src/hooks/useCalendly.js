import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";

// Reads Calendly bookings from public.calendly_events for the Dashboard's
// "CE booked" tile (shown as "Live from Calendly"). RLS restricts this to
// allowlisted signed-in users, same as the leads/attribution reads. Read-only.
//
// This is deliberately sourced straight from calendly_events (the Calendly
// lifecycle layer), NOT from crm_leads.status: crm_leads is a one-way mirror of
// Monday, so a status written there is overwritten on the next Monday sync. A
// derived count read from calendly_events survives every sync.

const CAL_COLUMNS = "id, status, ce_booked, ce_booked_at, scheduled_at, invitee_email";
const PAGE_SIZE = 1000;

async function fetchCalendly() {
  if (!isSupabaseConfigured || !supabase) return { rows: [], configured: false, error: null };
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("calendly_events")
      .select(CAL_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, configured: true, error: error.message };
    if (data?.length) rows.push(...data);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { rows, configured: true, error: null };
}

/** status: "loading" | "not_configured" | "error" | "ready" */
export function useCalendly() {
  const [state, setState] = useState({ status: "loading", rows: [], error: null });

  useEffect(() => {
    let cancelled = false;
    fetchCalendly().then(({ rows, configured, error }) => {
      if (cancelled) return;
      if (!configured) setState({ status: "not_configured", rows: [], error: null });
      else if (error) setState({ status: "error", rows: [], error });
      else setState({ status: "ready", rows, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
