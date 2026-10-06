// Calendly webhook signature verification.
//
// Calendly signs each webhook with the subscription's signing key and sends the
// signature in the `Calendly-Webhook-Signature` header, formatted as:
//     t=<unix_seconds>,v1=<hex HMAC-SHA256>
// The signed content is `${t}.${rawRequestBody}` and the algorithm is
// HMAC-SHA256 (hex). Verification must run against the EXACT raw request body
// (not a re-serialized JSON), so the caller passes the raw text. We also reject
// timestamps outside a tolerance window to blunt replay attacks.
//
// Pure and dependency-injectable (takes `nowMs`) so it is unit-testable. Uses
// Web Crypto (globalThis.crypto.subtle), available in both Deno and Node 20+.

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

function parseSignatureHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  let hex = "";
  for (const b of new Uint8Array(sig)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string comparison (avoids leaking match progress via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  signingKey: string,
  opts: { nowMs: number; toleranceSeconds: number },
): Promise<VerifyResult> {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parsed = parseSignatureHeader(header);
  const t = parsed["t"];
  const v1 = parsed["v1"];
  if (!t || !v1) return { ok: false, reason: "malformed signature header" };

  const tsSec = Number(t);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: "invalid timestamp" };
  if (opts.toleranceSeconds > 0 && Math.abs(Math.floor(opts.nowMs / 1000) - tsSec) > opts.toleranceSeconds) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = await hmacSha256Hex(`${t}.${rawBody}`, signingKey);
  if (!timingSafeEqual(expected, v1.toLowerCase())) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}
