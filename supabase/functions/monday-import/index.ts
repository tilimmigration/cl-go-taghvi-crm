// Supabase Edge Function: monday-import
// Endpoint: /functions/v1/monday-import
//
// One-shot bulk import from the configured Monday.com boards into their
// matching CRM tables:
//   - Leads board (MONDAY_LEADS_BOARD_ID, required)      -> crm_leads
//   - Call Log Tracker (MONDAY_CALLS_BOARD_ID, optional)  -> crm_calls
//   - Deals (MONDAY_DEALS_BOARD_ID, optional)             -> crm_deals
// Calls and Deals are only imported when their board id is configured —
// omit them and this behaves exactly as before (Leads only). Each import
// is independent: one board failing doesn't prevent the others from
// running.
//
// Meant to be triggered manually (curl, or Supabase dashboard "Invoke
// function") by someone with backend access — NOT by the browser, and
// NOT automatically. Per scope: no webhook, no scheduling, no real-time
// sync here — this is only the initial/bulk import path.
//
// Reuses the exact same client -> mapper -> repository pipeline as the
// monday-webhook function (see supabase/functions/_shared/monday/), via
// runLeadImport() / runLinkedRecordImport().
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
import { ImportRunFailedError, runLeadImport, type ImportSummary } from "../_shared/monday/import.ts";
import { runLinkedRecordImport } from "../_shared/monday/linked-record-import.ts";
import type { LinkedRecordTable } from "../_shared/monday/linked-records-repository.ts";

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

interface TargetError {
  board: "leads" | "calls" | "deals";
  error: string;
  importRunId?: string;
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

  const errors: TargetError[] = [];
  let leads: ImportSummary | null = null;
  let calls: ImportSummary | null = null;
  let deals: ImportSummary | null = null;

  try {
    leads = await runLeadImport({ mondayClient, supabase, boardId: config.leadsBoardId, columnIdMapJson: config.columnIdMapJson, pageSize });
  } catch (err) {
    errors.push(describeError("leads", err));
  }

  async function importLinked(table: LinkedRecordTable, boardId: string | undefined): Promise<ImportSummary | null> {
    if (!boardId) return null;
    try {
      return await runLinkedRecordImport({
        mondayClient,
        supabase,
        table,
        boardId,
        leadsBoardId: config.leadsBoardId,
        columnIdMapJson: config.columnIdMapJson,
        pageSize,
      });
    } catch (err) {
      errors.push(describeError(table === "crm_calls" ? "calls" : "deals", err));
      return null;
    }
  }

  calls = await importLinked("crm_calls", config.callsBoardId);
  deals = await importLinked("crm_deals", config.dealsBoardId);

  const body = {
    leads,
    calls,
    deals,
    ...(errors.length > 0 ? { errors } : {}),
  };

  return json(body, errors.length > 0 ? 500 : 200);
}

function describeError(board: "leads" | "calls" | "deals", err: unknown): TargetError {
  if (err instanceof ImportRunFailedError) {
    console.error(`monday-import: [${board}] run ${err.importRunId} failed:`, err.message);
    return { board, error: err.message, importRunId: err.importRunId };
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`monday-import: [${board}] unexpected failure:`, message);
  return { board, error: message };
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleImportRequest(req));
}
