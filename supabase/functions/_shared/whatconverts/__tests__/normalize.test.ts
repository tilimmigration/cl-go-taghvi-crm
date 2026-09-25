import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, normalizeName, normalizePhone } from "../normalize.ts";

test("normalizeEmail trims + lowercases, rejects non-emails", () => {
  assert.equal(normalizeEmail("  Ana.Beltran@Gmail.com "), "ana.beltran@gmail.com");
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(null), null);
});

test("normalizePhone reduces to a canonical digit string (US country-code aware)", () => {
  assert.equal(normalizePhone("+1 (818) 442-0197"), "8184420197");
  assert.equal(normalizePhone("818-442-0197"), "8184420197");
  assert.equal(normalizePhone("1 818 442 0197"), "8184420197");
  assert.equal(normalizePhone("18184420197"), "8184420197");
});

test("normalizePhone keeps non-US numbers whole and rejects too-short input", () => {
  assert.equal(normalizePhone("+44 20 7946 0000"), "442079460000");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone(null), null);
});

test("normalizeName trims, lowercases, collapses whitespace", () => {
  assert.equal(normalizeName("  Ana   Beltrán "), "ana beltrán");
  assert.equal(normalizeName("JOHN\tDOE"), "john doe");
  assert.equal(normalizeName("   "), null);
});
