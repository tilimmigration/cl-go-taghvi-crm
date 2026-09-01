-- Phase 1: metadata + import-history structures used once Monday.com
-- import/sync actually runs (Phase 2+). Created now so the schema is
-- ready; nothing in this migration is populated or read yet.

-- ---------------------------------------------------------------------------
-- monday_boards
--
-- One row per Monday board the CRM knows about. In practice this will
-- only ever hold the one configured Leads board, but is modeled as a
-- table (rather than a couple of settings values) so the board's own
-- Monday-side identity/name is tracked the same way everything else
-- Monday-sourced is.
-- ---------------------------------------------------------------------------
create table if not exists public.monday_boards (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text,
  workspace_name  text,
  board_id        bigint not null,
  board_name      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint monday_boards_board_id_unique unique (board_id)
);

comment on table public.monday_boards is
  'Monday.com boards known to this CRM (in practice: just the configured Leads board).';

drop trigger if exists monday_boards_set_updated_at on public.monday_boards;
create trigger monday_boards_set_updated_at
  before update on public.monday_boards
  for each row
  execute function public.set_updated_at();

alter table public.monday_boards enable row level security;
-- No policies: service role only, same posture as monday_webhook_logs.

-- ---------------------------------------------------------------------------
-- monday_board_columns
--
-- One row per column on a Monday board. The Monday column id
-- (monday_column_id) is the stable external identifier — column titles
-- are display-only and may be renamed on the Monday side without
-- affecting mapping logic that keys off monday_column_id.
-- ---------------------------------------------------------------------------
create table if not exists public.monday_board_columns (
  id                 uuid primary key default gen_random_uuid(),
  board_id           bigint not null references public.monday_boards (board_id) on delete cascade,
  monday_column_id   text not null,
  column_title       text,
  column_type        text,
  column_description text,
  column_settings    jsonb not null default '{}'::jsonb,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint monday_board_columns_unique unique (board_id, monday_column_id)
);

comment on table public.monday_board_columns is
  'Column definitions for a Monday board, keyed by the stable monday_column_id (not the display title).';
comment on column public.monday_board_columns.column_settings is
  'Raw column settings_str from the Monday API (e.g. status label -> color map, dropdown options), parsed to jsonb.';

drop trigger if exists monday_board_columns_set_updated_at on public.monday_board_columns;
create trigger monday_board_columns_set_updated_at
  before update on public.monday_board_columns
  for each row
  execute function public.set_updated_at();

create index if not exists monday_board_columns_board_id_idx on public.monday_board_columns (board_id);

alter table public.monday_board_columns enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------------------
-- lead_import_runs / lead_import_errors
--
-- Tracks each bulk import/sync run (the initial import, and any future
-- re-sync). Per-event webhook processing has its own, separate log
-- (monday_webhook_logs, from the monday-webhook migration) — this is
-- specifically for batch import runs, which don't exist yet in Phase 1.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_import_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          text not null default 'running',
  total_processed integer not null default 0,
  created_count   integer not null default 0,
  updated_count   integer not null default 0,
  failed_count    integer not null default 0,
  error_message   text,
  created_at      timestamptz not null default now(),

  constraint lead_import_runs_status_check check (
    status in ('running', 'completed', 'completed_with_errors', 'failed')
  )
);

comment on table public.lead_import_runs is
  'One row per bulk Monday.com import/sync run. Not used by the per-event webhook, which logs to monday_webhook_logs instead.';

create index if not exists lead_import_runs_status_idx on public.lead_import_runs (status);
create index if not exists lead_import_runs_started_at_idx on public.lead_import_runs (started_at desc);

alter table public.lead_import_runs enable row level security;
-- No policies: service role only.

create table if not exists public.lead_import_errors (
  id              uuid primary key default gen_random_uuid(),
  import_run_id   uuid not null references public.lead_import_runs (id) on delete cascade,
  monday_item_id  bigint,
  error_message   text not null,
  created_at      timestamptz not null default now()
);

comment on table public.lead_import_errors is
  'Individual item-level failures within a lead_import_runs row, for debugging a completed_with_errors/failed run.';

create index if not exists lead_import_errors_import_run_id_idx on public.lead_import_errors (import_run_id);

alter table public.lead_import_errors enable row level security;
-- No policies: service role only.
