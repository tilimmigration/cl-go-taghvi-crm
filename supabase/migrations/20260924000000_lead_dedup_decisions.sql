-- Pre-CE deduplication decisions (CRM-dashboard only).
--
-- Adds ONE new, isolated table — public.lead_dedup_decisions — that records a
-- human's triage of a suspected-duplicate lead pair from the Deduplication
-- queue: Merge, Merge-and-reopen (re-engagement), or Keep separate.
--
-- It deliberately does NOT touch crm_leads / crm_calls / crm_deals, the Monday
-- sync, or Monday.com itself. A "merge" here is a RECORDED DECISION the
-- dashboard reflects (the pair collapses to one in the view) — it never
-- rewrites or deletes a lead and is fully reversible. This keeps the decision
-- safe from Monday's full-row upsert, which would clobber anything written
-- onto crm_leads.
--
-- One row per candidate pair, keyed by pair_key (the two monday_item_ids in
-- ascending order joined by '-'), so deciding the same pair again updates the
-- existing row instead of duplicating it.
--
-- Unlike the read-only CRM tables, this table is WRITTEN FROM THE BROWSER by
-- allowlisted signed-in users (there is no Monday/service-role writer for it),
-- so it carries insert/update/delete RLS policies, each gated on the same
-- crm_allowed_users allowlist used for reads. A user may only stamp their own
-- email into decided_by (with check), but decisions are shared: any allowlisted
-- teammate can see and re-decide a pair.

create extension if not exists pgcrypto;

create table if not exists public.lead_dedup_decisions (
  id                        uuid primary key default gen_random_uuid(),

  -- Stable identity of the pair (order-independent), so a decision is
  -- idempotent no matter which side is the survivor.
  pair_key                  text not null unique,

  -- The record kept (the earliest / "existing record") and the one folded into
  -- it. Raw external references (Monday item ids), no FK — same convention as
  -- lead_attribution / crm_deals.related_lead_monday_item_id.
  survivor_monday_item_id   bigint not null,
  duplicate_monday_item_id  bigint not null,
  -- crm_leads.id of each side at decision time, for audit (nullable — the
  -- pairing is defined by the Monday ids above).
  survivor_lead_id          text,
  duplicate_lead_id         text,

  -- How the duplicate was detected, and the queue verdict shown to the human.
  match_basis               text not null check (match_basis in ('email', 'phone', 'email_phone')),
  verdict                   text,

  -- The human's decision.
  decision                  text not null check (decision in ('merged', 'reopened', 'kept_separate')),

  -- Who decided and when (decided_by is the signed-in user's email; enforced
  -- by the insert/update policies below).
  decided_by                text,
  decided_at                timestamptz not null default now(),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint lead_dedup_decisions_distinct_pair
    check (survivor_monday_item_id <> duplicate_monday_item_id)
);

comment on table public.lead_dedup_decisions is
  'Human triage of suspected-duplicate lead pairs from the Pre-CE dedup queue (merge / reopen / keep separate). CRM-dashboard only: a recorded, reversible decision — never rewrites crm_leads and never touches Monday. One row per pair_key.';
comment on column public.lead_dedup_decisions.pair_key is
  'The pair''s two monday_item_ids in ascending order joined by "-" (e.g. "100-200"). Order-independent so the decision is idempotent.';
comment on column public.lead_dedup_decisions.survivor_monday_item_id is
  'Monday item id of the record kept (the earliest / existing lead). Raw external reference, no FK.';
comment on column public.lead_dedup_decisions.decision is
  'merged = fold the duplicate into the survivor; reopened = same person returning (merge + re-engage); kept_separate = not a duplicate, dismiss from the queue.';

create index if not exists lead_dedup_decisions_survivor_idx
  on public.lead_dedup_decisions (survivor_monday_item_id);
create index if not exists lead_dedup_decisions_duplicate_idx
  on public.lead_dedup_decisions (duplicate_monday_item_id);

-- updated_at maintenance: reuse the existing generic trigger function
-- public.set_updated_at() (already used by crm_leads / lead_attribution).
drop trigger if exists lead_dedup_decisions_set_updated_at on public.lead_dedup_decisions;
create trigger lead_dedup_decisions_set_updated_at
  before update on public.lead_dedup_decisions
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Reads: any allowlisted signed-in user (same posture as crm_leads).
-- Writes: allowlisted signed-in users, from the browser. A user may only write
-- rows stamped with their own email in decided_by, but every allowlisted user
-- can see and re-decide any pair (shared team triage). Delete = "undo" a
-- decision (the pair returns to the queue).
-- ---------------------------------------------------------------------------
alter table public.lead_dedup_decisions enable row level security;

drop policy if exists "lead_dedup_decisions_read_allowlisted" on public.lead_dedup_decisions;
create policy "lead_dedup_decisions_read_allowlisted"
  on public.lead_dedup_decisions
  for select
  to authenticated
  using (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
  );

drop policy if exists "lead_dedup_decisions_insert_allowlisted" on public.lead_dedup_decisions;
create policy "lead_dedup_decisions_insert_allowlisted"
  on public.lead_dedup_decisions
  for insert
  to authenticated
  with check (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
    and decided_by = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "lead_dedup_decisions_update_allowlisted" on public.lead_dedup_decisions;
create policy "lead_dedup_decisions_update_allowlisted"
  on public.lead_dedup_decisions
  for update
  to authenticated
  using (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
  )
  with check (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
    and decided_by = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "lead_dedup_decisions_delete_allowlisted" on public.lead_dedup_decisions;
create policy "lead_dedup_decisions_delete_allowlisted"
  on public.lead_dedup_decisions
  for delete
  to authenticated
  using (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
  );
