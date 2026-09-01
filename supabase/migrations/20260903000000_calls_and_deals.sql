-- Extends the Monday.com sync beyond the Leads board to two more boards
-- from the same workspace: Call Log Tracker and Deals. Each gets its own
-- table with the exact same architecture as crm_leads (external identity
-- = monday_board_id + monday_item_id, soft delete/archive, custom_fields
-- jsonb catch-all) — a Call and a Deal are different entities from a
-- Lead, each with their own Monday item identity, so they are NOT folded
-- into crm_leads itself. Both link back to a Lead via a connect-boards
-- column on their respective Monday board, preserved here as
-- related_lead_monday_item_id (the raw external reference, always
-- populated when the column has a value) and related_lead_id (resolved
-- against crm_leads at import/sync time, best-effort — a call or deal
-- must still import successfully even if its linked lead hasn't been
-- imported yet, so this is nullable with no FK constraint, matching how
-- monday_board_id itself has no FK to monday_boards).
--
-- The CRM UI displays records from all three tables together in one
-- list (each tagged with its source), but storage stays separate.

create table if not exists public.crm_calls (
  id                      uuid primary key default gen_random_uuid(),

  monday_board_id         bigint not null,
  monday_item_id          bigint not null,
  monday_group_id         text,
  monday_group_title      text,

  name                    text not null,
  status                  text,
  owner_name              text,
  owner_monday_user_id    bigint,
  email                   text,
  phone                   text,
  company                 text,

  related_lead_monday_item_id bigint,
  related_lead_id         uuid,

  custom_fields           jsonb not null default '{}'::jsonb,
  raw_column_values       jsonb not null default '{}'::jsonb,

  monday_created_at       timestamptz,
  monday_updated_at       timestamptz,

  is_archived             boolean not null default false,
  archived_at             timestamptz,
  is_deleted              boolean not null default false,
  deleted_at              timestamptz,

  last_synced_at          timestamptz not null default now(),
  last_synced_event_type  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint crm_calls_monday_identity_unique unique (monday_board_id, monday_item_id)
);

comment on table public.crm_calls is
  'Records synced from the Monday.com Call Log Tracker board. External identity is (monday_board_id, monday_item_id).';
comment on column public.crm_calls.related_lead_monday_item_id is
  'Monday item id of the linked Lead, from a connect-boards column. Raw external reference — always populated when present, regardless of whether the lead has been imported yet.';
comment on column public.crm_calls.related_lead_id is
  'Resolved crm_leads.id for the linked lead, best-effort — null if the lead has not been imported (or no longer exists). No FK constraint, to avoid import-order coupling.';

create index if not exists crm_calls_monday_item_id_idx on public.crm_calls (monday_item_id);
create index if not exists crm_calls_related_lead_id_idx on public.crm_calls (related_lead_id);
create index if not exists crm_calls_is_deleted_idx on public.crm_calls (is_deleted);

drop trigger if exists crm_calls_set_updated_at on public.crm_calls;
create trigger crm_calls_set_updated_at
  before update on public.crm_calls
  for each row
  execute function public.set_updated_at();

alter table public.crm_calls enable row level security;

drop policy if exists "crm_calls_read_all" on public.crm_calls;
create policy "crm_calls_read_all"
  on public.crm_calls
  for select
  to anon, authenticated
  using (true);
-- No write policy: writes happen only via the service role (import /
-- future webhook), same posture as crm_leads.

create table if not exists public.crm_deals (
  id                      uuid primary key default gen_random_uuid(),

  monday_board_id         bigint not null,
  monday_item_id          bigint not null,
  monday_group_id         text,
  monday_group_title      text,

  name                    text not null,
  status                  text,
  owner_name              text,
  owner_monday_user_id    bigint,
  email                   text,
  phone                   text,
  company                 text,

  related_lead_monday_item_id bigint,
  related_lead_id         uuid,

  custom_fields           jsonb not null default '{}'::jsonb,
  raw_column_values       jsonb not null default '{}'::jsonb,

  monday_created_at       timestamptz,
  monday_updated_at       timestamptz,

  is_archived             boolean not null default false,
  archived_at             timestamptz,
  is_deleted              boolean not null default false,
  deleted_at              timestamptz,

  last_synced_at          timestamptz not null default now(),
  last_synced_event_type  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint crm_deals_monday_identity_unique unique (monday_board_id, monday_item_id)
);

comment on table public.crm_deals is
  'Records synced from the Monday.com Deals board. External identity is (monday_board_id, monday_item_id).';
comment on column public.crm_deals.related_lead_monday_item_id is
  'Monday item id of the linked Lead, from a connect-boards column. Raw external reference — always populated when present, regardless of whether the lead has been imported yet.';
comment on column public.crm_deals.related_lead_id is
  'Resolved crm_leads.id for the linked lead, best-effort — null if the lead has not been imported (or no longer exists). No FK constraint, to avoid import-order coupling.';

create index if not exists crm_deals_monday_item_id_idx on public.crm_deals (monday_item_id);
create index if not exists crm_deals_related_lead_id_idx on public.crm_deals (related_lead_id);
create index if not exists crm_deals_is_deleted_idx on public.crm_deals (is_deleted);

drop trigger if exists crm_deals_set_updated_at on public.crm_deals;
create trigger crm_deals_set_updated_at
  before update on public.crm_deals
  for each row
  execute function public.set_updated_at();

alter table public.crm_deals enable row level security;

drop policy if exists "crm_deals_read_all" on public.crm_deals;
create policy "crm_deals_read_all"
  on public.crm_deals
  for select
  to anon, authenticated
  using (true);
