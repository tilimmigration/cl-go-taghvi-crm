import { test } from "node:test";
import assert from "node:assert/strict";
import { isCeBookedLead, isQualifiedCall } from "./leads.js";

test("isQualifiedCall: qualified by Status column value (starts-with, case/space-insensitive)", () => {
  assert.equal(isQualifiedCall({ status: "Qualified Leads" }), true);
  assert.equal(isQualifiedCall({ status: "  qualified leads  " }), true);
  assert.equal(isQualifiedCall({ status: "Qualified Lead" }), true);
  assert.equal(isQualifiedCall({ status: "Qualified" }), true);
  assert.equal(isQualifiedCall({ status: "Qualified - needs docs" }), true);
});

test("isQualifiedCall: qualified via a status-type custom field (title isn't 'Status')", () => {
  // The Call Log Tracker stores qualification in a differently-titled status
  // column, so the sync lands it in custom_fields, not crm_calls.status.
  const call = {
    status: null,
    monday_group_title: "Action Needed",
    custom_fields: {
      color_mkabc: { title: "Lead Status", type: "status", text: "Qualified Leads", value: { index: 1 } },
    },
  };
  assert.equal(isQualifiedCall(call), true);
});

test("isQualifiedCall: qualified by board group", () => {
  assert.equal(isQualifiedCall({ status: "", monday_group_title: "Qualified Leads" }), true);
});

test("isQualifiedCall: NOT qualified for negated / unrelated / non-status-column labels", () => {
  assert.equal(isQualifiedCall({ status: "Not Qualified" }), false);
  assert.equal(isQualifiedCall({ status: "Unqualified" }), false);
  assert.equal(isQualifiedCall({ status: "Disqualified" }), false);
  assert.equal(isQualifiedCall({ status: "New lead" }), false);
  assert.equal(isQualifiedCall({ status: null, monday_group_title: "Action Needed" }), false);
  // A free-text column that merely contains the word must NOT count.
  assert.equal(
    isQualifiedCall({ custom_fields: { notes: { title: "Notes", type: "text", text: "Qualified lead, call back" } } }),
    false,
  );
  assert.equal(isQualifiedCall({}), false);
  assert.equal(isQualifiedCall(null), false);
});

test("isCeBookedLead: matches the CE scheduled status only", () => {
  assert.equal(isCeBookedLead({ status: "Case evaluation scheduled" }), true);
  assert.equal(isCeBookedLead({ status: "  case evaluation scheduled " }), true);
  assert.equal(isCeBookedLead({ status: "Booked" }), false);
  assert.equal(isCeBookedLead({ status: null }), false);
});
