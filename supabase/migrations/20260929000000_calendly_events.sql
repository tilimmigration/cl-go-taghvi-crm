-- Calendly CE (Case Evaluation) appointments — DATABASE LAYER ONLY.
--
-- Adds ONE new isolated table, public.calendly_events, that stores Calendly
-- consultation bookings and links each matched booking back to a CRM lead. It
-- does NOT touch crm_leads / crm_calls / crm_deals, the Monday sync, or the
-- WhatConverts layer. Nothing here writes to crm_leads.status — Monday owns
-- that field and overwrites it on every sync — so a lead's CE status is DERIVED
-- from this separate table at read time (the same separate-layer pattern used
-- by lead_attribution and lead_dedup_decisions, joined by monday_item_id).
--
-- Terminology kept as the existing dashboard uses it: CE Booked / CE Completed.
--
--   CE Booked    — DERIVED AUTOMATICALLY from Calendly. Calendly is the source
--                  of truth. A booking whose invitee email matched a CRM lead
--                  and whose Calendly appointment is still active counts as CE
--                  Booked (the generated ce_booked column below).
--
--   CE Completed — EXPLICIT confirmation ONLY. It is never derived from the
--                  appointment time passing, the event being in the past,
--                  invitee.created, invitee.canceled, or a no-show. A CE counts
--                  as completed only when a CRM user explicitly confirms it,
--                  which records ce_completed + ce_completed_at + ce_completed_by.
--                  This migration provides the storage and integrity for that
--                  action; the "Confirm CE Completed" UI / write path is a LATER
--                  step (see the RLS note at the bottom).
--
-- Scope of THIS step: the database layer only. No Edge Function / webhook and no
-- UI are created here. The webhook (a later step) will INSERT/UPSERT rows using
-- the Supabase service role, which bypasses RLS.

create extension if not exists pgcrypto;

create table if not exists public.calendly_events (
  id                     uuid primary key default gen_random_uuid(),

  -- Calendly identity / idempotency. One row per Calendly invitee (booking);
  -- a re-delivered webhook upserts onto the same row.
  calendly_invitee_uri   text not null unique,
  calendly_event_uri     text,

  -- Appointment details (from the Calendly payload).
  event_type_name        text,
  invitee_email          text,
  invitee_name           text,
  scheduled_at           timestamptz,
  scheduled_end_at       timestamptz,
  location               text,
  -- Calendly-side lifecycle of the booking itself — NOT the CE status.
  calendly_status        text not null default 'active'
                           check (calendly_status in ('active', 'canceled')),
  canceled_at            timestamptz,
  cancel_reason          text,

  -- Association to the CRM lead. Matched by normalised invitee email against
  -- crm_leads.email. No FK — same convention as lead_attribution and
  -- crm_calls.related_lead_id, so a booking still stores even if its lead is
  -- re-synced, and matched_monday_item_id (globally unique) is the durable
  -- cross-layer join key. Unmatched bookings are retained, never dropped.
  match_status           text not null default 'unmatched'
                           check (match_status in ('matched', 'unmatched')),
  match_method           text,          -- e.g. 'email' (room for 'manual' later)
  matched_crm_lead_id    uuid,          -- crm_leads.id, best-effort (populated for matches)
  matched_monday_item_id bigint,        -- the lead's monday_item_id (the join key)

  -- CE Booked: DERIVED automatically. A matched booking that is still active is
  -- CE Booked. Generated (always consistent, never written by hand): a
  -- cancellation flips it back to false; a rebooking (a new active row) restores
  -- it. Calendly is the source of truth for CE Booked.
  ce_booked              boolean
                           generated always as (match_status = 'matched' and calendly_status = 'active') stored,

  -- CE Completed: EXPLICIT confirmation only (see header). Defaults to not
  -- completed; set true only by a deliberate CRM confirm action, which must also
  -- record WHEN (ce_completed_at) and WHO (ce_completed_by).
  ce_completed           boolean not null default false,
  ce_completed_at        timestamptz,
  ce_completed_by        text,          -- authenticated CRM user's email
  ce_completed_note      text,          -- optional note captured at confirmation

  -- Full Calendly webhook payload for audit and any field without a column.
  raw_payload            jsonb not null default '{}'::jsonb,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- A confirmed completion must carry who + when (keeps the explicit-confirm
  -- contract enforceable at the database, and still lets ce_completed be reset
  -- to false later).
  constraint calendly_events_completion_requires_who_when
    check (ce_completed = false or (ce_completed_at is not null and ce_completed_by is not null)),

  -- A matched booking carries the lead join key; an unmatched one carries no
  -- lead references.
  constraint calendly_events_match_refs
    check (
      (match_status = 'matched' and matched_monday_item_id is not null)
      or (match_status = 'unmatched' and matched_monday_item_id is null and matched_crm_lead_id is null)
    )
);

comment on table public.calendly_events is
  'Calendly CE (Case Evaluation) bookings linked to a CRM lead by matched invitee email. Separate layer — never writes crm_leads/Monday. CE Booked is derived automatically (ce_booked); CE Completed is explicit confirmation only (ce_completed/_at/_by).';
comment on column public.calendly_events.calendly_invitee_uri is
  'Calendly invitee URI — the idempotency key; one row per booking. Re-delivered webhooks upsert onto this.';
comment on column public.calendly_events.matched_monday_item_id is
  'monday_item_id of the matched crm_leads row (globally unique) — the durable cross-layer join key, mirroring lead_attribution.monday_item_id. No FK.';
comment on column public.calendly_events.matched_crm_lead_id is
  'crm_leads.id of the matched lead, populated best-effort at match time (no FK, to avoid coupling to Monday re-sync).';
comment on column public.calendly_events.calendly_status is
  'Calendly-side status of the booking (active | canceled) — NOT the CE status. Drives the derived ce_booked flag.';
comment on column public.calendly_events.ce_booked is
  'DERIVED: true when the booking matched a CRM lead and is still active. Calendly is the source of truth for CE Booked. Generated column — never written directly.';
comment on column public.calendly_events.ce_completed is
  'EXPLICIT confirmation only. Never auto-set from appointment time, past events, invitee.created/canceled, or no-shows. Set true only by a deliberate CRM confirm action, together with ce_completed_at and ce_completed_by.';
comment on column public.calendly_events.ce_completed_by is
  'Email of the authenticated CRM user who confirmed the CE as completed.';

-- Indexes: idempotency (the unique constraint above), the lead join keys, email
-- matching, appointment time, and the two flags dashboard counts will read.
create index if not exists calendly_events_monday_item_id_idx on public.calendly_events (matched_monday_item_id);
create index if not exists calendly_events_crm_lead_id_idx on public.calendly_events (matched_crm_lead_id);
create index if not exists calendly_events_invitee_email_idx on public.calendly_events (lower(invitee_email));
create index if not exists calendly_events_scheduled_at_idx on public.calendly_events (scheduled_at);
create index if not exists calendly_events_ce_booked_idx on public.calendly_events (ce_booked) where ce_booked;
create index if not exists calendly_events_ce_completed_idx on public.calendly_events (ce_completed) where ce_completed;

-- updated_at maintenance: reuse the existing generic trigger function
-- public.set_updated_at() (already used by crm_leads / lead_attribution / ...).
drop trigger if exists calendly_events_set_updated_at on public.calendly_events;
create trigger calendly_events_set_updated_at
  before update on public.calendly_events
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Holds invitee PII (email / name), so reads require an allowlisted signed-in
-- user — same posture as crm_leads / lead_attribution. The webhook (a later
-- step) writes with the service role, which bypasses RLS, so NO insert/update
-- policy is added here.
--
-- The explicit "Confirm CE Completed" write path is intentionally DEFERRED to
-- the next step. When it is built, the recommended shape is a SECURITY DEFINER
-- RPC (or a column-scoped allowlisted UPDATE policy) that sets ce_completed =
-- true, ce_completed_at = now(), and ce_completed_by = lower(auth.jwt() ->>
-- 'email') for an allowlisted caller — so completion can only be set
-- deliberately, by a known user, and never by the browser rewriting other
-- columns. The columns above are already shaped for exactly that.
-- ---------------------------------------------------------------------------
alter table public.calendly_events enable row level security;

drop policy if exists "calendly_events_read_allowlisted" on public.calendly_events;
create policy "calendly_events_read_allowlisted"
  on public.calendly_events
  for select
  to authenticated
  using (
    exists (select 1 from public.crm_allowed_users u where u.email = lower(auth.jwt() ->> 'email'))
  );
