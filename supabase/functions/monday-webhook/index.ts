// Supabase Edge Function: monday-webhook
// Endpoint: /functions/v1/monday-webhook
//
// Receives change events from the Monday.com "Leads" board ONLY. Scope is
// intentionally narrow per spec:
//   - No other Monday board is processed.
//   - No CRM -> Monday sync (this is a one-way, Monday -> CRM, endpoint).
//   - The existing Leads UI is untouched.
//
// Flow: verify challenge -> normalize event -> validate board -> resolve
// handler -> run pipeline (fetch full item -> transform -> upsert) -> log.
// All Monday API calls and Supabase writes happen here, server-side; the
// Monday API token and the Supabase service role key are never sent to
// the frontend.
//
// handleWebhookRequest() is a pure, dependency-injectable function so it
// can be exercised by the test suite under plain Node (see
// __tests__/webhook-handler.test.ts) without a Deno install. Deno.serve()
// at the bottom is the only part that only runs under the real Edge
// Function runtime.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Imported lazily (see getSupabaseClientFactory below) rather than at the
// top level: the `npm:` specifier only resolves under the Deno runtime,
// and a static import here would break loading this module under plain
// Node for tests, even in test runs that always inject a fake client and
// never actually reach this code path.
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
import { normalizeWebhookEvent } from "../_shared/monday/events.ts";
import { archiveItem, deleteItem, syncItemFromMonday, type SyncTarget } from "../_shared/monday/pipeline.ts";
import { logWebhookEvent } from "../_shared/monday/webhook-logger.ts";
import type { CanonicalEventType, NormalizedWebhookEvent } from "../_shared/monday/types.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

interface HandlerDeps {
  mondayClient: MondayClient;
  supabase: SupabaseClientLike;
  columnIdMapJson?: string;
}

/**
 * Resolves which CRM table an event's board syncs into. Returns null for a
 * board this deployment isn't configured to sync, so the caller can skip
 * it. The Leads board is always configured; Calls and Deals are optional.
 */
function resolveTarget(config: MondaySyncConfig, boardId: string): SyncTarget | null {
  if (boardId === config.leadsBoardId) return { kind: "lead" };
  if (config.callsBoardId && boardId === config.callsBoardId) {
    return { kind: "linked", table: "crm_calls", leadsBoardId: config.leadsBoardId };
  }
  if (config.dealsBoardId && boardId === config.dealsBoardId) {
    return { kind: "linked", table: "crm_deals", leadsBoardId: config.leadsBoardId };
  }
  return null;
}

/**
 * Per-event handlers, keyed by canonical event type. A create/change/name/
 * group-move all re-fetch and upsert the item; archive/delete soft-mark
 * it. move_item_to_group is what carries a deal between funnel stages, so
 * re-syncing on it is what keeps the Dashboard's stage counts live.
 */
const HANDLERS: Record<
  CanonicalEventType,
  (deps: HandlerDeps, event: NormalizedWebhookEvent, target: SyncTarget) => Promise<unknown>
> = {
  create_item: (deps, event, target) => syncItemFromMonday(deps, event.boardId!, event.itemId!, "create_item", target),
  change_column_value: (deps, event, target) => syncItemFromMonday(deps, event.boardId!, event.itemId!, "change_column_value", target),
  change_name: (deps, event, target) => syncItemFromMonday(deps, event.boardId!, event.itemId!, "change_name", target),
  move_item_to_group: (deps, event, target) => syncItemFromMonday(deps, event.boardId!, event.itemId!, "move_item_to_group", target),
  item_archived: (deps, event, target) =>
    archiveItem(deps.supabase, event.boardId!, event.itemId!, event.triggerTime ?? new Date().toISOString(), target),
  item_deleted: (deps, event, target) =>
    deleteItem(deps.supabase, event.boardId!, event.itemId!, event.triggerTime ?? new Date().toISOString(), target),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface HandleWebhookOverrides {
  /** Injected in tests. In production this comes from loadConfig(). */
  config?: MondaySyncConfig;
  /** Injected in tests. In production this is a real supabase-js client. */
  supabaseClient?: SupabaseClientLike;
  /** Injected in tests. In production this is the real Monday API client. */
  mondayClient?: MondayClient;
}

export async function handleWebhookRequest(req: Request, overrides: HandleWebhookOverrides = {}): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    // Malformed JSON will never succeed on retry — accept and drop rather
    // than making Monday retry forever.
    return json({ ok: true, skipped: "invalid_json" }, 200);
  }

  // --- Monday challenge verification -----------------------------------
  // Must be handled before anything else: no config required, no DB
  // write, just echo the challenge straight back. This also means
  // verification works even before all secrets are configured.
  if (typeof rawBody.challenge === "string" || typeof rawBody.challenge === "number") {
    return json({ challenge: rawBody.challenge }, 200);
  }

  let config: MondaySyncConfig;
  try {
    config = overrides.config ?? loadConfig();
  } catch (err) {
    // Nothing to log to (no Supabase config) — surface via function logs.
    console.error("monday-webhook: configuration error:", err instanceof Error ? err.message : err);
    return json({ error: "server misconfigured" }, 500);
  }

  // --- Optional shared-secret hardening ---------------------------------
  // Only enforced once MONDAY_WEBHOOK_SECRET is set. Monday's UI-configured
  // webhooks let you pick the callback URL freely, so the recommended
  // pattern is to append ?token=<secret> to the URL you register.
  if (config.webhookSharedSecret) {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== config.webhookSharedSecret) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  let supabase: SupabaseClientLike;
  if (overrides.supabaseClient) {
    supabase = overrides.supabaseClient;
  } else {
    const createClient = await getSupabaseClientFactory();
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  const event = normalizeWebhookEvent(rawBody);

  // --- Board scope: resolve which CRM table this board syncs into -----
  // Accepts the Leads board plus the optional Calls and Deals boards;
  // anything else is ignored so an unrelated board's events never write.
  const target = event.boardId ? resolveTarget(config, event.boardId) : null;
  if (!target) {
    console.log(`monday-webhook: ignoring event for unconfigured board ${event.boardId ?? "unknown"}`);
    await logWebhookEvent(supabase, {
      eventId: event.eventId,
      eventType: event.rawType || "unknown",
      boardId: event.boardId,
      itemId: event.itemId,
      status: "skipped_wrong_board",
    });
    return json({ ok: true, skipped: "wrong_board" }, 200);
  }

  // --- Required fields -------------------------------------------------
  if (!event.itemId) {
    await logWebhookEvent(supabase, {
      eventId: event.eventId,
      eventType: event.rawType || "unknown",
      boardId: event.boardId,
      itemId: null,
      status: "skipped_invalid",
      errorMessage: "missing item id",
    });
    return json({ ok: true, skipped: "missing_item_id" }, 200);
  }

  // --- Supported event type ---------------------------------------------
  if (!event.type) {
    await logWebhookEvent(supabase, {
      eventId: event.eventId,
      eventType: event.rawType || "unknown",
      boardId: event.boardId,
      itemId: event.itemId,
      status: "skipped_unsupported_event",
    });
    return json({ ok: true, skipped: "unsupported_event_type" }, 200);
  }

  await logWebhookEvent(supabase, {
    eventId: event.eventId,
    eventType: event.type,
    boardId: event.boardId,
    itemId: event.itemId,
    status: "received",
  });

  // --- Process -----------------------------------------------------------
  try {
    const mondayClient =
      overrides.mondayClient ?? createMondayClient({ apiToken: config.mondayApiToken, apiUrl: config.mondayApiUrl });
    await HANDLERS[event.type]({ mondayClient, supabase, columnIdMapJson: config.columnIdMapJson }, event, target);

    await logWebhookEvent(supabase, {
      eventId: event.eventId,
      eventType: event.type,
      boardId: event.boardId,
      itemId: event.itemId,
      status: "processed",
    });
    return json({ ok: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`monday-webhook: error processing ${event.type} for item ${event.itemId}:`, message);

    await logWebhookEvent(supabase, {
      eventId: event.eventId,
      eventType: event.type,
      boardId: event.boardId,
      itemId: event.itemId,
      status: "error",
      errorMessage: message,
    });

    // 500 -> Monday retries the delivery. Every handler path is an
    // idempotent upsert/mark-archived/mark-deleted keyed on
    // (board id, item id), so a retry (or several) converges on the same
    // row rather than creating duplicates.
    return json({ error: "processing failed" }, 500);
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleWebhookRequest(req));
}
