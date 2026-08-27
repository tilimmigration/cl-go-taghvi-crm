import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWebhookEvent } from "../events.ts";

test("normalizes a modern camelCase create_item event", () => {
  const result = normalizeWebhookEvent({
    event: {
      type: "create_item",
      boardId: 111222333,
      pulseId: 555,
      userId: 42,
      triggerTime: "2026-08-27T10:00:00Z",
    },
  });

  assert.equal(result.type, "create_item");
  assert.equal(result.rawType, "create_item");
  assert.equal(result.boardId, "111222333");
  assert.equal(result.itemId, "555");
  assert.equal(result.userId, "42");
  assert.equal(result.triggerTime, "2026-08-27T10:00:00Z");
});

test("aliases legacy/alternate event.type spellings to the canonical name", () => {
  assert.equal(normalizeWebhookEvent({ event: { type: "create_pulse" } }).type, "create_item");
  assert.equal(normalizeWebhookEvent({ event: { type: "update_column_value" } }).type, "change_column_value");
  assert.equal(normalizeWebhookEvent({ event: { type: "update_name" } }).type, "change_name");
  assert.equal(normalizeWebhookEvent({ event: { type: "archive_pulse" } }).type, "item_archived");
  assert.equal(normalizeWebhookEvent({ event: { type: "delete_pulse" } }).type, "item_deleted");
});

test("supports snake_case field spellings", () => {
  const result = normalizeWebhookEvent({
    event: {
      type: "change_column_value",
      board_id: 111222333,
      pulse_id: 556,
      column_id: "status",
      user_id: 7,
    },
  });

  assert.equal(result.boardId, "111222333");
  assert.equal(result.itemId, "556");
  assert.equal(result.columnId, "status");
  assert.equal(result.userId, "7");
});

test("unknown event.type normalizes to type: null (not thrown)", () => {
  const result = normalizeWebhookEvent({ event: { type: "some_future_event", boardId: 1, pulseId: 2 } });
  assert.equal(result.type, null);
  assert.equal(result.rawType, "some_future_event");
});

test("missing itemId normalizes to null rather than throwing", () => {
  const result = normalizeWebhookEvent({ event: { type: "create_item", boardId: 1 } });
  assert.equal(result.itemId, null);
});

test("reads eventId from either the envelope root or the event object", () => {
  assert.equal(normalizeWebhookEvent({ eventId: "evt-1", event: { type: "create_item" } }).eventId, "evt-1");
  assert.equal(normalizeWebhookEvent({ event: { type: "create_item", eventId: "evt-2" } }).eventId, "evt-2");
});
