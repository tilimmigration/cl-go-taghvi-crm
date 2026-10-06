// Supabase Edge Function: calendly-webhook
// Endpoint: /functions/v1/calendly-webhook
//
// Ingests Calendly webhook events (invitee.created / invitee.canceled) into
// public.calendly_events ONLY. It never writes crm_leads / crm_leads.status /
// crm_calls / crm_deals / lead_attribution, never calls Monday, and never
// infers CE Completed. Every request is verified against the Calendly webhook
// signature; the signing key and Supabase service-role key live in Edge Function
// secrets and are never exposed to the frontend.
//
// handleCalendlyWebhook() is a pure, dependency-injectable function so it can be
// exercised under plain Node (see __tests__/webhook-handler.test.ts) without a
// Deno install. Deno.serve() at the bottom is the only Deno-only part.

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Lazy npm import (only resolves under the Deno runtime); tests inject a client.
// deno-lint-ignore no-explicit-any
let _createClient: ((url: string, key: string) => any) | undefined;
async function getSupabaseClientFactory() {
  if (!_createClient) {
    const mod = await import("npm:@supabase/supabase-js@2");
    _createClient = mod.createClient;
  }
  return _createClient!;
}

import { type CalendlyConfig, loadCalendlyConfig } from "./lib/config.ts";
import { verifyCalendlySignature } from "./lib/verify.ts";
import { normalizeCalendlyEvent } from "./lib/events.ts";
import { matchLeadByEmail } from "./lib/matching.ts";
import { upsertCalendlyEvent } from "./lib/persist.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export interface HandleOverrides {
  /** Injected in tests. In production this comes from loadCalendlyConfig(). */
  config?: CalendlyConfig;
  /** Injected in tests. In production this is a service-role supabase-js client. */
  // deno-lint-ignore no-explicit-any
  supabaseClient?: any;
  /** Injected in tests for a deterministic signature-tolerance check. */
  nowMs?: number;
}

export async function handleCalendlyWebhook(req: Request, overrides: HandleOverrides = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Read the RAW body first — signature verification must run against the exact
  // bytes Calendly signed, not a re-serialized payload.
  const rawBody = await req.text();

  let config: CalendlyConfig;
  try {
    config = overrides.config ?? loadCalendlyConfig();
  } catch (err) {
    // Fail closed: no signing key configured means we cannot trust anything.
    console.error("calendly-webhook: configuration error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "server misconfigured" }, 500);
  }

  const nowMs = overrides.nowMs ?? Date.now();
  const verdict = await verifyCalendlySignature(
    rawBody,
    req.headers.get("Calendly-Webhook-Signature"),
    config.signingKey,
    { nowMs, toleranceSeconds: config.signatureToleranceSeconds },
  );
  if (!verdict.ok) {
    // Never log the signature header or secrets — just the reason.
    console.warn("calendly-webhook: signature rejected:", verdict.reason);
    return json({ error: "invalid signature" }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "malformed payload" }, 400);
  }

  const evt = normalizeCalendlyEvent(body);
  if (!evt) {
    // Unsupported event type (or missing stable key): acknowledge and ignore,
    // rather than failing the whole request.
    console.log("calendly-webhook: ignoring event type:", typeof body?.event === "string" ? body.event : "unknown");
    return json({ ok: true, ignored: true }, 200);
  }

  try {
    // deno-lint-ignore no-explicit-any
    let supabase: any = overrides.supabaseClient;
    if (!supabase) {
      const createClient = await getSupabaseClientFactory();
      supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    }

    const match = await matchLeadByEmail(supabase, evt.inviteeEmail);
    const result = await upsertCalendlyEvent(supabase, evt, match, body);

    console.log(`calendly-webhook: ${evt.kind} ${result.action} (event=${evt.calendlyEventUri}, matched_lead=${match ? "yes" : "no"})`);
    return json({ ok: true, event: evt.kind, action: result.action, matched: Boolean(match) }, 200);
  } catch (err) {
    // Don't leak DB error details to Calendly; log server-side. 500 → Calendly
    // retries, and every path is an idempotent upsert keyed on calendly_event_uri.
    console.error("calendly-webhook: processing error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "processing failed" }, 500);
  }
}

if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req: Request) => handleCalendlyWebhook(req));
}
