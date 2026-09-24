import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";

// Reads matched WhatConverts attribution rows from public.lead_attribution for
// the Dashboard's Channel Performance table. Only matched rows (with a
// monday_item_id) are fetched — unmatched/ambiguous rows are never counted as
// attributed. RLS restricts this to allowlisted signed-in users, same as the
// leads read. Read-only.

const ATTR_COLUMNS = "whatconverts_lead_id, monday_item_id, channel, attribution_created_at, match_status";
const PAGE_SIZE = 1000;

async function fetchAttribution() {
  if (!isSupabaseConfigured || !supabase) return { rows: [], configured: false, error: null };
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("lead_attribution")
      .select(ATTR_COLUMNS)
      .eq("match_status", "matched")
      .not("monday_item_id", "is", null)
      .order("monday_item_id", { ascending: true })
      .order("attribution_created_at", { ascending: true })
      .order("whatconverts_lead_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, configured: true, error: error.message };
    if (data?.length) rows.push(...data);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { rows, configured: true, error: null };
}

/** status: "loading" | "not_configured" | "error" | "ready" */
export function useAttribution() {
  const [state, setState] = useState({ status: "loading", rows: [], error: null });

  useEffect(() => {
    let cancelled = false;
    fetchAttribution().then(({ rows, configured, error }) => {
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
