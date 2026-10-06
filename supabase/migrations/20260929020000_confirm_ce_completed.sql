-- Step 4: explicit CE Completed write path — public.confirm_ce_completed(...).
--
-- A SECURITY DEFINER RPC (the project's authorization model is the
-- crm_allowed_users allowlist checked via auth.jwt(); there is no other write
-- path convention to follow). It is the ONLY controlled way to mark a Calendly
-- event as CE Completed. It updates ONLY public.calendly_events and touches
-- nothing else — no crm_leads / crm_leads.status / crm_calls / crm_deals /
-- lead_attribution, no Monday, no WhatConverts. CE Completed stays EXPLICIT: this
-- function is the only thing that sets ce_completed = true, and only when a
-- caller deliberately invokes it.
--
-- Authorization: the caller is identified from their authenticated session
-- (auth.jwt() ->> 'email') — never from a caller-supplied argument — and must be
-- on the crm_allowed_users allowlist, the same mechanism the RLS SELECT policies
-- use. Unauthorized callers get an error and no change. EXECUTE is granted to the
-- `authenticated` role only (revoked from PUBLIC), so there is no anonymous or
-- public write access; the service-role key is never involved or exposed.
--
-- Timestamp: ce_completed_at is the moment of explicit confirmation — the server
-- now() by default, or an explicitly supplied p_completed_at when the caller
-- passes the actual completion time. Never the Calendly booking time, never
-- fabricated.
--
-- Idempotency: calling it again on an already-completed event is a safe no-op —
-- it returns the existing completion (with already_completed = true) and never
-- overwrites the original ce_completed_at / ce_completed_by.
--
-- Business rules enforced:
--   * event must exist                    → error P0002 (no_data_found)
--   * event must be a booking (ce_booked) → error 22023 (invalid_parameter_value)
--   * caller must be allowlisted          → error 42501 (insufficient_privilege)
-- NOTE ON CANCELED EVENTS: status is intentionally NOT checked here. Whether a
-- canceled-but-previously-booked event may be explicitly completed is a business
-- rule that has not been established, so no restrictive rule is invented (per the
-- Step 4 spec). Such an event has ce_booked = true (Step 3 preserves it on
-- cancel) and is therefore currently completable. This is reported for a
-- decision; add a status check here only once the rule is confirmed.
--
-- The Step 2 CHECK constraint calendly_events_completion_requires_who_when still
-- guards the invariant (ce_completed ⇒ at & by NOT NULL); this function satisfies
-- it and does not weaken it.

create or replace function public.confirm_ce_completed(
  p_calendly_event_id uuid,
  p_completed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_event public.calendly_events;
begin
  -- Authorization — allowlisted authenticated user only.
  if v_email is null or not exists (
    select 1 from public.crm_allowed_users u where u.email = v_email
  ) then
    raise exception 'not authorized to confirm CE completion'
      using errcode = '42501';
  end if;

  -- Event must exist.
  select * into v_event from public.calendly_events where id = p_calendly_event_id;
  if not found then
    raise exception 'calendly_event % not found', p_calendly_event_id
      using errcode = 'P0002';
  end if;

  -- Idempotent: already completed → return existing, never overwrite who/when.
  if v_event.ce_completed then
    return jsonb_build_object(
      'id', v_event.id,
      'ce_completed', v_event.ce_completed,
      'ce_completed_at', v_event.ce_completed_at,
      'ce_completed_by', v_event.ce_completed_by,
      'already_completed', true
    );
  end if;

  -- Must represent a booking.
  if not coalesce(v_event.ce_booked, false) then
    raise exception 'calendly_event % was never booked (ce_booked = false); cannot mark CE completed', p_calendly_event_id
      using errcode = '22023';
  end if;

  -- Explicit confirmation: stamp who (from the session) + when.
  update public.calendly_events
     set ce_completed = true,
         ce_completed_at = coalesce(p_completed_at, now()),
         ce_completed_by = v_email
   where id = p_calendly_event_id
   returning * into v_event;

  return jsonb_build_object(
    'id', v_event.id,
    'ce_completed', v_event.ce_completed,
    'ce_completed_at', v_event.ce_completed_at,
    'ce_completed_by', v_event.ce_completed_by,
    'already_completed', false
  );
end;
$$;

comment on function public.confirm_ce_completed(uuid, timestamptz) is
  'Explicitly marks a calendly_events row CE Completed. Allowlisted authenticated caller only (identity from auth.jwt(); never caller-supplied). Updates only calendly_events; idempotent; ce_completed_at = now() (or supplied completion time). Requires the event to exist and be ce_booked.';

-- No anonymous/public execute; authenticated role only. Supabase grants EXECUTE
-- on new public functions to anon/authenticated/service_role by default, so
-- strip PUBLIC and anon explicitly (the function also enforces the allowlist
-- internally, but unauthenticated callers should not be able to invoke it at all).
revoke all on function public.confirm_ce_completed(uuid, timestamptz) from public, anon;
grant execute on function public.confirm_ce_completed(uuid, timestamptz) to authenticated;
