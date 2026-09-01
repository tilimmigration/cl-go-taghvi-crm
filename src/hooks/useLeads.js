import { useEffect, useState } from "react";
import { fetchLeads } from "../lib/leads.js";

/**
 * status: "loading" | "not_configured" | "error" | "ready"
 */
export function useLeads() {
  const [state, setState] = useState({ status: "loading", leads: [], error: null });

  useEffect(() => {
    let cancelled = false;

    fetchLeads().then(({ leads, error, configured }) => {
      if (cancelled) return;
      if (!configured) {
        setState({ status: "not_configured", leads: [], error: null });
      } else if (error) {
        setState({ status: "error", leads: [], error });
      } else {
        setState({ status: "ready", leads, error: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
