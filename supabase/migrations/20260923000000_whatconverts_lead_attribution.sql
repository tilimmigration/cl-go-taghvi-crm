-- WhatConverts attribution layer (database only).
--
-- Adds ONE new, isolated table — public.lead_attribution — and nothing else.
-- It deliberately does NOT touch the Monday sync tables (crm_leads /
-- crm_calls / crm_deals), the Monday sync logic, or any existing lead
-- record, and it creates NO CRM leads. No matching is implemented here; this
-- migration only provides the storage a later matching step will write into.
--
-- What one row is:
--   A link from a WhatConverts lead (whatconverts_lead_id) to a Monday CRM
--   lead (monday_item_id — the same Monday pulse/item id already stored on
--   crm_leads.monday_item_id) carrying that lead's marketing attribution
--   (source / medium / campaign / ... / gclid / fbclid). This is a SEPARATE
--   attribution table, never a second copy of a lead — nothing here creates,
--   modifies, or duplicates a CRM lead.
--
-- Join by monday_item_id, NOT a foreign key:
--   crm_leads' external identity is the PAIR (monday_board_id,
--   monday_item_id), so monday_item_id alone is not a unique key there and
--   cannot be an FK target. Monday item ids are globally unique across the
--   account, so `lead_attribution.monday_item_id = crm_leads.monday_item_id`
--   is still an unambiguous join. Following the same no-FK convention as
--   crm_calls / crm_deals.related_lead_monday_item_id, this stays a raw
--   external reference with no FK, so attribution can be written without
--   coupling to Monday import order and without ever touching crm_leads.
--
-- Normalized vs. raw:
--   source / medium / campaign hold CRM-normalized channel values.
--   raw_source / raw_medium / raw_campaign preserve the ORIGINAL WhatConverts
--   values verbatim, and raw_attribution (jsonb) keeps the full WhatConverts
--   lead payload for audit and for any attribution field without a dedicated
--   column. Normalization never overwrites the raw values.

create extension if not exists pgcrypto;

create table if not exists public.lead_attribution (
  id                     uuid primary key default gen_random_uuid(),

  -- External identities (no FK — see header). Both required, so every row
  -- links exactly one WhatConverts lead to exactly one Monday lead; the
  -- unique constraint below then prevents duplicate attribution per pair.
  monday_item_id         bigint not null,
  whatconverts_lead_id   bigint not null,

  -- How the link was made — populated by the future matching step, left null
  -- until then. match_method is free text on purpose so the matching design
  -- isn't constrained here; match_confidence is a 0..1 score.
  match_method           text,
  match_confidence       numeric(5,4),

  -- Normalized (CRM) attribution.
  source                 text,
  medium                 text,
  campaign               text,
  content                text,
  keyword                text,
  referrer               text,
  landing_page           text,
  gclid                  text,
  fbclid                 text,
  lead_type              text,

  -- Raw attribution, preserved separately from the normalized values above.
  raw_source             text,
  raw_medium             text,
  raw_campaign           text,
  -- Full WhatConverts lead payload for audit + any attribution field without
  -- a dedicated column (msclkid, utm_term, ad group, ...). Beyond the
  -- suggested field list, mirroring crm_leads.raw_column_values' audit role.
  raw_attribution        jsonb not null default '{}'::jsonb,

  -- Timestamps. attribution_created_at is the WhatConverts-side lead creation
  -- time; the others are local bookkeeping.
  attribution_created_at timestamptz,
  last_synced_at         timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint lead_attribution_confidence_range
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),

  -- Prevent duplicate attribution for the same WhatConverts lead + Monday
  -- item. This constraint's underlying index also serves lookups/joins that
  -- filter by whatconverts_lead_id (its leading column), so no separate index
  -- on that column is created.
  constraint lead_attribution_wc_monday_unique
    unique (whatconverts_lead_id, monday_item_id)
);

comment on table public.lead_attribution is
  'WhatConverts marketing attribution linked to Monday CRM leads by monday_item_id. Separate from crm_leads; never creates or modifies a CRM lead. One row per (whatconverts_lead_id, monday_item_id).';
comment on column public.lead_attribution.monday_item_id is
  'Monday pulse/item id of the linked lead (matches crm_leads.monday_item_id). Raw external reference, no FK — Monday item ids are globally unique so the join is unambiguous.';
comment on column public.lead_attribution.whatconverts_lead_id is
  'WhatConverts lead_id this attribution row came from.';
comment on column public.lead_attribution.match_method is
  'How the WhatConverts lead was matched to the Monday lead (e.g. email, phone, manual). Free text; set by the matching step, which is NOT implemented yet.';
comment on column public.lead_attribution.match_confidence is
  '0..1 confidence of the match, or null when unknown / not yet matched.';
comment on column public.lead_attribution.source is
  'CRM-normalized traffic source; raw_source keeps the original WhatConverts value.';
comment on column public.lead_attribution.raw_source is
  'Original WhatConverts source, preserved verbatim (see source for the normalized value).';
comment on column public.lead_attribution.raw_attribution is
  'Full WhatConverts lead payload for audit and any attribution field without a dedicated column.';

-- Indexes. The composite unique constraint already indexes whatconverts_lead_id
-- (its leading column); monday_item_id — the join key used from the
-- read/dashboard side — gets its own index here.
create index if not exists lead_attribution_monday_item_id_idx
  on public.lead_attribution (monday_item_id);

-- updated_at maintenance: reuse the existing generic trigger function
-- public.set_updated_at() (created for crm_leads, already reused by
-- crm_calls / crm_deals). It is not Monday-specific.
drop trigger if exists lead_attribution_set_updated_at on public.lead_attribution;
create trigger lead_attribution_set_updated_at
  before update on public.lead_attribution
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Same posture as crm_leads: attribution is lead-level business data (it
-- includes click ids such as gclid / fbclid), so reads require a signed-in
-- user whose email is on the crm_allowed_users allowlist. Writes happen ONLY
-- via the service role (the future WhatConverts sync / matching Edge
-- Function), which bypasses RLS — so no insert/update/delete policy is added.
-- ---------------------------------------------------------------------------
alter table public.lead_attribution enable row level security;

drop policy if exists "lead_attribution_read_allowlisted" on public.lead_attribution;
create policy "lead_attribution_read_allowlisted"
  on public.lead_attribution
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.crm_allowed_users u
      where u.email = lower(auth.jwt() ->> 'email')
    )
  );
