import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDuplicates, normEmail, normPhone, pairKey, customFieldPhoneDigits } from "./dedupe.js";

function lead(o) {
  return { _sourceType: "lead", ...o };
}
const phoneCF = (text) => ({ phone_col: { title: "Phone Number", text } });

test("normEmail lowercases/trims; normPhone reads phone col or a Phone custom field", () => {
  assert.equal(normEmail({ email: "  Ana@Gmail.com " }), "ana@gmail.com");
  assert.equal(normEmail({ email: "" }), null);
  assert.equal(normPhone({ phone: "+1 (818) 442-0197" }), "8184420197");
  // crm_leads.phone empty -> fall back to the custom field
  assert.equal(normPhone({ phone: "", custom_fields: phoneCF("(818) 442-0197") }), "8184420197");
  assert.equal(customFieldPhoneDigits({ custom_fields: phoneCF("818-442-0197") }), "8184420197");
  assert.equal(normPhone({ phone: "12", custom_fields: {} }), null);
});

test("pairKey is order-independent", () => {
  assert.equal(pairKey(200, 100), "100-200");
  assert.equal(pairKey(100, 200), "100-200");
});

test("no duplicates -> empty; unrelated leads are not paired", () => {
  const rows = [
    lead({ id: "a", monday_item_id: 1, first_name: "Ana", email: "ana@x.com", phone: "8180000001" }),
    lead({ id: "b", monday_item_id: 2, first_name: "Bob", email: "bob@x.com", phone: "8180000002" }),
  ];
  assert.equal(detectDuplicates(rows).length, 0);
});

test("only lead records are considered (calls/deals excluded)", () => {
  const rows = [
    lead({ id: "a", monday_item_id: 1, name: "Ana", email: "ana@x.com" }),
    { _sourceType: "deal", id: "d", monday_item_id: 9, name: "Ana", email: "ana@x.com" },
  ];
  assert.equal(detectDuplicates(rows).length, 0, "a lead and a deal sharing an email are not a lead-dupe");
});

test("email match, same name, recent -> Same person / Merge; survivor is the earliest", () => {
  const rows = [
    lead({ id: "new", monday_item_id: 200, first_name: "Ana", last_name: "Beltran", email: "ana@x.com", monday_created_at: "2026-05-10" }),
    lead({ id: "old", monday_item_id: 100, first_name: "Ana", last_name: "Beltran", email: "ana@x.com", monday_created_at: "2026-05-01" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c.length, 1);
  assert.equal(c[0].pairKey, "100-200");
  assert.equal(c[0].survivor.monday_item_id, 100, "earliest is the survivor");
  assert.equal(c[0].duplicate.monday_item_id, 200);
  assert.equal(c[0].verdict, "Same person");
  assert.equal(c[0].defaultDecision, "merged");
  assert.equal(c[0].basis, "email");
});

test("same name but the existing record is old -> re-engagement / Merge and reopen", () => {
  const rows = [
    lead({ id: "old", monday_item_id: 1, first_name: "Luis", last_name: "Herrera", email: "l@x.com", monday_created_at: "2024-08-01" }),
    lead({ id: "new", monday_item_id: 2, first_name: "Luis", last_name: "Herrera", email: "l@x.com", monday_created_at: "2026-08-09" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c[0].verdict, "Same person — re-engagement");
  assert.equal(c[0].action, "Merge and reopen");
  assert.equal(c[0].defaultDecision, "reopened");
});

test("phone match, different partial name (initials, no email) -> Likely same household", () => {
  const rows = [
    lead({ id: "old", monday_item_id: 1, first_name: "Luis", last_name: "Herrera", email: "l@x.com", phone: "2138873320", monday_created_at: "2026-08-01" }),
    lead({ id: "new", monday_item_id: 2, name: "J. Herrera", email: "", phone: "2138873320", monday_created_at: "2026-08-05" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c[0].verdict, "Likely same household");
  assert.equal(c[0].basis, "phone");
  assert.equal(c[0].defaultDecision, "merged");
});

test("contact match but clearly different full names -> Name differs — confirm", () => {
  const rows = [
    lead({ id: "a", monday_item_id: 1, first_name: "Maria", last_name: "Lopez", phone: "3105550000", email: "shared@x.com", monday_created_at: "2026-08-01" }),
    lead({ id: "b", monday_item_id: 2, first_name: "Carlos", last_name: "Nguyen", phone: "3105550000", email: "shared@x.com", monday_created_at: "2026-08-02" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c[0].verdict, "Name differs — confirm");
  assert.equal(c[0].verdictTone, "alert");
});

test("transitive grouping: A~B by email, B~C by phone -> one cluster, two candidates vs the survivor", () => {
  const rows = [
    lead({ id: "A", monday_item_id: 1, first_name: "Ana", email: "ana@x.com", phone: "1112223333", monday_created_at: "2026-05-01" }),
    lead({ id: "B", monday_item_id: 2, first_name: "Ana", email: "ana@x.com", phone: "9998887777", monday_created_at: "2026-05-02" }),
    lead({ id: "C", monday_item_id: 3, first_name: "Ana", email: "other@x.com", phone: "9998887777", monday_created_at: "2026-05-03" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c.length, 2, "3-lead cluster -> 2 candidate pairs");
  assert.ok(c.every((x) => x.survivor.monday_item_id === 1), "both paired against the earliest survivor");
  assert.deepEqual(c.map((x) => x.duplicate.monday_item_id).sort(), [2, 3]);
});

test("queue ordering puts confirm/re-engagement before plain merges", () => {
  const rows = [
    // a plain same-person pair
    lead({ id: "s1", monday_item_id: 10, first_name: "Sam", email: "sam@x.com", monday_created_at: "2026-05-01" }),
    lead({ id: "s2", monday_item_id: 11, first_name: "Sam", email: "sam@x.com", monday_created_at: "2026-05-02" }),
    // a name-differs pair
    lead({ id: "d1", monday_item_id: 20, first_name: "Maria", last_name: "Lopez", email: "dup@x.com", monday_created_at: "2026-05-01" }),
    lead({ id: "d2", monday_item_id: 21, first_name: "Carlos", last_name: "Kim", email: "dup@x.com", monday_created_at: "2026-05-02" }),
  ];
  const c = detectDuplicates(rows);
  assert.equal(c[0].verdict, "Name differs — confirm", "alert sorts first");
  assert.equal(c[c.length - 1].verdict, "Same person", "ok sorts last");
});
