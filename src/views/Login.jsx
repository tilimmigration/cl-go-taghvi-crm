import { useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";

// Sign-in backed by Supabase Auth (email + password). The previous version
// compared against credentials hardcoded in this file, which shipped to
// every visitor in the JS bundle. Access to lead data is decided by Row
// Level Security in Postgres (see supabase/migrations/), not here.
export default function Login({ clientName, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setError("Sign-in is not available: Supabase is not configured for this deployment.");
      return;
    }
    setSubmitting(true);
    setError("");

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message || "Incorrect email or password.");
      return;
    }
    onSuccess?.(data.session);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--brill-navy)",
        padding: "var(--space-5)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-7) var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "center", textAlign: "center" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--brill-orange)",
            }}
          >
            Brill Media
          </span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--fg-1)" }}>{clientName}</h1>
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Unified CRM · sign in to continue</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              style={{
                fontFamily: "inherit",
                fontSize: 15,
                padding: "10px var(--space-3)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-1)",
                background: "var(--surface-page)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                fontFamily: "inherit",
                fontSize: 15,
                padding: "10px var(--space-3)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-1)",
                background: "var(--surface-page)",
                outline: "none",
              }}
            />
          </label>
        </div>

        {error && (
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--brill-wine)" }}>
            {error}
          </span>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            padding: "12px var(--space-4)",
            border: 0,
            borderRadius: "var(--radius-md)",
            cursor: submitting ? "default" : "pointer",
            background: "var(--brill-blue)",
            color: "var(--brill-white)",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <span style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "center", lineHeight: 1.5 }}>
          Access restricted to the Taghavi and Brill Media teams
        </span>
      </form>
    </div>
  );
}
