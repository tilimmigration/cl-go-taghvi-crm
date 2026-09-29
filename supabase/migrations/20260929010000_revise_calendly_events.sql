-- Step 2: Calendly events database layer (refined schema).
--
-- Supersedes the initial draft in 20260929000000_calendly_events.sql, which was
-- empty. Re-creates public.calendly_events to the Step-2 spec: the scheduled
-- EVENT uri is the unique key, status is booked|canceled|no_show, CE Booked is a
-- controlled boolean carrying its own ce_booked_at timestamp, and CE Completed
-- stays explicit-only.
--
-- DATABASE LAYER ONLY. No webhook, no UI, no business logic. This migration
-- touches ONLY public.calendly_events. It does NOT read or write crm_leads,
-- crm_leads.status, crm_calls, crm_deals, the Monday sync, or the WhatConverts
-- layer, and it creates NO foreign keys — a Calendly event can never create,
-- modify, or delete a CRM record. A lead's CE lifecycle is derived from this
-- separate table (joined by monday_item_id / lead_id), never by writing into the
-- Monday-owned crm_leads.status field.

create extension if not exists pgcrypto;

-- The prior draft table is empty; replace it wholesale with the refined schema.
drop table if exists public.calendly_events cascade;

create table public.calendly_events (
  id                  uuid primary key default gen_random_uuid(),

  -- Calendly identity. The scheduled EVENT uri is the unique idempotency key;
  -- the invitee uri is stored when available.
  calendly_event_uri  text not null unique,
  invitee_uri         text,

  -- Invitee. invitee_email is stored NORMALIZED (lowercased + trimmed) so email
  -- matching against crm_leads is reliable — enforced by the BEFORE trigger
  -- below, so it is normalized no matter which caller writes it.
  invitee_email       text,
  invitee_name        text,

  -- Event descriptors.
  event_name          text,
  event_type          text,

  -- Lifecycle timestamps.
  scheduled_at        timestamptz,
  started_at          timestamptz,
  ended_at            timestamptz,

  -- Booking lifecycle. no_show is a valid Calendly status value; it does NOT by
  -- itself imply CE Completed (see ce_completed below).
  status              text not null default 'booked'
                        check (status in ('booked', 'canceled', 'no_show')),
  canceled_at         timestamptz,
  cancel_reason       text,

  -- CRM association — both NULLABLE (an event may arrive before any match). No
  -- FK, deliberately, so a Calendly event can never cascade into a CRM record.
  -- monday_item_id (globally unique) is the durable cross-layer join key,
  -- mirroring lead_attribution.monday_item_id; lead_id is crm_leads.id,
  -- best-effort.
  lead_id             uuid,
  monday_item_id      bigint,

  -- CE Booked — derived/controlled from the Calendly booking (set by the sync
  -- layer, not a manual CRM status change). A valid booking sets ce_booked=true
  -- and ce_booked_at=<booking/scheduled timestamp>. Calendly is the source of
  -- truth for CE Booked.
  ce_booked           boolean not null default false,
  ce_booked_at        timestamptz,

  -- CE Completed — EXPLICIT confirmation ONLY. Never inferred from elapsed time,
  -- the scheduled time passing, the booking, a cancellation, a no-show, event
  -- duration, or any other automatic assumption. Set true only by a deliberate
  -- completion confirmation, together with when + who.
  ce_completed        boolean not null default false,
  ce_completed_at     timestamptz,
  ce_completed_by     text,

  -- Original Calendly payload for audit and any field without a column.
  raw_payload         jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- CE Booked preserves its booking timestamp.
  constraint calendly_events_booked_requires_at
    check (ce_booked = false or ce_booked_at is not null),
  -- A confirmed completion preserves when + who.
  constraint calendly_events_completion_requires_who_when
    check (ce_completed = false or (ce_completed_at is not null and ce_completed_by is not null))
);

comment on table public.calendly_events is
  'Calendly bookings/events and the derived CE (Case Evaluation) lifecycle. Separate layer — never writes crm_leads/crm_leads.status/Monday. CE Booked is controlled by the Calendly booking (ce_booked/ce_booked_at); CE Completed is explicit confirmation only (ce_completed/_at/_by).';
comment on column public.calendly_events.calendly_event_uri is
  'Calendly scheduled-event URI — the unique idempotency key; re-delivered events upsert onto this row.';
comment on column public.calendly_events.invitee_email is
  'Invitee email, stored normalized (lowercased + trimmed) for reliable matching against crm_leads.email. Normalization is enforced by a BEFORE INSERT/UPDATE trigger.';
comment on column public.calendly_events.monday_item_id is
  'monday_item_id of the associated crm_leads row (globally unique) — the durable cross-layer join key. Nullable; no FK.';
comment on column public.calendly_events.lead_id is
  'crm_leads.id of the associated lead, best-effort. Nullable; no FK, so a Calendly event never cascades into CRM records.';
comment on column public.calendly_events.ce_booked is
  'Derived/controlled from the Calendly booking (not a manual CRM status). A valid booking sets this true with ce_booked_at. Calendly is the source of truth for CE Booked.';
comment on column public.calendly_events.ce_completed is
  'EXPLICIT confirmation only. Never inferred from time, scheduling, booking, cancellation, no-show, or duration. Requires ce_completed_at and ce_completed_by when true.';
comment on column public.calendly_events.ce_completed_by is
  'Person/system that explicitly confirmed completion (e.g. the authenticated CRM user email).';

-- Consistent email normalization for reliable matching, regardless of caller.
create or replace function public.calendly_events_normalize_email()
returns trigger
language plpgsql
as $$
begin
  new.invitee_email = nullif(lower(btrim(new.invitee_email)), '');
  return new;
end;
$$;

drop trigger if exists calendly_events_normalize_email on public.calendly_events;
create trigger calendly_events_normalize_email
  before insert or update on public.calendly_events
  for each row
  execute function public.calendly_events_normalize_email();

-- updated_at maintenance: reuse the existing generic trigger function.
drop trigger if exists calendly_events_set_updated_at on public.calendly_events;
create trigger calendly_events_set_updated_at
  before update on public.calendly_events
  for each row
  execute function public.set_updated_at();

-- Indexes for the expected lookups: idempotency (unique above), email matching,
-- the lead join keys, booking status, appointment time, and the CE flags.
create index if not exists calendly_events_invitee_email_idx on public.calendly_events (invitee_email);
create index if not exists calendly_events_invitee_uri_idx on public.calendly_events (invitee_uri);
create index if not exists calendly_events_lead_id_idx on public.calendly_events (lead_id);
create index if not exists calendly_events_monday_item_id_idx on public.calendly_events (monday_item_id);
create index if not exists calendly_events_status_idx on public.calendly_events (status);
create index if not exists calendly_events_scheduled_at_idx on public.calendly_events (scheduled_at);
create index if not exists calendly_events_ce_booked_idx on public.calendly_events (ce_booked) where ce_booked;
create index if not exists calendly_events_ce_completed_idx on public.calendly_events (ce_completed) where ce_completed;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Holds invitee PII (email/name), so reads require an allowlisted signed-in
-- user — the existing crm_leads / lead_attribution pattern. Writes go through
-- the service role (the future webhook), which bypasses RLS: NO insert/update/
-- delete policy is added, so there is no anonymous or public write access. The
-- explicit "Confirm CE Completed" write path is deferred to a later step.
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
