// Data-access for public.lead_dedup_decisions — the human's triage of the
// Pre-CE dedup queue. This is the one place the CRM UI WRITES to Supabase:
// allowlisted signed-in users record a Merge / Merge-and-reopen / Keep-separate
// decision, gated by RLS. It never writes to crm_leads and never touches
// Monday — a decision is a separate, reversible record the dashboard reflects.

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

const COLUMNS =
  "pair_key, survivor_monday_item_id, duplicate_monday_item_id, survivor_lead_id, duplicate_lead_id, match_basis, verdict, decision, decided_by, decided_at";

/** All recorded decisions (shared across the allowlisted team). */
export async function fetchDecisions() {
  if (!isSupabaseConfigured || !supabase) return { rows: [], configured: false, error: null };
  const { data, error } = await supabase.from("lead_dedup_decisions").select(COLUMNS).order("decided_at", { ascending: false });
  if (error) return { rows: [], configured: true, error: error.message };
  return { rows: data || [], configured: true, error: null };
}

/**
 * Upserts the decision for a candidate pair (idempotent on pair_key). `decision`
 * is "merged" | "reopened" | "kept_separate". decided_by is stamped with the
 * signed-in user's email — the RLS insert/update policy requires it to match.
 */
export async function saveDecision(candidate, decision) {
  if (!isSupabaseConfigured || !supabase) return { row: null, error: "not configured" };
  const { data: userData } = await supabase.auth.getUser();
  const email = userData?.user?.email?.toLowerCase() ?? null;
  const row = {
    pair_key: candidate.pairKey,
    survivor_monday_item_id: Number(candidate.survivor.monday_item_id),
    duplicate_monday_item_id: Number(candidate.duplicate.monday_item_id),
    survivor_lead_id: candidate.survivor.id ?? null,
    duplicate_lead_id: candidate.duplicate.id ?? null,
    match_basis: candidate.basis,
    verdict: candidate.verdict,
    decision,
    decided_by: email,
    decided_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("lead_dedup_decisions").upsert(row, { onConflict: "pair_key" }).select(COLUMNS).single();
  return { row: data ?? null, error: error?.message ?? null };
}

/** Removes a decision (undo) — the pair returns to the active queue. */
export async function clearDecision(pairKey) {
  if (!isSupabaseConfigured || !supabase) return { error: "not configured" };
  const { error } = await supabase.from("lead_dedup_decisions").delete().eq("pair_key", pairKey);
  return { error: error?.message ?? null };
}
