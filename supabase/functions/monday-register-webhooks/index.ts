// Supabase Edge Function: monday-register-webhooks
// Endpoint: /functions/v1/monday-register-webhooks
//
// One-shot admin utility: subscribes the monday-webhook endpoint to the
// events we care about on every configured board (Leads, Calls, Deals), so
// Monday.com pushes real-time changes to it. Without this, monday-webhook
// is deployed but never receives anything.
//
// Protected by requiring the Supabase service_role key as the bearer token
// (same posture as monday-import) — never callable from the browser. It
// reads the Monday API token and board ids from the function environment
// (via loadConfig), so no secret is passed in the request.
//
// Idempotent-ish: it first lists the webhooks already on each board and
// skips any event that is already subscribed, so re-running does not pile
// up duplicate subscriptions. Every board/event outcome is returned so a
// caller can see exactly what was created, skipped, or failed.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

import { type MondaySyncConfig, loadConfig } from "../_shared/monday/config.ts";

// The events monday-webhook knows how to handle. move_item_to_group is the
// one that carries a deal between funnel stages, so the Dashboard's stage
// counts stay live.
const WEBHOOK_EVENTS = [
  "create_item",
  "change_column_value",
  "change_name",
  "move_item_to_group",
  "item_deleted",
  "item_archived",
] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function mondayGraphql(config: MondaySyncConfig, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(config.mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: config.mondayApiToken, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors) {
    throw new Error(`Monday API error (HTTP ${res.status}): ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body?.data;
}

const LIST_WEBHOOKS = `query ($boardId: ID!) { webhooks(board_id: $boardId) { id event } }`;
const CREATE_WEBHOOK = `
  mutation ($boardId: ID!, $url: String!, $event: WebhookEventType!) {
    create_webhook(board_id: $boardId, url: $url, event: $event) { id board_id event }
  }
`;

export async function handleRegisterRequest(req: Request, overrides: { config?: MondaySyncConfig } = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let config: MondaySyncConfig;
  try {
    config = overrides.config ?? loadConfig();
  } catch (err) {
    console.error("monday-register-webhooks: config error:", err instanceof Error ? err.message : err);
    return json({ error: "server misconfigured" }, 500);
  }

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== config.supabaseServiceRoleKey) {
    return json({ error: "unauthorized: this endpoint requires the Supabase service_role key" }, 401);
  }

  const callbackBase = `${config.supabaseUrl}/functions/v1/monday-webhook`;
  const callbackUrl = config.webhookSharedSecret
    ? `${callbackBase}?token=${encodeURIComponent(config.webhookSharedSecret)}`
    : callbackBase;

  const boards: Array<{ kind: string; id: string }> = [{ kind: "leads", id: config.leadsBoardId }];
  if (config.callsBoardId) boards.push({ kind: "calls", id: config.callsBoardId });
  if (config.dealsBoardId) boards.push({ kind: "deals", id: config.dealsBoardId });

  const results: Array<Record<string, unknown>> = [];

  for (const board of boards) {
    let existingEvents = new Set<string>();
    try {
      const listed = await mondayGraphql(config, LIST_WEBHOOKS, { boardId: board.id });
      existingEvents = new Set((listed?.webhooks ?? []).map((w: { event: string }) => w.event));
    } catch (err) {
      // Non-fatal: if we can't list, we still attempt to create (Monday
      // tolerates it; worst case is a duplicate subscription).
      console.warn(`monday-register-webhooks: could not list webhooks for ${board.kind} board ${board.id}:`, err instanceof Error ? err.message : err);
    }

    for (const event of WEBHOOK_EVENTS) {
      if (existingEvents.has(event)) {
        results.push({ board: board.kind, boardId: board.id, event, status: "already_subscribed" });
        continue;
      }
      try {
        const created = await mondayGraphql(config, CREATE_WEBHOOK, { boardId: board.id, url: callbackUrl, event });
        results.push({ board: board.kind, boardId: board.id, event, status: "created", webhookId: created?.create_webhook?.id });
      } catch (err) {
        results.push({ board: board.kind, boardId: board.id, event, status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "already_subscribed").length;
  const failed = results.filter((r) => r.status === "error").length;

  return json({ callbackUrl, created, skipped, failed, results }, failed > 0 ? 207 : 200);
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleRegisterRequest(req));
}
