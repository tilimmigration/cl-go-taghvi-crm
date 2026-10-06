// Environment/config loading for the Calendly webhook Edge Function.
//
// Works under both Deno (the Supabase Edge Function runtime) and Node (so the
// pure handler logic can be unit-tested without a Deno install). Secrets live
// ONLY in Supabase Edge Function secrets — never hard-coded, never shipped to
// the frontend.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

export class ConfigError extends Error {}

export interface CalendlyConfig {
  /** Calendly webhook subscription signing key (from Calendly, set as a secret). */
  signingKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Replay window for the signature timestamp, in seconds (default 300). */
  signatureToleranceSeconds: number;
}

function readEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) return Deno.env.get(name) ?? undefined;
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).process?.env?.[name];
}

export function loadCalendlyConfig(): CalendlyConfig {
  const signingKey = readEnv("CALENDLY_WEBHOOK_SIGNING_KEY");
  const supabaseUrl = readEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  const missing: string[] = [];
  if (!signingKey) missing.push("CALENDLY_WEBHOOK_SIGNING_KEY");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new ConfigError(`calendly-webhook: missing required environment variable(s): ${missing.join(", ")}`);
  }

  const tolRaw = readEnv("CALENDLY_SIGNATURE_TOLERANCE_SECONDS");
  const tol = tolRaw ? Number(tolRaw) : 300;

  return {
    signingKey: signingKey!,
    supabaseUrl: supabaseUrl!,
    supabaseServiceRoleKey: supabaseServiceRoleKey!,
    signatureToleranceSeconds: Number.isFinite(tol) && tol > 0 ? tol : 300,
  };
}
