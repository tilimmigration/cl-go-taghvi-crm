// Config for the one-time Calendly historical sync Edge Function (calendly-sync).
//
// Mirrors the whatconverts-backfill config pattern (see
// supabase/functions/_shared/whatconverts/config.ts): reads its OWN environment,
// throws naming any missing variable (never its value), and works under both
// Deno (the Edge runtime) and Node (so the pure logic is unit-testable with
// `node --experimental-strip-types --test`, no Deno install required).
//
// SECURITY — read carefully:
//   CALENDLY_API_TOKEN is a Calendly Personal Access Token (or OAuth bearer)
//   used to CALL the Calendly REST API. It is a DIFFERENT secret from
//   CALENDLY_WEBHOOK_SIGNING_KEY, which only verifies inbound webhook
//   signatures and CANNOT authenticate REST calls. The token is read only here,
//   server-side, never logged, and never shipped to the frontend. Store it
//   exclusively as a Supabase Edge Function secret.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

export class CalendlySyncConfigError extends Error {}

export interface CalendlySyncConfig {
  /** Calendly API bearer token (PAT/OAuth). NOT the webhook signing key. */
  apiToken: string;
  /** Calendly REST API base, no trailing slash. Default https://api.calendly.com */
  apiUrl: string;
  /** Optional org URI; when absent the sync derives it from GET /users/me. */
  organizationUri?: string;
  /** Per-request timeout in milliseconds. Default 15000. */
  timeoutMs: number;
  /** Optional low-privilege trigger token: an alternative to the service_role
   *  key for authorizing a sync run (used only to invoke this one endpoint). */
  triggerToken?: string;
}

const DEFAULT_API_URL = "https://api.calendly.com";
const DEFAULT_TIMEOUT_MS = 15_000;

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) return Deno.env.get(name) ?? undefined;
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).process?.env?.[name];
}

/**
 * Reads and validates the Calendly sync configuration. Throws
 * CalendlySyncConfigError naming any missing required variable (never its
 * value). CALENDLY_API_URL / CALENDLY_ORG_URI / CALENDLY_TIMEOUT_MS /
 * CALENDLY_SYNC_TRIGGER_TOKEN are optional.
 */
export function loadCalendlySyncConfig(): CalendlySyncConfig {
  const apiToken = readEnv("CALENDLY_API_TOKEN");
  if (!apiToken) {
    throw new CalendlySyncConfigError(
      "calendly-sync: missing required environment variable(s): CALENDLY_API_TOKEN",
    );
  }

  const apiUrl = (readEnv("CALENDLY_API_URL") || DEFAULT_API_URL).replace(/\/+$/, "");
  const organizationUri = readEnv("CALENDLY_ORG_URI") || undefined;

  const tolRaw = readEnv("CALENDLY_TIMEOUT_MS");
  const tol = tolRaw != null ? Number(tolRaw) : Number.NaN;
  const timeoutMs = Number.isFinite(tol) && tol > 0 ? tol : DEFAULT_TIMEOUT_MS;

  const triggerToken = readEnv("CALENDLY_SYNC_TRIGGER_TOKEN") || undefined;

  return { apiToken, apiUrl, organizationUri, timeoutMs, triggerToken };
}
