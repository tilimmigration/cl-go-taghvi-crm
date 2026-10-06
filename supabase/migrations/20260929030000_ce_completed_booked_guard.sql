-- Step 5: CE Completion business-rule guard.
--
-- Adds the rule that a Calendly event may be explicitly marked CE Completed ONLY
-- when it is an ACTIVE BOOKED event: status = 'booked' AND ce_booked = true.
-- Canceled and no_show events are NOT completable.
--
-- The ce_booked model is unchanged: ce_booked stays true on a canceled event as
-- the historical record that a CE booking occurred; the live lifecycle is
-- carried by status. So:
--   ce_booked = true      → a CE booking occurred
--   status   = 'canceled' → that booking was canceled
--   ce_completed = true   → the CE was explicitly completed
--
-- CREATE OR REPLACE keeps everything else from 20260929020000 intact: SECURITY
-- DEFINER, search_path = public, crm_allowed_users authorization, session-derived
-- identity, idempotency, the completion CHECK constraint, and authenticated-only
-- EXECUTE. Only the lifecycle guard is added. Still updates ONLY calendly_events.
--
-- Idempotency ordering note: the already-completed check runs BEFORE the status
-- guard, so an event that was completed while booked and later canceled stays
-- idempotent on re-confirmation (returns the existing completion) rather than
-- being rejected — completion is historical audit data and is never undone.

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
  -- (Before the lifecycle guard, so a completed-then-canceled event stays
  -- idempotent instead of being rejected by the status check.)
  if v_event.ce_completed then
    return jsonb_build_object(
      'id', v_event.id,
      'ce_completed', v_event.ce_completed,
      'ce_completed_at', v_event.ce_completed_at,
      'ce_completed_by', v_event.ce_completed_by,
      'already_completed', true
    );
  end if;

  -- Business rule: only an ACTIVE BOOKED event is completable. Canceled and
  -- no_show events are rejected.
  if v_event.status is distinct from 'booked' then
    raise exception 'calendly_event % has status %; only an active booked event can be marked CE completed', p_calendly_event_id, v_event.status
      using errcode = '22023';
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
  'Explicitly marks a calendly_events row CE Completed. Only an active booked event (status = booked AND ce_booked = true) is completable; canceled/no_show are rejected. Allowlisted authenticated caller only (identity from auth.jwt(); never caller-supplied). Updates only calendly_events; idempotent; ce_completed_at = now() (or supplied completion time).';

-- Re-assert least-privilege EXECUTE (idempotent; CREATE OR REPLACE preserves
-- grants, but keep this self-contained for a fresh replay).
revoke all on function public.confirm_ce_completed(uuid, timestamptz) from public, anon;
grant execute on function public.confirm_ce_completed(uuid, timestamptz) to authenticated;
