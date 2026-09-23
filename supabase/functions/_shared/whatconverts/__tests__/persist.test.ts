import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttributionRow, buildAttributionRows } from "../persist.ts";
import type { MatchResult, WhatConvertsLeadLike } from "../matching.ts";

const NOW = "2026-09-23T00:00:00.000Z";

function wc(o: Partial<WhatConvertsLeadLike> & { lead_id: number }): WhatConvertsLeadLike {
  return { ...o };
}
function result(o: Partial<MatchResult> & { whatconverts_lead_id: number; status: MatchResult["status"] }): MatchResult {
  return {
    matched_crm_lead_id: null,
    monday_item_id: null,
    match_method: null,
    match_confidence: null,
    normalized_email: null,
    normalized_phone: null,
    match_reason: null,
    unmatched_reason: null,
    ambiguous_reason: null,
    ...o,
  };
}

test("matched row: monday_item_id + method + confidence, normalized vs raw, full raw JSON", () => {
  const lead = wc({
    lead_id: 100,
    date_created: "2026-05-01 09:30:00",
    lead_type: "Web Form",
    lead_source: "Google",
    lead_medium: "CPC",
    lead_campaign: "Spring-2026",
    gclid: "g-1",
  });
  const row = buildAttributionRow(lead, result({ whatconverts_lead_id: 100, status: "matched", matched_crm_lead_id: "crm-1", monday_item_id: 555, match_method: "email_phone", match_confidence: 0.99, match_reason: "exact normalized email and phone" }), NOW);

  assert.equal(row.whatconverts_lead_id, 100);
  assert.equal(row.monday_item_id, 555);
  assert.equal(row.match_status, "matched");
  assert.equal(row.match_method, "email_phone");
  assert.equal(row.match_confidence, 0.99);
  assert.equal(row.channel, "Google Ads"); // gclid / google + cpc
  assert.equal(row.source, "google", "normalized = lowercased");
  assert.equal(row.raw_source, "Google", "raw preserves original case");
  assert.equal(row.medium, "cpc");
  assert.equal(row.campaign, "Spring-2026");
  assert.equal(row.gclid, "g-1");
  assert.equal(row.lead_type, "Web Form");
  assert.equal(row.attribution_created_at, "2026-05-01T09:30:00.000Z");
  assert.equal(row.last_synced_at, NOW);
  assert.deepEqual(row.raw_attribution, lead, "the complete raw WhatConverts lead is preserved");
  assert.equal(row.candidate_crm_lead_ids, null);
});

test("unmatched row: monday_item_id NULL, status unmatched, reason retained", () => {
  const row = buildAttributionRow(
    wc({ lead_id: 101, date_created: "2026-05-02", lead_type: "Web Form", lead_source: "google", lead_medium: "organic" }),
    result({ whatconverts_lead_id: 101, status: "unmatched", unmatched_reason: "no CRM lead with a matching email or phone" }),
    NOW,
  );
  assert.equal(row.monday_item_id, null);
  assert.equal(row.match_status, "unmatched");
  assert.equal(row.match_method, null);
  assert.equal(row.match_confidence, null);
  assert.equal(row.match_reason, "no CRM lead with a matching email or phone");
  assert.equal(row.channel, "Organic");
  assert.equal(row.candidate_crm_lead_ids, null);
});

test("ambiguous row: monday_item_id NULL, candidates retained, not auto-resolved", () => {
  const row = buildAttributionRow(
    wc({ lead_id: 102, date_created: "2026-05-03", lead_type: "Web Form" }),
    result({ whatconverts_lead_id: 102, status: "ambiguous", ambiguous_reason: "email matches 2 CRM leads and phone did not narrow to one", candidate_crm_lead_ids: ["a", "b"] }),
    NOW,
  );
  assert.equal(row.monday_item_id, null, "ambiguous must never be auto-assigned a monday_item_id");
  assert.equal(row.match_status, "ambiguous");
  assert.deepEqual(row.candidate_crm_lead_ids, ["a", "b"]);
  assert.match(row.match_reason ?? "", /email matches 2 CRM leads/);
});

test("buildAttributionRows keys by whatconverts_lead_id (idempotency identity)", () => {
  const leads = [wc({ lead_id: 1, lead_type: "Web Form" }), wc({ lead_id: 2, lead_type: "Web Form" })];
  const results = [
    result({ whatconverts_lead_id: 2, status: "unmatched" }),
    result({ whatconverts_lead_id: 1, status: "matched", monday_item_id: 9, match_method: "email", match_confidence: 0.95 }),
  ];
  const rows = buildAttributionRows(leads, results, NOW);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.whatconverts_lead_id), [1, 2]);
  assert.equal(rows[0].monday_item_id, 9, "match paired by id, not by array order");
  assert.equal(rows[1].monday_item_id, null);
});
