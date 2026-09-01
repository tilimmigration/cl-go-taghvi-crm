-- Phase 2: bulk import needs to record which Monday column an error
-- relates to, when applicable (e.g. a column value that couldn't be
-- parsed) — lead_import_errors only tracked the item and message so far.

alter table public.lead_import_errors
  add column if not exists monday_column_id text;

comment on column public.lead_import_errors.monday_column_id is
  'Monday column id the error relates to, when applicable (e.g. a column value that failed to parse). Null for item-level failures.';
