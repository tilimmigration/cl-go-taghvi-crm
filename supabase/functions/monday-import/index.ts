// Supabase Edge Function: monday-import
// Endpoint: /functions/v1/monday-import
//
// One-shot bulk import of every Lead from the configured Monday.com
// Leads board (all groups) into public.crm_leads. Meant to be triggered
// manually (curl, or Supabase dashboard "Invoke function") by someone
// with backend access — NOT by the browser, and NOT automatically. Per
// scope: no webhook, no scheduling, no real-time sync here — this is
// only the initial/bulk import path.
//
// Reuses the exact same client -> mapper -> repository pipeline as the
// monday-webhook function (see supabase/functions/_shared/monday/), via
// runLeadImport() in _shared/monday/import.ts.
//
// Protected by requiring the Supabase service_role key as the bearer
// token — the anon/publishable key (which the browser has) is
// deliberately NOT sufficient, since this consumes Monday API quota and
// performs bulk writes. handleImportRequest() is dependency-injectable so
// it can be tested under plain Node — see __tests__/import-handler.test.ts.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// deno-lint-ignore no-explicit-any
let _createClient: ((url: string, key: string) => any) | undefined;
async function getSupabaseClientFactory() {
  if (!_createClient) {
    const mod = await import("npm:@supabase/supabase-js@2");
    _createClient = mod.createClient;
  }
  return _createClient!;
}

import { type MondaySyncConfig, loadConfig } from "../_shared/monday/config.ts";
import { createMondayClient, type MondayClient } from "../_shared/monday/client.ts";
import { ImportRunFailedError, runLeadImport } from "../_shared/monday/import.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface HandleImportOverrides {
  config?: MondaySyncConfig;
  supabaseClient?: SupabaseClientLike;
  mondayClient?: MondayClient;
}

export async function handleImportRequest(req: Request, overrides: HandleImportOverrides = {}): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let config: MondaySyncConfig;
  try {
    config = overrides.config ?? loadConfig();
  } catch (err) {
    console.error("monday-import: configuration error:", err instanceof Error ? err.message : err);
    return json({ error: "server misconfigured" }, 500);
  }

  // Admin-only: requires the service_role key specifically. The browser's
  // anon/publishable key does not satisfy this, by design.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!bearerToken || bearerToken !== config.supabaseServiceRoleKey) {
    return json({ error: "unauthorized: this endpoint requires the Supabase service_role key" }, 401);
  }

  let pageSize: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.pageSize === "number" && body.pageSize > 0) {
      pageSize = body.pageSize;
    }
  } catch {
    // No/empty body is fine — pageSize just falls back to the client default.
  }

  let supabase: SupabaseClientLike;
  if (overrides.supabaseClient) {
    supabase = overrides.supabaseClient;
  } else {
    const createClient = await getSupabaseClientFactory();
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }

  const mondayClient = overrides.mondayClient ?? createMondayClient({ apiToken: config.mondayApiToken, apiUrl: config.mondayApiUrl });

  try {
    const summary = await runLeadImport({
      mondayClient,
      supabase,
      boardId: config.leadsBoardId,
      columnIdMapJson: config.columnIdMapJson,
      pageSize,
    });
    return json(summary, 200);
  } catch (err) {
    if (err instanceof ImportRunFailedError) {
      console.error(`monday-import: run ${err.importRunId} failed:`, err.message);
      return json({ error: err.message, importRunId: err.importRunId }, 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("monday-import: unexpected failure:", message);
    return json({ error: message }, 500);
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleImportRequest(req));
}
