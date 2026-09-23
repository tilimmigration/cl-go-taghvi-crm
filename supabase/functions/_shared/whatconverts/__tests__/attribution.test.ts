import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyChannel, computeFirstTouch, type MatchedTouch } from "../attribution.ts";
import type { WhatConvertsLeadLike } from "../matching.ts";

function wc(o: Partial<WhatConvertsLeadLike> = {}): WhatConvertsLeadLike {
  return { lead_id: 1, ...o };
}

test("channel normalization covers every channel", () => {
  assert.equal(classifyChannel(wc({ gclid: "abc123" })).channel, "Google Ads");
  assert.equal(classifyChannel(wc({ lead_source: "google", lead_medium: "cpc" })).channel, "Google Ads");
  assert.equal(classifyChannel(wc({ fbclid: "fb123" })).channel, "Meta Ads");
  assert.equal(classifyChannel(wc({ lead_source: "facebook", lead_medium: "paid_social" })).channel, "Meta Ads");
  assert.equal(classifyChannel(wc({ lead_type: "Phone Call" })).channel, "Phone");
  assert.equal(classifyChannel(wc({ lead_source: "google", lead_medium: "organic" })).channel, "Organic");
  assert.equal(classifyChannel(wc({ lead_medium: "referral", lead_source: "partnerfirm.com" })).channel, "Referral");
  assert.equal(classifyChannel(wc({ lead_source: "direct", lead_medium: "none" })).channel, "Direct");
  assert.equal(classifyChannel(wc({ lead_source: "", lead_medium: "" })).channel, "Direct");
  assert.equal(classifyChannel(wc({ lead_source: "tiktok", lead_medium: "video" })).channel, "Other");
});

test("a paid signal beats the phone lead_type (a Google call is Google Ads, not Phone)", () => {
  assert.equal(classifyChannel(wc({ lead_type: "Phone Call", gclid: "x" })).channel, "Google Ads");
});

test("raw source/medium/campaign are preserved untouched", () => {
  const c = classifyChannel(wc({ lead_source: "Google", lead_medium: "CPC", lead_campaign: "Brand-Aug" }));
  assert.equal(c.channel, "Google Ads");
  assert.equal(c.rawSource, "Google");
  assert.equal(c.rawMedium, "CPC");
  assert.equal(c.rawCampaign, "Brand-Aug");
});

test("first-touch selection: earliest WhatConverts date wins across multiple touchpoints", () => {
  // Order intentionally shuffled; Google Ads is the earliest by date.
  const touches: MatchedTouch[] = [
    { crmLeadId: "lead-1", mondayItemId: 5, wcLead: wc({ lead_id: 2, date_created: "2026-06-05", lead_source: "facebook", lead_medium: "cpc" }) },
    { crmLeadId: "lead-1", mondayItemId: 5, wcLead: wc({ lead_id: 3, date_created: "2026-06-09", lead_type: "Phone Call" }) },
    { crmLeadId: "lead-1", mondayItemId: 5, wcLead: wc({ lead_id: 1, date_created: "2026-06-01", lead_source: "google", lead_medium: "cpc" }) },
  ];
  const ft = computeFirstTouch(touches);
  assert.equal(ft.length, 1, "one CRM lead => one first-touch result");
  assert.equal(ft[0].channel, "Google Ads");
  assert.equal(ft[0].displayLabel, "Google Ads");
  assert.equal(ft[0].touchCount, 3);
  assert.deepEqual(ft[0].allTouchChannels, ["Google Ads", "Meta Ads", "Phone"]);
  assert.equal(ft[0].firstTouchWhatconvertsLeadId, 1);
});

test("display labels: Organic and Phone use the dashboard labels", () => {
  const organic = computeFirstTouch([{ crmLeadId: "a", mondayItemId: 1, wcLead: wc({ date_created: "2026-01-01", lead_medium: "organic" }) }]);
  assert.equal(organic[0].displayLabel, "Website — organic");
  const phone = computeFirstTouch([{ crmLeadId: "b", mondayItemId: 2, wcLead: wc({ date_created: "2026-01-01", lead_type: "Phone Call" }) }]);
  assert.equal(phone[0].displayLabel, "Phone — inbound");
});
