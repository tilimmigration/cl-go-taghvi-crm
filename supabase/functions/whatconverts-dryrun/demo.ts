// Runnable dry-run demonstration:
//   node --experimental-strip-types supabase/functions/whatconverts-dryrun/demo.ts
//
// This runs the REAL matching -> first-touch -> reconciliation pipeline. The
// crm_leads + WhatConverts leads here are a small SYNTHETIC fixture (no PII,
// no live API) so the mechanism and the report format are reproducible
// offline. The existing dashboard numbers are read from src/data.js's
// CHANNELS export — NOT hardcoded here. The live report (real WhatConverts +
// real crm_leads) is produced by the whatconverts-dryrun Edge Function once
// the WhatConverts secrets are set.

import { runDryRun } from "../_shared/whatconverts/dryrun.ts";
import type { CrmLeadLike, WhatConvertsLeadLike } from "../_shared/whatconverts/matching.ts";
// @ts-ignore — plain JS ESM from the frontend, imported for its CHANNELS data only.
import { CHANNELS as DASH_CHANNELS } from "../../../src/data.js";

function existingFromDashboard(): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of DASH_CHANNELS as Array<{ name: string; leads: string }>) {
    const n = parseInt(String(c.leads).replace(/[^0-9]/g, ""), 10);
    const value = Number.isFinite(n) ? n : null;
    if (c.name === "Total") out.__total__ = value;
    else out[c.name] = value;
  }
  return out;
}

// --- synthetic fixture ------------------------------------------------------
function crm(id: string, email: string, phone: string | null, name: string, created: string): CrmLeadLike {
  return {
    id,
    monday_item_id: Number(id.replace(/\D/g, "")) + 9000,
    name,
    first_name: name.split(" ")[0],
    last_name: name.split(" ")[1] ?? null,
    email,
    phone: null, // like the live board: phone lives in custom_fields
    custom_fields: phone ? { c: { title: "Phone Number", type: "text", text: phone } } : null,
    raw_column_values: null,
    monday_created_at: created,
  };
}
function wc(o: Partial<WhatConvertsLeadLike> & { lead_id: number }): WhatConvertsLeadLike {
  return { email_address: null, phone_number: null, contact_name: null, date_created: "2026-06-01", ...o };
}

const CRM: CrmLeadLike[] = [
  crm("L01", "ana@x.com", "555-000-0001", "Ana Beltran", "2026-06-01"),
  crm("L02", "leo@x.com", "555-000-0002", "Leo Park", "2026-06-02"),
  crm("L03", "mei@x.com", "555-000-0003", "Mei Chen", "2026-06-03"),
  crm("L04", "raj@x.com", "555-000-0004", "Raj Patel", "2026-06-04"),
  crm("L05", "sam@x.com", "555-000-0005", "Sam Cole", "2026-06-05"),
  crm("L06", "eva@x.com", "555-000-0006", "Eva Ruiz", "2026-06-06"),
  crm("L07", "omar@x.com", "555-000-0007", "Omar Diaz", "2026-06-07"),
  crm("L08", "tom@x.com", "555-000-0008", "Tom Ford", "2026-06-08"),
  crm("L09", "ivy@x.com", "555-000-0009", "Ivy Long", "2026-06-09"),
  crm("L10", "kai@x.com", "555-000-0010", "Kai Nash", "2026-06-10"),
  crm("L11", "zoe@x.com", "555-000-0011", "Zoe Kim", "2026-06-11"),
  crm("L12", "shared@x.com", null, "Pat Twin", "2026-06-12"),
  crm("L13", "shared@x.com", null, "Pat Twin", "2026-06-13"),
];

const WC: WhatConvertsLeadLike[] = [
  // L01 — multi-touch: Google (first) -> Meta -> Phone
  wc({ lead_id: 1, email_address: "ana@x.com", date_created: "2026-06-01", lead_source: "google", lead_medium: "cpc" }),
  wc({ lead_id: 2, email_address: "ana@x.com", date_created: "2026-06-03", lead_source: "facebook", lead_medium: "cpc" }),
  wc({ lead_id: 3, phone_number: "5550000001", date_created: "2026-06-07", lead_type: "Phone Call" }),
  // Google Ads
  wc({ lead_id: 4, email_address: "leo@x.com", date_created: "2026-06-02", gclid: "g-123" }),
  wc({ lead_id: 5, email_address: "mei@x.com", date_created: "2026-06-03", lead_source: "google", lead_medium: "ppc" }),
  // Meta Ads
  wc({ lead_id: 6, email_address: "raj@x.com", date_created: "2026-06-04", fbclid: "f-123" }),
  wc({ lead_id: 7, email_address: "sam@x.com", date_created: "2026-06-05", lead_source: "instagram", lead_medium: "paid_social" }),
  // Organic
  wc({ lead_id: 8, email_address: "eva@x.com", date_created: "2026-06-06", lead_source: "google", lead_medium: "organic" }),
  wc({ lead_id: 9, email_address: "omar@x.com", date_created: "2026-06-07", lead_source: "bing", lead_medium: "organic" }),
  // Phone
  wc({ lead_id: 10, phone_number: "5550000008", date_created: "2026-06-08", lead_type: "Phone Call" }),
  // Referral
  wc({ lead_id: 11, email_address: "ivy@x.com", date_created: "2026-06-09", lead_source: "avvo.com", lead_medium: "referral" }),
  // Direct
  wc({ lead_id: 12, email_address: "kai@x.com", date_created: "2026-06-10", lead_source: "direct", lead_medium: "none" }),
  // Other
  wc({ lead_id: 13, email_address: "zoe@x.com", date_created: "2026-06-11", lead_source: "tiktok", lead_medium: "video" }),
  // Ambiguous (L12 / L13 share an email, no phone to disambiguate)
  wc({ lead_id: 14, email_address: "shared@x.com", date_created: "2026-06-12" }),
  // Unmatched
  wc({ lead_id: 15, email_address: "stranger@x.com", date_created: "2026-06-12" }),
];

const report = runDryRun({ crmLeads: CRM, whatConvertsLeads: WC, existingChannels: existingFromDashboard() });

const dash = (v: number | null) => (v == null ? "—" : String(v));
const diff = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}` : String(v));

console.log("\n=== WHATCONVERTS DRY RUN (synthetic fixture; existing numbers from src/data.js) ===\n");
console.log("MATCHING");
console.log(`  Total WhatConverts leads : ${report.matching.totalWhatConvertsLeads}`);
console.log(`  Matched                  : ${report.matching.matched}`);
console.log(`  Unmatched                : ${report.matching.unmatched}`);
console.log(`  Ambiguous                : ${report.matching.ambiguous}`);
console.log(`  By method                : ${JSON.stringify(report.matching.byMethod)}`);
console.log(`  By confidence            : ${JSON.stringify(report.matching.byConfidence)}`);

console.log("\nFIRST-TOUCH CHANNELS (unique CRM leads)");
for (const [ch, n] of Object.entries(report.firstTouch.byChannel)) console.log(`  ${ch.padEnd(12)} : ${n}`);
console.log(`  ${"TOTAL".padEnd(12)} : ${report.firstTouch.totalAttributed}`);

console.log("\nRECONCILIATION");
console.log(`  ${"Channel".padEnd(20)} ${"Existing".padStart(9)} ${"WC".padStart(6)} ${"Diff".padStart(6)}`);
for (const row of report.reconciliation.rows) {
  console.log(`  ${row.displayLabel.padEnd(20)} ${dash(row.existing).padStart(9)} ${String(row.whatConverts).padStart(6)} ${diff(row.difference).padStart(6)}`);
}
console.log(`  ${"Total".padEnd(20)} ${dash(report.reconciliation.existingTotal).padStart(9)} ${String(report.reconciliation.sumOfChannels).padStart(6)}`);
console.log(`  sum(channels)=${report.reconciliation.sumOfChannels}  totalAttributed=${report.reconciliation.totalAttributed}  reconciles=${report.reconciliation.reconciles}`);

console.log("\nEXAMPLES (PII redacted)");
console.log(`  ${JSON.stringify(report.examples.emailMatch)}`);
console.log(`  ${JSON.stringify(report.examples.phoneMatch)}`);
console.log(`  ${JSON.stringify(report.examples.unmatched)}`);
console.log(`  ${JSON.stringify(report.examples.ambiguous)}`);
console.log(`  ${JSON.stringify(report.examples.multiTouchFirstTouch)}`);
console.log("");
