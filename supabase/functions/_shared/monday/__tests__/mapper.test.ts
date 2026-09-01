import { test } from "node:test";
import assert from "node:assert/strict";
import { mapMondayItemToLead } from "../mapper.ts";
import { buildMondayItem } from "./fakes.ts";

test("maps well-known columns by title", () => {
  const item = buildMondayItem({
    id: "555",
    name: "Ana Beltran",
    column_values: [
      { id: "status_1", text: "Family", value: null, column: { title: "Lead Type" } },
      { id: "text_1", text: "Meta — quiz", value: null, column: { title: "Lead Source" } },
      { id: "status", text: "New lead", value: null, column: { title: "Status" } },
      {
        id: "person",
        text: "Soulmaz",
        value: JSON.stringify({ personsAndTeams: [{ id: 42, kind: "person" }] }),
        column: { title: "Owner" },
      },
      { id: "email_1", text: "ana@example.com", value: null, column: { title: "Email" } },
      { id: "phone_1", text: "(818) 442-0197", value: null, column: { title: "Phone" } },
      { id: "text_9", text: "", value: null, column: { title: "Company" } },
      { id: "long_text", text: "Some private note", value: '{"note":true}', column: { title: "Internal notes" } },
    ],
  });

  const lead = mapMondayItemToLead(item, "111222333");

  assert.equal(lead.mondayItemId, "555");
  assert.equal(lead.mondayBoardId, "111222333");
  assert.equal(lead.name, "Ana Beltran");
  assert.equal(lead.leadType, "Family");
  assert.equal(lead.leadSource, "Meta — quiz");
  assert.equal(lead.status, "New lead");
  assert.equal(lead.ownerName, "Soulmaz");
  assert.equal(lead.ownerMondayUserId, "42");
  assert.equal(lead.email, "ana@example.com");
  assert.equal(lead.phone, "(818) 442-0197");
  // Empty text -> normalized to null, not "".
  assert.equal(lead.company, null);

  // Unmapped column lands in customFields, keyed by column id.
  assert.deepEqual(lead.customFields.long_text, {
    title: "Internal notes",
    text: "Some private note",
    value: { note: true },
  });
  assert.equal(Object.keys(lead.customFields).length, 1);
});

test("explicit column id map overrides title matching", () => {
  const item = buildMondayItem({
    id: "556",
    name: "Custom Column Ids",
    column_values: [
      // Title says "Notes", but we pin it to `email` via the override.
      { id: "text_weird", text: "someone@example.com", value: null, column: { title: "Notes" } },
    ],
  });

  const columnIdMapJson = JSON.stringify({ email: "text_weird" });
  const lead = mapMondayItemToLead(item, "111222333", columnIdMapJson);

  assert.equal(lead.email, "someone@example.com");
  assert.equal(Object.keys(lead.customFields).length, 0);
});

test("malformed column id map JSON falls back to title matching without throwing", () => {
  const item = buildMondayItem({
    id: "557",
    name: "Fallback",
    column_values: [{ id: "email", text: "a@b.com", value: null, column: { title: "Email" } }],
  });

  const lead = mapMondayItemToLead(item, "111222333", "{not valid json");
  assert.equal(lead.email, "a@b.com");
});
