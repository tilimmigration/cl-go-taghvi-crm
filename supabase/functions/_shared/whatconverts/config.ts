// Environment/config loading for the WhatConverts API integration.
//
// This module is fully independent of the Monday.com integration: it shares
// no code with supabase/functions/_shared/monday/ and reads its own
// environment variables. Like the Monday config it works under both Deno
// (the Supabase Edge Function runtime) and Node (so the client logic can be
// unit-tested with `node --experimental-strip-types --test`, no Deno
// install required).
//
// SECURITY: WHATCONVERTS_API_TOKEN and WHATCONVERTS_API_SECRET are secret
// credentials. They are read ONLY here, server-side, and must never be
// placed in a VITE_* variable or otherwise shipped to the browser bundle.
// Store them exclusively as Supabase Edge Function secrets.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) {
    return Deno.env.get(name) ?? undefined;
  }
  // deno-lint-ignore no-explicit-any
  const proc = (globalThis as any).process;
  return proc?.env?.[name];
}

export class WhatConvertsConfigError extends Error {}

export interface WhatConvertsConfig {
  apiToken: string;
  apiSecret: string;
  /** API base URL, no trailing slash. Default: https://app.whatconverts.com/api/v1 */
  apiUrl: string;
  /** Per-request timeout in milliseconds. Default: 15000. */
  timeoutMs: number;
}

const DEFAULT_API_URL = "https://app.whatconverts.com/api/v1";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Reads and validates the WhatConverts credentials + settings. Throws
 * WhatConvertsConfigError naming any missing variables (never their values)
 * so a caller can fail loudly rather than issue an unauthenticated request.
 * The optional WHATCONVERTS_API_URL / WHATCONVERTS_TIMEOUT_MS fall back to
 * sensible defaults.
 */
export function loadWhatConvertsConfig(): WhatConvertsConfig {
  const apiToken = readEnv("WHATCONVERTS_API_TOKEN");
  const apiSecret = readEnv("WHATCONVERTS_API_SECRET");

  const missing: string[] = [];
  if (!apiToken) missing.push("WHATCONVERTS_API_TOKEN");
  if (!apiSecret) missing.push("WHATCONVERTS_API_SECRET");
  if (missing.length > 0) {
    throw new WhatConvertsConfigError(
      `whatconverts: missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  const apiUrl = (readEnv("WHATCONVERTS_API_URL") || DEFAULT_API_URL).replace(/\/+$/, "");

  const timeoutRaw = readEnv("WHATCONVERTS_TIMEOUT_MS");
  const timeoutNum = timeoutRaw != null ? Number(timeoutRaw) : Number.NaN;
  const timeoutMs = Number.isFinite(timeoutNum) && timeoutNum > 0 ? timeoutNum : DEFAULT_TIMEOUT_MS;

  return { apiToken: apiToken!, apiSecret: apiSecret!, apiUrl, timeoutMs };
}
