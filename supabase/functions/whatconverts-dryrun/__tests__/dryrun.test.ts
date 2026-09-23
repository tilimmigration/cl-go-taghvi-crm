import { test } from "node:test";
import assert from "node:assert/strict";
import { runDryRun } from "../../_shared/whatconverts/dryrun.ts";
import type { CrmLeadLike, WhatConvertsLeadLike } from "../../_shared/whatconverts/matching.ts";

// crm_leads fixture: phones live in custom_fields (as they do on the live board).
const CRM: CrmLeadLike[] = [
  { id: "L1", monday_item_id: 101, first_name: "Ana", last_name: "Beltran", email: "ana@x.com", custom_fields: { c: { title: "Phone Number", text: "818-442-0197" } }, monday_created_at: "2026-06-01" },
  { id: "L2", monday_item_id: 102, first_name: "Priya", last_name: "R", email: "priya@x.com", monday_created_at: "2026-05-01" },
  { id: "L3", monday_item_id: 103, first_name: "Marcus", last_name: "O", email: "marcus@x.com", custom_fields: { c: { title: "Phone Number", text: "310-559-8842" } }, monday_created_at: "2026-05-15" },
  { id: "L4", monday_item_id: 104, email: "dup@x.com", monday_created_at: "2026-06-01" },
  { id: "L5", monday_item_id: 105, email: "dup@x.com", monday_created_at: "2026-06-02" },
].map((o) => ({ name: null, phone: null, raw_column_values: null, ...o }) as CrmLeadLike);

const WC: WhatConvertsLeadLike[] = [
  { lead_id: 1, email_address: "ana@x.com", date_created: "2026-06-02", lead_source: "google", lead_medium: "cpc" }, // L1 first touch (Google)
  { lead_id: 2, email_address: "ana@x.com", date_created: "2026-06-05", lead_source: "facebook", lead_medium: "cpc" }, // L1 later
  { lead_id: 3, phone_number: "8184420197", date_created: "2026-06-09", lead_type: "Phone Call" }, // L1 later (phone)
  { lead_id: 4, phone_number: "310-559-8842", date_created: "2026-05-16", lead_type: "Phone Call" }, // L3 (Phone)
  { lead_id: 5, email_address: "priya@x.com", date_created: "2026-05-02", lead_source: "google", lead_medium: "organic" }, // L2 first touch (Organic)
  { lead_id: 8, email_address: "priya@x.com", date_created: "2026-05-03", lead_medium: "referral", lead_source: "partner.com" }, // L2 later
  { lead_id: 6, email_address: "dup@x.com", date_created: "2026-06-02" }, // ambiguous (L4/L5)
  { lead_id: 7, email_address: "nobody@x.com", date_created: "2026-06-02" }, // unmatched
];

test("dry run: matching counts + method breakdown", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  assert.equal(r.matching.totalWhatConvertsLeads, 8);
  assert.equal(r.matching.matched, 6);
  assert.equal(r.matching.ambiguous, 1);
  assert.equal(r.matching.unmatched, 1);
  assert.equal(r.matching.byMethod.email, 4);
  assert.equal(r.matching.byMethod.phone, 2);
});

test("dry run: first-touch channels count each CRM lead once, under the earliest touch", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  assert.equal(r.firstTouch.byChannel["Google Ads"], 1); // L1: Google was first, not Meta/Phone
  assert.equal(r.firstTouch.byChannel["Organic"], 1); // L2: Organic was first, not Referral
  assert.equal(r.firstTouch.byChannel["Phone"], 1); // L3
  assert.equal(r.firstTouch.byChannel["Meta Ads"], 0);
  assert.equal(r.firstTouch.totalAttributed, 3);
});

test("dry run: reconciliation invariant holds (channels sum == unique attributed)", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  assert.equal(r.reconciliation.reconciles, true);
  assert.equal(r.reconciliation.sumOfChannels, 3);
  assert.equal(r.reconciliation.totalAttributed, 3);
});

test("dry run: reconciliation compares to existing dashboard numbers, difference computed", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC, existingChannels: { "Google Ads": 24, "Website — organic": 14, __total__: 84 } });
  const google = r.reconciliation.rows.find((row) => row.channel === "Google Ads")!;
  assert.equal(google.existing, 24);
  assert.equal(google.whatConverts, 1);
  assert.equal(google.difference, 1 - 24);
});

test("dry run: multi-touch example selects the first touch and lists the journey", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  const multi = r.examples.multiTouchFirstTouch!;
  assert.equal(multi.touch_count, 3);
  assert.equal(multi.first_touch_channel, "Google Ads");
  assert.deepEqual(multi.touches_in_order, ["Google Ads", "Meta Ads", "Phone"]);
});

test("dry run: examples exist and PII is redacted", () => {
  const r = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  assert.ok(r.examples.emailMatch);
  assert.match(r.examples.emailMatch!.normalized_email!, /\*\*\*/);
  assert.ok(r.examples.phoneMatch);
  assert.ok(r.examples.unmatched);
  assert.ok(r.examples.ambiguous);
  assert.equal(r.examples.ambiguous!.candidate_count, 2);
});

test("dry run: writes nothing (pure function over inputs) — inputs are not mutated", () => {
  const before = JSON.stringify(CRM);
  runDryRun({ crmLeads: CRM, whatConvertsLeads: WC });
  assert.equal(JSON.stringify(CRM), before, "crm_leads input must not be mutated");
});
