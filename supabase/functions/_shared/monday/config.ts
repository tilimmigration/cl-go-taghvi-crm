// Environment/config loading for the Monday.com sync pipeline.
//
// Works under both Deno (the Supabase Edge Function runtime) and Node (so
// the pure logic in this pipeline can be unit-tested without a Deno
// install). Only this file and the Deno.serve() entrypoint touch the
// runtime-specific env API directly.

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

export class ConfigError extends Error {}

export interface MondaySyncConfig {
  mondayApiToken: string;
  mondayApiUrl: string;
  leadsBoardId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /**
   * Optional shared secret. When set, the webhook only accepts requests
   * whose `?token=` query parameter matches this value (challenge
   * verification requests are exempt — Monday sends those with no way to
   * attach a token). Recommended once you're ready to register the real
   * Monday webhook subscription; append `?token=<value>` to the callback
   * URL you register with Monday.
   */
  webhookSharedSecret?: string;
  /**
   * Optional explicit column-id -> field map, as JSON, e.g.
   * '{"leadType":"status_1","email":"email_9"}'. When not set, columns are
   * matched by title (case-insensitive) against sensible defaults — see
   * mapper.ts. Set this once the real Leads board's column ids are known,
   * since column titles can be renamed.
   */
  columnIdMapJson?: string;
}

/**
 * Reads and validates the config needed by the Monday sync pipeline.
 * Throws ConfigError with a clear message if anything required is missing
 * — callers should catch this and fail the request loudly rather than
 * silently proceeding with a half-configured pipeline.
 */
export function loadConfig(): MondaySyncConfig {
  const mondayApiToken = readEnv("MONDAY_API_TOKEN");
  const leadsBoardId = readEnv("MONDAY_LEADS_BOARD_ID");
  const supabaseUrl = readEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  const missing: string[] = [];
  if (!mondayApiToken) missing.push("MONDAY_API_TOKEN");
  if (!leadsBoardId) missing.push("MONDAY_LEADS_BOARD_ID");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new ConfigError(
      `monday-webhook: missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  return {
    mondayApiToken: mondayApiToken!,
    mondayApiUrl: readEnv("MONDAY_API_URL") || "https://api.monday.com/v2",
    leadsBoardId: leadsBoardId!,
    supabaseUrl: supabaseUrl!,
    supabaseServiceRoleKey: supabaseServiceRoleKey!,
    webhookSharedSecret: readEnv("MONDAY_WEBHOOK_SECRET"),
    columnIdMapJson: readEnv("MONDAY_COLUMN_ID_MAP"),
  };
}
