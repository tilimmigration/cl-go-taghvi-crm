-- WhatConverts attribution persistence (Step 5): match state + normalized channel.
--
-- Additive columns on lead_attribution only. Does NOT touch crm_leads /
-- crm_calls / crm_deals or the Monday integration, and creates no CRM leads.
--
-- Why these columns:
--   * match_status — a persisted row must record whether its WhatConverts lead
--     matched a CRM lead, matched nothing, or was ambiguous. Unmatched AND
--     ambiguous both carry monday_item_id = NULL and match_method = NULL, so a
--     status column is what tells them apart.
--   * candidate_crm_lead_ids — for ambiguous rows, the crm_leads.id candidates
--     the lead matched, retained so a human can resolve it later. The importer
--     never auto-chooses among them.
--   * match_reason — the human-readable match / unmatched / ambiguous reason.
--   * channel — the normalized channel for this WhatConverts lead (Google Ads /
--     Meta Ads / Organic / Phone / Referral / Direct / Other) from the shared
--     classifier. First-touch per CRM lead = the channel of the earliest
--     attribution_created_at row for that monday_item_id.

alter table public.lead_attribution
  add column if not exists channel                text,
  add column if not exists match_status           text,
  add column if not exists match_reason           text,
  add column if not exists candidate_crm_lead_ids text[];

comment on column public.lead_attribution.channel is
  'Normalized channel for this WhatConverts lead (Google Ads/Meta Ads/Organic/Phone/Referral/Direct/Other). First-touch per CRM lead = channel of the earliest attribution_created_at row for that monday_item_id.';
comment on column public.lead_attribution.match_status is
  'matched | unmatched | ambiguous. Distinguishes unmatched from ambiguous (both carry monday_item_id/match_method NULL).';
comment on column public.lead_attribution.match_reason is
  'Human-readable reason: the match reason (matched), unmatched reason, or ambiguous reason.';
comment on column public.lead_attribution.candidate_crm_lead_ids is
  'Ambiguous rows only: the crm_leads.id candidates matched, retained for later manual resolution. The importer never auto-chooses.';

alter table public.lead_attribution
  drop constraint if exists lead_attribution_match_status_check;
alter table public.lead_attribution
  add constraint lead_attribution_match_status_check
  check (match_status is null or match_status in ('matched', 'unmatched', 'ambiguous'));

-- Enforce the core persistence rule at the DB level: a matched row must carry a
-- monday_item_id; unmatched/ambiguous rows must not. (NULL status is allowed so
-- the constraint doesn't reject any legacy row shape.)
alter table public.lead_attribution
  drop constraint if exists lead_attribution_matched_monday_item;
alter table public.lead_attribution
  add constraint lead_attribution_matched_monday_item
  check (
    match_status is null
    or (match_status = 'matched' and monday_item_id is not null)
    or (match_status in ('unmatched', 'ambiguous') and monday_item_id is null)
  );

create index if not exists lead_attribution_match_status_idx on public.lead_attribution (match_status);
create index if not exists lead_attribution_channel_idx on public.lead_attribution (channel);
