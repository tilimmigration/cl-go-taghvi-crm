import { test } from "node:test";
import assert from "node:assert/strict";
import { isCeBookedDeal, CE_BOOKED_PIPELINE_GROUP_TITLES } from "./dealStats.js";

test("isCeBookedDeal: matches every attached pipeline group", () => {
  for (const title of CE_BOOKED_PIPELINE_GROUP_TITLES) {
    assert.equal(isCeBookedDeal({ monday_group_title: title }), true, title);
  }
});

test("isCeBookedDeal: loose on case / spacing / punctuation drift", () => {
  assert.equal(isCeBookedDeal({ monday_group_title: "  CASE EVALUATION BOOKED " }), true);
  assert.equal(isCeBookedDeal({ monday_group_title: "Case Evaluation Follow-Up Required" }), true);
  assert.equal(isCeBookedDeal({ monday_group_title: "Proposal (ST To Review)" }), true);
});

test("isCeBookedDeal: excludes non-pipeline / unknown groups and missing data", () => {
  assert.equal(isCeBookedDeal({ monday_group_title: "Junk" }), false);
  assert.equal(isCeBookedDeal({ monday_group_title: "Lost" }), false);
  assert.equal(isCeBookedDeal({ monday_group_title: "" }), false);
  assert.equal(isCeBookedDeal({}), false);
  assert.equal(isCeBookedDeal(null), false);
});

test("isCeBookedDeal: counts the full pipeline across a deal list", () => {
  const deals = [
    { monday_group_title: "Case Evaluation Booked" },
    { monday_group_title: "Signed up" },
    { monday_group_title: "Pending Acceptance" },
    { monday_group_title: "Junk" }, // excluded
  ];
  assert.equal(deals.filter(isCeBookedDeal).length, 3);
});
