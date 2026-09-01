-- Phase 1: connect the CRM UI to Supabase.
--
-- Adds the remaining standard lead fields requested for the CRM (the
-- Monday-sync-specific fields — monday_board_id/monday_item_id, lead_type,
-- lead_source, status, owner_name/owner_monday_user_id, email, phone,
-- company, custom_fields, raw_column_values, soft-delete/archive columns —
-- already exist from the monday-webhook migration and are reused as-is;
-- see the "custom fields" note below for why no separate
-- lead_custom_fields table is added here).
--
-- Also adds the one RLS policy needed for the browser (anon/publishable
-- key) to read leads — see the RLS section at the bottom for the
-- reasoning.

alter table public.crm_leads
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists stage      text,
  add column if not exists website    text,
  add column if not exists address    text,
  add column if not exists city       text,
  add column if not exists state      text,
  add column if not exists country    text,
  add column if not exists industry   text,
  add column if not exists notes      text;

comment on column public.crm_leads.first_name is
  'Optional split-name field, populated when the Monday board has separate first/last name columns. The Monday item name always lives in crm_leads.name regardless.';
comment on column public.crm_leads.last_name is
  'See first_name.';
comment on column public.crm_leads.stage is
  'Pipeline stage, distinct from status where the source board tracks both separately.';

-- ---------------------------------------------------------------------------
-- Custom fields: intentionally NOT a separate lead_custom_fields table.
--
-- crm_leads.custom_fields (jsonb, added in the monday-webhook migration)
-- already covers "a flexible structure for custom fields not worth a
-- dedicated column", keyed by Monday column id:
--   { [columnId]: { title, text, value } }
-- A one-row-per-field table was considered and rejected for Phase 1: it
-- would multiply row count by column count for no query benefit this CRM
-- currently needs, and jsonb supports indexed lookups (a GIN index) if a
-- specific custom field ever needs fast filtering. Revisit only if a
-- concrete feature needs relational queries over individual field values.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- crm_leads currently has RLS enabled with NO policies at all (locked to
-- the service role only) — that's correct for writes, but it also means
-- the Leads UI, running with the public anon/publishable key, could not
-- read anything.
--
-- Recommended policy for this phase: allow SELECT only, to anon and
-- authenticated alike, on crm_leads only. No INSERT/UPDATE/DELETE policy
-- is added for anon/authenticated — all writes continue to happen only
-- via the service role (the monday-webhook Edge Function, and later an
-- import script), which bypasses RLS entirely.
--
-- Why this is safe enough for now, and what to revisit:
--   - This app's current "login" (see src/views/Login.jsx) is a
--     client-side-only check, not backed by Supabase Auth — there is no
--     real session distinguishing "authenticated" from "anon" yet, so in
--     practice every browser request currently uses the anon role
--     regardless of whether someone is "logged in" to the CRM UI.
--   - The anon/publishable key itself is not a secret (it ships in the
--     JS bundle by design), so the only thing actually gating read access
--     right now is this policy.
--   - Once real Supabase Auth is added, narrow this to `authenticated`
--     only (drop the anon grant) so lead data — names, emails, phone
--     numbers — requires a real logged-in session to read.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_leads_read_all" on public.crm_leads;
create policy "crm_leads_read_all"
  on public.crm_leads
  for select
  to anon, authenticated
  using (true);
