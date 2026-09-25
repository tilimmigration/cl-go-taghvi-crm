import { useCallback, useEffect, useState } from "react";
import { fetchDecisions, saveDecision, clearDecision } from "../lib/dedupeDecisions.js";

// Loads the shared dedup decisions and exposes optimistic mutators for the
// Deduplication queue. status: "loading" | "not_configured" | "error" | "ready".
// `byPair` is a Map keyed by pair_key -> decision row. Writes go straight to
// Supabase under RLS (allowlisted users only); crm_leads and Monday are never
// touched.
export function useDedupeDecisions() {
  const [status, setStatus] = useState("loading");
  const [byPair, setByPair] = useState(() => new Map());
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchDecisions().then(({ rows, configured, error: err }) => {
      if (cancelled) return;
      if (!configured) {
        setStatus("not_configured");
      } else if (err) {
        setStatus("error");
        setError(err);
      } else {
        setByPair(new Map(rows.map((r) => [r.pair_key, r])));
        setStatus("ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const decide = useCallback(async (candidate, decision) => {
    const key = candidate.pairKey;
    // Optimistic: reflect the decision immediately, remember the previous state
    // so a failed write can roll back.
    let previous;
    setByPair((m) => {
      previous = m.get(key);
      const next = new Map(m);
      next.set(key, {
        pair_key: key,
        survivor_monday_item_id: Number(candidate.survivor.monday_item_id),
        duplicate_monday_item_id: Number(candidate.duplicate.monday_item_id),
        verdict: candidate.verdict,
        match_basis: candidate.basis,
        decision,
        _pending: true,
      });
      return next;
    });
    setError(null);

    const { row, error: err } = await saveDecision(candidate, decision);
    setByPair((m) => {
      const next = new Map(m);
      if (err) {
        if (previous) next.set(key, previous);
        else next.delete(key);
      } else if (row) {
        next.set(key, row);
      }
      return next;
    });
    if (err) setError(err);
  }, []);

  const undo = useCallback(async (pairKey) => {
    let previous;
    setByPair((m) => {
      previous = m.get(pairKey);
      const next = new Map(m);
      next.delete(pairKey);
      return next;
    });
    setError(null);

    const { error: err } = await clearDecision(pairKey);
    if (err) {
      setError(err);
      setByPair((m) => {
        const next = new Map(m);
        if (previous) next.set(pairKey, previous);
        return next;
      });
    }
  }, []);

  return { status, byPair, error, decide, undo };
}
