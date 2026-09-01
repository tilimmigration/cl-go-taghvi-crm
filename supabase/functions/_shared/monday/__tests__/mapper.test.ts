import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelatedLeadMondayItemId, mapMondayItemToLead } from "../mapper.ts";
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
      { id: "long_text", text: "Some private note", value: '{"note":true}', type: "long_text", column: { title: "Internal notes" } },
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
    type: "long_text",
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

test("maps the Phase 1 standard fields added beyond the original webhook set", () => {
  const item = buildMondayItem({
    id: "558",
    name: "Full Profile",
    column_values: [
      { id: "c1", text: "Priya", value: null, column: { title: "First Name" } },
      { id: "c2", text: "Raghunathan", value: null, column: { title: "Last Name" } },
      { id: "c3", text: "Prospecting", value: null, column: { title: "Stage" } },
      { id: "c4", text: "https://acme.example", value: null, column: { title: "Website" } },
      { id: "c5", text: "123 Main St", value: null, column: { title: "Address" } },
      { id: "c6", text: "Los Angeles", value: null, column: { title: "City" } },
      { id: "c7", text: "CA", value: null, column: { title: "State" } },
      { id: "c8", text: "USA", value: null, column: { title: "Country" } },
      { id: "c9", text: "Legal", value: null, column: { title: "Industry" } },
      { id: "c10", text: "Called twice, no answer.", value: null, column: { title: "Notes" } },
    ],
  });

  const lead = mapMondayItemToLead(item, "111222333");

  assert.equal(lead.firstName, "Priya");
  assert.equal(lead.lastName, "Raghunathan");
  assert.equal(lead.stage, "Prospecting");
  assert.equal(lead.website, "https://acme.example");
  assert.equal(lead.address, "123 Main St");
  assert.equal(lead.city, "Los Angeles");
  assert.equal(lead.state, "CA");
  assert.equal(lead.country, "USA");
  assert.equal(lead.industry, "Legal");
  assert.equal(lead.notes, "Called twice, no answer.");
  assert.equal(Object.keys(lead.customFields).length, 0);
});

test("every column type is preserved in customFields even when unrecognized", () => {
  const columnTypes = ["numbers", "dropdown", "date", "timeline", "checkbox", "link", "location", "tags", "rating", "country", "file", "formula", "board_relation", "mirror"];
  const item = buildMondayItem({
    id: "559",
    name: "Type Coverage",
    column_values: columnTypes.map((type, i) => ({
      id: `col_${i}`,
      text: `display-${type}`,
      value: JSON.stringify({ raw: type }),
      type,
      column: { title: `Custom ${type}` },
    })),
  });

  const lead = mapMondayItemToLead(item, "111222333");

  for (let i = 0; i < columnTypes.length; i++) {
    const field = lead.customFields[`col_${i}`];
    assert.ok(field, `expected customFields.col_${i} to be preserved`);
    assert.equal(field.type, columnTypes[i]);
    assert.equal(field.text, `display-${columnTypes[i]}`);
    assert.deepEqual(field.value, { raw: columnTypes[i] });
  }
});

test("extractRelatedLeadMondayItemId finds a board_relation column titled like 'Lead'", () => {
  const item = buildMondayItem({
    id: "101",
    name: "Call with Ana",
    column_values: [
      { id: "notes", text: "Left a voicemail", value: null, type: "long_text", column: { title: "Notes" } },
      {
        id: "link",
        text: "Ana Beltran",
        value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: 1 }] }),
        type: "board_relation",
        column: { title: "Related Lead" },
      },
    ],
  });

  assert.equal(extractRelatedLeadMondayItemId(item), "1");
});

test("extractRelatedLeadMondayItemId falls back to any board_relation column if none match the title hints", () => {
  const item = buildMondayItem({
    id: "101",
    name: "Deal",
    column_values: [
      {
        id: "connect",
        text: "Ana Beltran",
        value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: 42 }] }),
        type: "board_relation",
        column: { title: "Source Record" },
      },
    ],
  });

  assert.equal(extractRelatedLeadMondayItemId(item), "42");
});

test("extractRelatedLeadMondayItemId returns null when there's no board_relation column or link value", () => {
  assert.equal(extractRelatedLeadMondayItemId(buildMondayItem({ id: "1", name: "No link", column_values: [] })), null);

  const emptyLink = buildMondayItem({
    id: "2",
    name: "Unlinked",
    column_values: [{ id: "link", text: "", value: JSON.stringify({ linkedPulseIds: [] }), type: "board_relation", column: { title: "Lead" } }],
  });
  assert.equal(extractRelatedLeadMondayItemId(emptyLink), null);
});
