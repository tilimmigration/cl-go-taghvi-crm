// Writes to public.monday_webhook_logs. Deliberately narrow: only ids,
// event type, status and a short error message are ever stored — never
// the raw webhook payload, headers, or any credential.

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

import type { WebhookLogStatus } from "./types.ts";

export interface WebhookLogEntry {
  eventId: string | null;
  eventType: string;
  boardId: string | null;
  itemId: string | null;
  status: WebhookLogStatus;
  errorMessage?: string | null;
}

/**
 * Logging failures must never crash webhook processing — this function
 * swallows its own errors (after printing to stderr) rather than
 * propagating them.
 */
export async function logWebhookEvent(supabase: SupabaseClientLike, entry: WebhookLogEntry): Promise<void> {
  try {
    const { error } = await supabase.from("monday_webhook_logs").insert({
      monday_event_id: entry.eventId,
      event_type: entry.eventType,
      monday_board_id: entry.boardId ? Number(entry.boardId) : null,
      monday_item_id: entry.itemId ? Number(entry.itemId) : null,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
    });
    if (error) {
      console.error("monday-webhook: failed to write webhook log:", error.message);
    }
  } catch (err) {
    console.error("monday-webhook: failed to write webhook log:", err instanceof Error ? err.message : err);
  }
}
