-- Grant muhammed@brillmedia.co access to the CRM Leads page.
--
-- See 20260906000000_crm_leads_authenticated_allowlist.sql: a signed-in
-- user can read crm_leads only if their email is on crm_allowed_users.
-- This alone does not create their login — a Supabase Auth user for this
-- email still needs to be created separately (Authentication -> Users ->
-- Add user in the Supabase dashboard), since the app has no self-serve
-- sign-up flow.

insert into public.crm_allowed_users (email, note)
values ('muhammed@brillmedia.co', 'Brill Media')
on conflict (email) do nothing;
