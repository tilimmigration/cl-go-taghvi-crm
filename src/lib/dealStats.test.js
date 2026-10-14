import { test } from "node:test";
import assert from "node:assert/strict";
import { isCeBookedDeal, CE_BOOKED_PIPELINE_GROUP_TITLES, aggregateDealStats } from "./dealStats.js";

function dealWith(group, { monthly, term, upfront }) {
  return {
    monday_group_title: group,
    custom_fields: {
      c1: { title: "Monthly fee", type: "numbers", text: monthly == null ? "" : String(monthly) },
      c2: { title: "Term", type: "numbers", text: term == null ? "" : String(term) },
      c3: { title: "Upfront Fee", type: "numbers", text: upfront == null ? "" : String(upfront) },
    },
  };
}

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

test("aggregateDealStats: upfrontRevenue sums Upfront Fee of Signed-up deals only", () => {
  const deals = [
    dealWith("Signed up", { monthly: 100, term: 12, upfront: 500 }), // counts (signed)
    dealWith("Signed up", { monthly: 0, term: 0, upfront: 250 }), // counts upfront only
    dealWith("Pending Acceptance", { monthly: 100, term: 12, upfront: 999 }), // excluded (not signed)
  ];
  const stats = aggregateDealStats(deals);
  assert.equal(stats.upfrontRevenue, 750); // 500 + 250
  assert.equal(stats.revenue, 100 * 12 + 500 + 250); // full contract value of signed deals = 1950
});
