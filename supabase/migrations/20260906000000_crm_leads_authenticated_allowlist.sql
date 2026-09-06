-- Phase 2: real authentication for the CRM.
--
-- Until now crm_leads was readable by the anonymous role with no
-- condition (policy crm_leads_read_all), because the app's login was a
-- browser-only check and every request ran as anon. That policy was
-- dropped on 2026-09-06. This migration puts the intended access model
-- in place, as planned in 20260901000000_leads_standard_fields_and_read_policy.sql:
--
--   * Users sign in with Supabase Auth (email + password), so requests
--     carry a real session and run as the `authenticated` role.
--   * Being signed in is NOT enough on its own: Supabase allows public
--     sign-ups by default, so a stranger could otherwise create an account
--     and read leads. A signed-in user can read leads only if their email
--     is on the crm_allowed_users allowlist below.
--   * Writes to crm_leads still happen only via the service role (the
--     Monday.com Edge Functions), which bypasses RLS. No write policies.
--
-- To grant someone access: create their user in Supabase Auth
-- (Authentication -> Users -> Add user), then add their email here:
--   insert into public.crm_allowed_users (email, note) values ('person@example.com', 'who they are');
-- To revoke: delete their row (and optionally the auth user).

drop policy if exists "crm_leads_read_all" on public.crm_leads;

create table if not exists public.crm_allowed_users (
  email    text primary key check (email = lower(email)),
  note     text,
  added_at timestamptz not null default now()
);

comment on table public.crm_allowed_users is
  'Emails allowed to read crm_leads once signed in via Supabase Auth. Managed by Brill Media via SQL; no client writes.';

alter table public.crm_allowed_users enable row level security;

-- A signed-in user may see only their own allowlist row. This exists so
-- the UI can tell "you are signed in but not authorized" apart from
-- "there are no leads yet". No insert/update/delete policies: writes are
-- service-role / SQL-editor only.
drop policy if exists "crm_allowed_users_read_self" on public.crm_allowed_users;
create policy "crm_allowed_users_read_self"
  on public.crm_allowed_users
  for select
  to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "crm_leads_read_allowlisted" on public.crm_leads;
create policy "crm_leads_read_allowlisted"
  on public.crm_leads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.crm_allowed_users u
      where u.email = lower(auth.jwt() ->> 'email')
    )
  );

-- Seed: the Brill Media owner. Add Taghavi team members the same way.
insert into public.crm_allowed_users (email, note)
values ('robert@brillmedia.co', 'Brill Media, owner')
on conflict (email) do nothing;
