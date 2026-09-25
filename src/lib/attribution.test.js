import { test } from "node:test";
import assert from "node:assert/strict";
import { firstTouchByLead, channelCounts, channelLifecycle, buildChannelTable, lifecycleAvailability } from "./attribution.js";

function row(o) {
  return { match_status: "matched", ...o };
}

test("1. one CRM lead with one WhatConverts touch", () => {
  const ft = firstTouchByLead([row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z" })]);
  assert.equal(ft.size, 1);
  assert.equal(ft.get("100").channel, "Meta Ads");
});

test("2 & 3. multiple touches — earliest WhatConverts date determines the channel (input order irrelevant)", () => {
  const rows = [
    row({ whatconverts_lead_id: 9, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-06-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 2, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 5, monday_item_id: 100, channel: "Phone", attribution_created_at: "2026-07-01T00:00:00Z" }),
  ];
  const ft = firstTouchByLead(rows);
  assert.equal(ft.size, 1);
  assert.equal(ft.get("100").channel, "Google Ads", "earliest (May) wins");
});

test("4. the same CRM lead is never counted twice", () => {
  const rows = [
    row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 2, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-06-01T00:00:00Z" }),
  ];
  const { counts, total } = channelCounts(firstTouchByLead(rows));
  assert.equal(total, 1);
  assert.equal(counts["Google Ads"], 1);
  assert.equal(counts["Meta Ads"], 0);
});

test("5. unmatched WhatConverts rows are excluded", () => {
  const rows = [
    row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    { whatconverts_lead_id: 2, monday_item_id: null, channel: "Meta Ads", attribution_created_at: "2026-05-02T00:00:00Z", match_status: "unmatched" },
  ];
  const ft = firstTouchByLead(rows);
  assert.equal(ft.size, 1);
  assert.ok(ft.has("100"));
});

test("6. ambiguous WhatConverts rows are excluded", () => {
  const rows = [
    { whatconverts_lead_id: 2, monday_item_id: null, channel: "Meta Ads", attribution_created_at: "2026-05-02T00:00:00Z", match_status: "ambiguous" },
  ];
  assert.equal(firstTouchByLead(rows).size, 0);
});

test("7. channel totals reconcile to unique attributed CRM leads", () => {
  const rows = [
    row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 2, monday_item_id: 101, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 3, monday_item_id: 101, channel: "Meta Ads", attribution_created_at: "2026-06-01T00:00:00Z" }), // 2nd touch, same lead
    row({ whatconverts_lead_id: 4, monday_item_id: 102, channel: "Referral", attribution_created_at: "2026-05-01T00:00:00Z" }),
  ];
  const { counts, total } = channelCounts(firstTouchByLead(rows));
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, total);
  assert.equal(total, 3);
});

test("8. CE booked joins to the attributed CRM lead (status OR deal group)", () => {
  const ft = firstTouchByLead([
    row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
    row({ whatconverts_lead_id: 2, monday_item_id: 200, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z" }),
  ]);
  const crmLeads = [
    { id: "L1", monday_item_id: 100, status: "Case evaluation scheduled" }, // CE via lead status
    { id: "L2", monday_item_id: 200, status: "New" },
  ];
  const crmDeals = [
    { related_lead_monday_item_id: 200, monday_group_title: "Case Evaluation Booked" }, // CE via deal group
  ];
  const per = channelLifecycle(ft, crmLeads, crmDeals);
  assert.equal(per["Google Ads"].ces, 1);
  assert.equal(per["Meta Ads"].ces, 1);
  assert.equal(per["Google Ads"].signed, 0);
});

test("9. Signed joins to the attributed CRM lead via the deal in 'Signed up'", () => {
  const ft = firstTouchByLead([row({ whatconverts_lead_id: 1, monday_item_id: 300, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z" })]);
  const crmLeads = [{ id: "L3", monday_item_id: 300, status: "New" }];
  const crmDeals = [{ related_lead_id: "L3", monday_group_title: "Signed up" }]; // linked by crm id
  const per = channelLifecycle(ft, crmLeads, crmDeals);
  assert.equal(per["Meta Ads"].signed, 1);
  assert.equal(per["Meta Ads"].ces, 0);
});

test("lifecycle availability: unavailable when no lead link/status, available when present", () => {
  // No CE status anywhere, no deal carries a lead link -> not connectable.
  assert.deepEqual(lifecycleAvailability([{ id: "L1", monday_item_id: 1, status: "New" }], [{ monday_group_title: "Signed up", related_lead_id: null, related_lead_monday_item_id: null }]), {
    ceAvailable: false,
    signedAvailable: false,
  });
  // A deal linked to a lead -> both connectable.
  assert.deepEqual(lifecycleAvailability([{ id: "L1", monday_item_id: 1, status: "New" }], [{ monday_group_title: "Signed up", related_lead_id: "L1" }]), {
    ceAvailable: true,
    signedAvailable: true,
  });
  // A CE-scheduled lead makes CE observable even without deal links.
  assert.deepEqual(lifecycleAvailability([{ id: "L1", monday_item_id: 1, status: "Case evaluation scheduled" }], []), {
    ceAvailable: true,
    signedAvailable: false,
  });
  // buildChannelTable surfaces the flags.
  const t = buildChannelTable(
    [{ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z", match_status: "matched" }],
    [{ id: "L1", monday_item_id: 100, status: "New" }],
    [{ monday_group_title: "Signed up", related_lead_id: null, related_lead_monday_item_id: null }],
  );
  assert.equal(t.ceAvailable, false);
  assert.equal(t.signedAvailable, false);
});

test("first touch carries the raw WhatConverts lead source / medium / campaign", () => {
  const ft = firstTouchByLead([
    { whatconverts_lead_id: 1, monday_item_id: 100, channel: "Meta Ads", raw_source: "facebook", raw_medium: "cpc", raw_campaign: "Spring-2026", attribution_created_at: "2026-05-01T00:00:00Z", match_status: "matched" },
    { whatconverts_lead_id: 2, monday_item_id: 100, channel: "Google Ads", raw_source: "google", raw_medium: "cpc", attribution_created_at: "2026-06-01T00:00:00Z", match_status: "matched" }, // later touch, must not win
  ]);
  const m = ft.get("100");
  assert.equal(m.channel, "Meta Ads");
  assert.equal(m.source, "facebook", "earliest touch's lead source wins");
  assert.equal(m.medium, "cpc");
  assert.equal(m.campaign, "Spring-2026");
});

test("full-coverage accounting: channels (attributed) + unattributed = total leads", () => {
  const attrRows = [
    { whatconverts_lead_id: 1, monday_item_id: 100, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z", match_status: "matched" },
    { whatconverts_lead_id: 2, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-06-01T00:00:00Z", match_status: "matched" }, // 2nd touch, same lead
    { whatconverts_lead_id: 3, monday_item_id: 101, channel: "Referral", attribution_created_at: "2026-05-01T00:00:00Z", match_status: "matched" },
    { whatconverts_lead_id: 4, monday_item_id: null, channel: "Meta Ads", attribution_created_at: "2026-05-01T00:00:00Z", match_status: "unmatched" }, // excluded
  ];
  const crmLeads = [100, 101, 102, 103, 104].map((m) => ({ id: `L${m}`, monday_item_id: m, status: "New" }));
  const t = buildChannelTable(attrRows, crmLeads, []);
  assert.equal(t.uniqueAttributed, 2, "two unique attributed CRM leads");
  assert.equal(t.totalLeads, 5);
  assert.equal(t.unattributed, 3);
  const channelSum = t.rows.reduce((a, r) => a + r.leads, 0);
  assert.equal(channelSum, t.uniqueAttributed);
  assert.equal(channelSum + t.unattributed, t.totalLeads, "everything reconciles to the total lead count");
});

test("10. no mock CHANNELS values leak — an empty attribution set yields all zeros", () => {
  const table = buildChannelTable([], [], []);
  assert.equal(table.total.leads, 0);
  assert.equal(table.uniqueAttributed, 0);
  for (const r of table.rows) assert.equal(r.leads, 0, `${r.channel} must derive from data, not the mock`);
  // and a real input drives the numbers (not the mock 24/31/...)
  const built = buildChannelTable(
    [row({ whatconverts_lead_id: 1, monday_item_id: 100, channel: "Google Ads", attribution_created_at: "2026-05-01T00:00:00Z" })],
    [{ id: "L1", monday_item_id: 100, status: "New" }],
    [],
  );
  assert.equal(built.rows.find((r) => r.channel === "Google Ads").leads, 1);
  assert.equal(built.total.leads, 1);
  assert.equal(built.uniqueAttributed, 1);
});
