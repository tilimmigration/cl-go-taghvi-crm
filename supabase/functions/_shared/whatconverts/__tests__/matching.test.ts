import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadIndex, matchAll, matchWhatConvertsLead, type CrmLeadLike, type WhatConvertsLeadLike } from "../matching.ts";

function crm(o: Partial<CrmLeadLike> = {}): CrmLeadLike {
  return {
    id: "crm-1",
    monday_item_id: 1001,
    name: null,
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    custom_fields: null,
    raw_column_values: null,
    monday_created_at: "2026-06-01T00:00:00Z",
    ...o,
  };
}
function wc(o: Partial<WhatConvertsLeadLike> = {}): WhatConvertsLeadLike {
  return { lead_id: 1, date_created: "2026-06-02T00:00:00Z", email_address: null, phone_number: null, contact_name: null, ...o };
}
function match(one: WhatConvertsLeadLike, leads: CrmLeadLike[], options = {}) {
  return matchWhatConvertsLead(one, buildLeadIndex(leads), options);
}

test("exact normalized email match", () => {
  const r = match(wc({ email_address: "ANA@x.com" }), [crm({ id: "a", email: "ana@x.com" })]);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "a");
  assert.equal(r.monday_item_id, 1001);
  assert.equal(r.match_method, "email");
  assert.equal(r.match_confidence, 0.95);
});

test("email match tolerates case + whitespace differences", () => {
  const r = match(wc({ email_address: "  Ana@X.COM " }), [crm({ id: "a", email: "ana@x.com" })]);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "a");
  assert.equal(r.normalized_email, "ana@x.com");
});

test("phone match reads the phone from custom_fields (crm_leads.phone is empty)", () => {
  const lead = crm({
    id: "p",
    email: "someone@x.com",
    custom_fields: { phone_col: { title: "Phone Number", type: "text", text: "(818) 442-0197" } },
  });
  const r = match(wc({ email_address: null, phone_number: "+1 818-442-0197" }), [lead]);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "p");
  assert.equal(r.match_method, "phone");
  assert.equal(r.normalized_phone, "8184420197");
});

test("email + phone match is the strongest method (0.99)", () => {
  const lead = crm({ id: "ep", email: "ana@x.com", custom_fields: { c: { title: "Phone Number", text: "818-442-0197" } } });
  const r = match(wc({ email_address: "ana@x.com", phone_number: "8184420197" }), [lead]);
  assert.equal(r.match_method, "email_phone");
  assert.equal(r.match_confidence, 0.99);
});

test("name + phone match when several leads share the phone", () => {
  const leads = [
    crm({ id: "n1", first_name: "Ana", last_name: "Beltran", custom_fields: { c: { title: "Phone", text: "8184420197" } } }),
    crm({ id: "n2", first_name: "Bob", last_name: "Jones", custom_fields: { c: { title: "Phone", text: "8184420197" } } }),
  ];
  const r = match(wc({ email_address: null, phone_number: "8184420197", contact_name: "ana beltran" }), leads);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "n1");
  assert.equal(r.match_method, "name_phone");
  assert.equal(r.match_confidence, 0.9);
});

test("name alone is NEVER a match", () => {
  const lead = crm({ id: "a", email: "ana@x.com", first_name: "Ana", last_name: "Beltran" });
  const r = match(wc({ email_address: "different@x.com", phone_number: null, contact_name: "ana beltran" }), [lead]);
  assert.equal(r.status, "unmatched");
  assert.equal(r.matched_crm_lead_id, null);
});

test("ambiguous when one email matches multiple leads and phone can't disambiguate", () => {
  const leads = [crm({ id: "x1", email: "dup@x.com" }), crm({ id: "x2", email: "dup@x.com" })];
  const r = match(wc({ email_address: "dup@x.com" }), leads);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.matched_crm_lead_id, null);
  assert.deepEqual(r.candidate_crm_lead_ids?.sort(), ["x1", "x2"]);
  assert.match(r.ambiguous_reason ?? "", /matches 2 CRM leads/);
});

test("email matching multiple leads IS disambiguated by an agreeing phone", () => {
  const leads = [
    crm({ id: "x1", email: "dup@x.com", custom_fields: { c: { title: "Phone", text: "8184420197" } } }),
    crm({ id: "x2", email: "dup@x.com", custom_fields: { c: { title: "Phone", text: "3105598842" } } }),
  ];
  const r = match(wc({ email_address: "dup@x.com", phone_number: "310-559-8842" }), leads);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "x2");
  assert.equal(r.match_method, "email_phone");
});

test("unmatched when no email/phone matches any lead", () => {
  const r = match(wc({ email_address: "nobody@x.com", phone_number: "9999999999" }), [crm({ id: "a", email: "ana@x.com" })]);
  assert.equal(r.status, "unmatched");
  assert.match(r.unmatched_reason ?? "", /no CRM lead with a matching email or phone/);
});

test("date tolerance rejects a contact that matches an unrelated, far-apart lead", () => {
  const oldLead = crm({ id: "old", email: "reuse@x.com", monday_created_at: "2020-01-01T00:00:00Z" });
  const r = match(wc({ email_address: "reuse@x.com", date_created: "2026-01-01T00:00:00Z" }), [oldLead]);
  assert.equal(r.status, "unmatched");
  assert.match(r.unmatched_reason ?? "", /outside the date tolerance window/);
});

test("date tolerance keeps the correct recent lead when an old duplicate exists", () => {
  const leads = [
    crm({ id: "old", email: "reuse@x.com", monday_created_at: "2020-01-01T00:00:00Z" }),
    crm({ id: "new", email: "reuse@x.com", monday_created_at: "2026-05-20T00:00:00Z" }),
  ];
  const r = match(wc({ email_address: "reuse@x.com", date_created: "2026-06-01T00:00:00Z" }), leads);
  assert.equal(r.status, "matched");
  assert.equal(r.matched_crm_lead_id, "new", "only the in-window lead should remain, so it's an unambiguous match");
});

test("missing email and phone -> unmatched with a clear reason", () => {
  const r = match(wc({ email_address: null, phone_number: null, contact_name: "ana beltran" }), [crm({ id: "a", email: "ana@x.com" })]);
  assert.equal(r.status, "unmatched");
  assert.match(r.unmatched_reason ?? "", /no usable email or phone/);
});

test("a duplicate WhatConverts lead (same contact twice) matches the same CRM lead both times", () => {
  const index = buildLeadIndex([crm({ id: "a", email: "ana@x.com" })]);
  const results = matchAll(
    [wc({ lead_id: 10, email_address: "ana@x.com" }), wc({ lead_id: 11, email_address: "ana@x.com" })],
    index,
  );
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.matched_crm_lead_id), ["a", "a"]);
});
