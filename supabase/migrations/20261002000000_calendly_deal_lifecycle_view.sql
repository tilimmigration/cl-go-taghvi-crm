-- Read-only Calendly CE lifecycle per Monday DEAL, derived by matching the
-- Deals board's "Applicant Email" to calendly_events.invitee_email.
--
-- WHY THIS EXISTS: crm_leads (the Leads board) is a small, recent subset, so
-- almost no Calendly bookings link to it. The all-time client history lives on
-- the Deals board, whose "Applicant Email" column (stored unmapped in
-- crm_deals.custom_fields) matches ~36% of the client's Calendly invitees. This
-- view surfaces those matches as "CE booked (from Calendly)" WITHOUT writing any
-- status: it is purely derived, exactly like calendly_lead_lifecycle. It never
-- modifies crm_deals, crm_leads, crm_leads.status, Monday, or anything else.
--
-- security_invoker = true: runs with the caller's privileges so the existing RLS
-- on crm_deals / calendly_events (allowlisted authenticated users) applies
-- unchanged. No privilege escalation.
--
-- Lifecycle per deal uses the LATEST matched Calendly event (same rule as
-- calendly_lead_lifecycle): completion is sticky and surfaced historically via
-- ever_completed; a later cancellation shows as ce_canceled while ever_completed
-- stays true. Only deals with a non-empty Applicant Email that matches at least
-- one calendly_events row appear.

create or replace view public.calendly_deal_lifecycle
  with (security_invoker = true) as
with deal_email as (
  select
    d.id                 as deal_id,
    d.monday_item_id     as deal_monday_item_id,
    d.monday_group_title as deal_group,
    lower(btrim((
      select v.value ->> 'text'
      from jsonb_each(coalesce(d.custom_fields::jsonb, '{}'::jsonb)) v
      where lower(v.value ->> 'title') = 'applicant email'
      limit 1
    )))                  as applicant_email
  from public.crm_deals d
  where coalesce(d.is_deleted, false) = false
),
ev as (
  select
    de.deal_id, de.deal_monday_item_id, de.deal_group, de.applicant_email,
    ce.id as calendly_event_id, ce.status, ce.ce_booked, ce.ce_booked_at,
    ce.ce_completed, ce.ce_completed_at, ce.scheduled_at, ce.created_at
  from deal_email de
  join public.calendly_events ce
    on ce.invitee_email = de.applicant_email
  where de.applicant_email is not null and de.applicant_email <> ''
),
ranked as (
  select
    ev.*,
    row_number() over (
      partition by deal_id
      order by coalesce(scheduled_at, ce_booked_at, created_at) desc nulls last, calendly_event_id desc
    ) as rn,
    bool_or(ce_completed) over (partition by deal_id) as ever_completed,
    count(*)              over (partition by deal_id) as calendly_event_count
  from ev
)
select
  deal_id,
  deal_monday_item_id,
  deal_group,
  applicant_email,
  calendly_event_id          as latest_calendly_event_id,
  status                     as latest_status,
  scheduled_at               as latest_scheduled_at,
  ce_booked_at               as latest_ce_booked_at,
  ce_completed,
  ce_completed_at,
  ever_completed,
  calendly_event_count,
  case
    when ce_completed            then 'ce_completed'
    when status = 'booked'       then 'ce_booked'
    when status = 'canceled'     then 'ce_canceled'
    when status = 'no_show'      then 'ce_no_show'
    else 'ce_booked'
  end as calendly_lifecycle
from ranked
where rn = 1;

comment on view public.calendly_deal_lifecycle is
  'Read-only Calendly CE lifecycle per Monday deal, derived by matching crm_deals "Applicant Email" (from custom_fields) to calendly_events.invitee_email. Never writes status; security_invoker so base-table RLS applies. Companion to calendly_lead_lifecycle for the Deals board.';

revoke all on public.calendly_deal_lifecycle from anon;
grant select on public.calendly_deal_lifecycle to authenticated;
