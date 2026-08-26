import { useState } from "react";

const CREDENTIALS = { username: "admin", password: "FCmEfhJSbYrDTS0G5nY7" };

export default function Login({ clientName, onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const ok = username === CREDENTIALS.username && password === CREDENTIALS.password;

    window.setTimeout(() => {
      setSubmitting(false);
      if (ok) {
        onSuccess();
      } else {
        setError("Incorrect username or password.");
      }
    }, 250);
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
              Username
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
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
          Concept dashboard · access restricted to the Taghavi and Brill Media teams
        </span>
      </form>
    </div>
  );
}
