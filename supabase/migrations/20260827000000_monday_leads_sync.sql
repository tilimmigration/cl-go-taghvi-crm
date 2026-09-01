-- Monday.com Leads board sync: CRM leads table + webhook processing log.
-- Used by both the monday-webhook Edge Function and any future/initial
-- Monday.com import script, via the shared upsert pipeline in
-- supabase/functions/_shared/monday/.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- crm_leads
--
-- One row per Monday.com "Leads" board item. External identity is the pair
-- (monday_board_id, monday_item_id) — NOT the internal uuid — so repeated
-- webhook deliveries for the same Monday item always resolve to the same
-- row (idempotent upsert).
-- ---------------------------------------------------------------------------
create table if not exists public.crm_leads (
  id                     uuid primary key default gen_random_uuid(),

  -- External identity (Monday.com)
  monday_board_id        bigint not null,
  monday_item_id         bigint not null,
  monday_group_id        text,
  monday_group_title     text,

  -- Core mapped fields (well-known Leads board columns)
  name                   text not null,
  lead_type              text,
  lead_source            text,
  status                 text,
  owner_name             text,
  owner_monday_user_id   bigint,
  email                  text,
  phone                  text,
  company                text,

  -- Everything else: unmapped/custom columns, keyed by Monday column id,
  -- plus a full copy of the raw column_values payload for audit/debug.
  custom_fields          jsonb not null default '{}'::jsonb,
  raw_column_values      jsonb not null default '{}'::jsonb,

  -- Monday-side timestamps (as reported by the Monday API)
  monday_created_at      timestamptz,
  monday_updated_at      timestamptz,

  -- Lifecycle / soft-delete
  is_archived            boolean not null default false,
  archived_at            timestamptz,
  is_deleted             boolean not null default false,
  deleted_at             timestamptz,

  -- Sync bookkeeping
  last_synced_at         timestamptz not null default now(),
  last_synced_event_type text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint crm_leads_monday_identity_unique unique (monday_board_id, monday_item_id)
);

comment on table public.crm_leads is
  'CRM leads synced from the Monday.com Leads board. External identity is (monday_board_id, monday_item_id).';
comment on column public.crm_leads.custom_fields is
  'Column values not mapped to a dedicated column, keyed by Monday column id: { [columnId]: { title, text, value } }.';
comment on column public.crm_leads.raw_column_values is
  'Full raw column_values array from the Monday API response, for audit/debug.';

create index if not exists crm_leads_monday_item_id_idx on public.crm_leads (monday_item_id);
create index if not exists crm_leads_status_idx on public.crm_leads (status);
create index if not exists crm_leads_is_archived_idx on public.crm_leads (is_archived);
create index if not exists crm_leads_is_deleted_idx on public.crm_leads (is_deleted);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_leads_set_updated_at on public.crm_leads;
create trigger crm_leads_set_updated_at
  before update on public.crm_leads
  for each row
  execute function public.set_updated_at();

-- RLS: locked down by default. The Edge Function writes using the Supabase
-- service role key, which bypasses RLS entirely, so no write policy is
-- required for the webhook to function. Add read policies here once the
-- frontend is wired to real authentication.
alter table public.crm_leads enable row level security;

-- ---------------------------------------------------------------------------
-- monday_webhook_logs
--
-- One row per webhook delivery attempt (including duplicates, skipped
-- events, and failures). Used for observability and debugging — never
-- read by the application at runtime.
-- ---------------------------------------------------------------------------
create table if not exists public.monday_webhook_logs (
  id                uuid primary key default gen_random_uuid(),
  monday_event_id   text,
  event_type        text not null,
  monday_board_id   bigint,
  monday_item_id    bigint,
  status            text not null,
  error_message     text,
  created_at        timestamptz not null default now(),

  constraint monday_webhook_logs_status_check check (
    status in (
      'received',
      'processed',
      'skipped_wrong_board',
      'skipped_invalid',
      'skipped_unsupported_event',
      'error'
    )
  )
);

comment on table public.monday_webhook_logs is
  'Audit log of every monday-webhook Edge Function invocation. No lead payload contents or secrets are stored here.';

create index if not exists monday_webhook_logs_item_id_idx on public.monday_webhook_logs (monday_item_id);
create index if not exists monday_webhook_logs_event_type_idx on public.monday_webhook_logs (event_type);
create index if not exists monday_webhook_logs_status_idx on public.monday_webhook_logs (status);
create index if not exists monday_webhook_logs_created_at_idx on public.monday_webhook_logs (created_at desc);

alter table public.monday_webhook_logs enable row level security;
-- No policies added: only the service role (used server-side by the Edge
-- Function) can read/write this table. It is intentionally not exposed to
-- the anon or authenticated roles.
