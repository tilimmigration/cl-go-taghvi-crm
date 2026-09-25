// Layer 3 — Dashboard aggregation / reconciliation.
//
// SEPARATE from matching (Layer 1) and first-touch attribution (Layer 2). It
// takes the first-touch results (Layer 2's output) and:
//   1. counts UNIQUE CRM leads per normalized channel (each lead once), and
//   2. reconciles that against the existing dashboard's channel numbers,
//      verifying the invariant
//        Google Ads + Meta Ads + Organic + Phone + Referral + Direct + Other
//          = total unique attributed CRM leads.
//
// It never hardcodes the existing dashboard figures — the caller passes them
// in (the dry-run reads them from src/data.js's CHANNELS), keyed by the same
// display label used here.

import { CHANNELS, CHANNEL_DISPLAY_LABEL, type Channel, type FirstTouchResult } from "./attribution.ts";

export interface ChannelAggregate {
  byChannel: Record<Channel, number>;
  totalAttributed: number;
}

/** Count unique CRM leads per first-touch channel. A lead is counted once. */
export function aggregateFirstTouchChannels(firstTouch: FirstTouchResult[]): ChannelAggregate {
  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>;
  const seen = new Set<string>();
  for (const ft of firstTouch) {
    if (seen.has(ft.crmLeadId)) continue;
    seen.add(ft.crmLeadId);
    byChannel[ft.channel] += 1;
  }
  return { byChannel, totalAttributed: seen.size };
}

export interface ReconcileRow {
  channel: Channel;
  displayLabel: string;
  existing: number | null;
  whatConverts: number;
  difference: number | null;
}

export interface Reconciliation {
  rows: ReconcileRow[];
  sumOfChannels: number;
  totalAttributed: number;
  reconciles: boolean;
  existingTotal: number | null;
}

/**
 * Build the comparison table + verify the sum invariant.
 * `existingByLabel` maps a display label ("Google Ads", "Website — organic",
 * ...) to the current dashboard count, or null where the dashboard shows "—".
 * The special key "__total__" carries the dashboard's Total, if known.
 */
export function reconcile(agg: ChannelAggregate, existingByLabel: Record<string, number | null> = {}): Reconciliation {
  const rows: ReconcileRow[] = CHANNELS.map((channel) => {
    const displayLabel = CHANNEL_DISPLAY_LABEL[channel];
    const existing = existingByLabel[displayLabel] ?? null;
    const whatConverts = agg.byChannel[channel];
    return { channel, displayLabel, existing, whatConverts, difference: existing == null ? null : whatConverts - existing };
  });
  const sumOfChannels = CHANNELS.reduce((s, c) => s + agg.byChannel[c], 0);
  return {
    rows,
    sumOfChannels,
    totalAttributed: agg.totalAttributed,
    reconciles: sumOfChannels === agg.totalAttributed,
    existingTotal: existingByLabel.__total__ ?? null,
  };
}
