// Field normalization shared by the WhatConverts matching engine. Pure, no
// I/O. Kept in its own module (not folded into matching/attribution/
// dashboard) so exactly one normalization is used everywhere and can be
// unit-tested on its own.

/** trim + lowercase; null for empty or anything without an "@". */
export function normalizeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || !s.includes("@")) return null;
  return s;
}

/**
 * Digits-only phone with light North-American country-code normalization: an
 * 11-digit number starting with "1" is treated as +1 and reduced to its
 * 10-digit national form, so "+1 (818) 442-0197", "818-442-0197" and
 * "18184420197" all normalize to "8184420197". Numbers that don't look
 * North-American keep their full digit string. Returns null if fewer than 7
 * digits remain (too little to match on safely).
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 7) return null;
  return digits;
}

/** trim + lowercase + collapse internal whitespace; null for empty. */
export function normalizeName(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return s || null;
}
