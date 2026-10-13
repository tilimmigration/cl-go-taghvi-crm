import { test } from "node:test";
import assert from "node:assert/strict";
import { isCeBookedLead, isQualifiedCall } from "./leads.js";

test("isQualifiedCall: qualified by Status column value (case/space-insensitive)", () => {
  assert.equal(isQualifiedCall({ status: "Qualified Leads" }), true);
  assert.equal(isQualifiedCall({ status: "  qualified leads  " }), true);
  assert.equal(isQualifiedCall({ status: "Qualified Lead" }), true);
  assert.equal(isQualifiedCall({ status: "Qualified" }), true);
});

test("isQualifiedCall: qualified by board group when status is blank", () => {
  assert.equal(isQualifiedCall({ status: "", monday_group_title: "Qualified Leads" }), true);
  assert.equal(isQualifiedCall({ monday_group_title: "Qualified" }), true);
});

test("isQualifiedCall: NOT qualified for negated / unrelated labels", () => {
  assert.equal(isQualifiedCall({ status: "Not Qualified" }), false);
  assert.equal(isQualifiedCall({ status: "Unqualified" }), false);
  assert.equal(isQualifiedCall({ status: "Disqualified" }), false);
  assert.equal(isQualifiedCall({ status: "New lead" }), false);
  assert.equal(isQualifiedCall({ status: null, monday_group_title: null }), false);
  assert.equal(isQualifiedCall({}), false);
});

test("isCeBookedLead: matches the CE scheduled status only", () => {
  assert.equal(isCeBookedLead({ status: "Case evaluation scheduled" }), true);
  assert.equal(isCeBookedLead({ status: "  case evaluation scheduled " }), true);
  assert.equal(isCeBookedLead({ status: "Booked" }), false);
  assert.equal(isCeBookedLead({ status: null }), false);
});
