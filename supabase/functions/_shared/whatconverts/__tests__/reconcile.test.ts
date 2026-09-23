import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateFirstTouchChannels, reconcile } from "../reconcile.ts";
import type { Channel, FirstTouchResult } from "../attribution.ts";

function ft(crmLeadId: string, channel: Channel): FirstTouchResult {
  return {
    crmLeadId,
    mondayItemId: 1,
    channel,
    displayLabel: channel,
    firstTouchWhatconvertsLeadId: 1,
    firstTouchDate: "2026-01-01",
    rawSource: null,
    rawMedium: null,
    rawCampaign: null,
    touchCount: 1,
    allTouchChannels: [channel],
  };
}

test("unique lead counting: each CRM lead counted once, per first-touch channel", () => {
  const agg = aggregateFirstTouchChannels([
    ft("a", "Google Ads"),
    ft("b", "Google Ads"),
    ft("c", "Meta Ads"),
    ft("a", "Meta Ads"), // duplicate CRM lead id — must NOT double count
  ]);
  assert.equal(agg.byChannel["Google Ads"], 2);
  assert.equal(agg.byChannel["Meta Ads"], 1);
  assert.equal(agg.totalAttributed, 3);
});

test("reconciliation: channel sum equals total unique attributed leads", () => {
  const agg = aggregateFirstTouchChannels([
    ft("a", "Google Ads"),
    ft("b", "Meta Ads"),
    ft("c", "Organic"),
    ft("d", "Phone"),
    ft("e", "Referral"),
    ft("f", "Direct"),
    ft("g", "Other"),
  ]);
  const rec = reconcile(agg);
  assert.equal(rec.reconciles, true);
  assert.equal(rec.sumOfChannels, 7);
  assert.equal(rec.totalAttributed, 7);
});

test("reconciliation compares against existing dashboard numbers by display label", () => {
  const agg = aggregateFirstTouchChannels([ft("a", "Google Ads"), ft("b", "Google Ads"), ft("c", "Organic")]);
  const rec = reconcile(agg, { "Google Ads": 24, "Website — organic": 14, __total__: 84 });
  const google = rec.rows.find((r) => r.channel === "Google Ads")!;
  assert.equal(google.existing, 24);
  assert.equal(google.whatConverts, 2);
  assert.equal(google.difference, 2 - 24);
  const organic = rec.rows.find((r) => r.channel === "Organic")!;
  assert.equal(organic.displayLabel, "Website — organic");
  assert.equal(organic.difference, 1 - 14);
  // Direct has no existing dashboard number -> difference stays null.
  const direct = rec.rows.find((r) => r.channel === "Direct")!;
  assert.equal(direct.existing, null);
  assert.equal(direct.difference, null);
  assert.equal(rec.existingTotal, 84);
});
