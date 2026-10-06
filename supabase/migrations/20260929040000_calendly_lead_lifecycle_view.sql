-- Step 6: read-only Calendly lifecycle read model for each CRM lead.
--
-- A VIEW (the project reads tables directly via PostgREST, so a view is the
-- natural read model). It is READ-ONLY and derives the Calendly CE lifecycle per
-- CRM lead from calendly_events. It NEVER writes anything and does NOT touch
-- crm_leads.status or any CRM/Monday/WhatConverts data — the Calendly lifecycle
-- is an additional, independent source layered on top of the existing CRM status.
--
-- security_invoker = true: the view runs with the CALLER's privileges, so the
-- existing Row Level Security on crm_leads and calendly_events (allowlisted
-- authenticated users) applies unchanged. There is no privilege escalation.
--
-- Lifecycle model
-- ---------------
-- Per event, the lifecycle is:
--   ce_completed = true              -> 'ce_completed'   (completion wins, and is
--                                                          historical — a later
--                                                          cancellation never
--                                                          undoes it)
--   else status = 'booked'           -> 'ce_booked'
--   else status = 'canceled'         -> 'ce_canceled'
--   else status = 'no_show'          -> 'ce_no_show'
--
-- Per LEAD, calendly_lifecycle is the per-event lifecycle of the LATEST relevant
-- event, where "latest" is ordered by coalesce(scheduled_at, ce_booked_at,
-- created_at) DESC, then id DESC (stable tie-break). This follows the precedence
-- rule "use the latest relevant event for the current lifecycle", and lets a
-- newer active booking represent a new CE booking. A lead with no matched event
-- is 'none'.
--
-- ALL historical events are preserved (nothing is deleted). Because a single
-- lead can have several events over time, two extra columns make the historical
-- dimension explicit and unambiguous:
--   ever_completed        : true if ANY of the lead's events is ce_completed
--                           (so a historical completion is visible even when the
--                           latest event is a newer booking or cancellation).
--   calendly_event_count  : how many matched events the lead has.
--
-- Documented edge cases (per the spec's "document rather than invent" rule):
--   * booked -> completed -> canceled on ONE event: that event has
--     ce_completed = true, so calendly_lifecycle = 'ce_completed' and
--     ever_completed = true. Completion is preserved.
--   * completed CE #1, then a NEWER booked CE #2: latest = the new booking, so
--     calendly_lifecycle = 'ce_booked' (a new CE booking) while
--     ever_completed = true records the historical completion.
--   * completed CE #1, then a NEWER canceled CE #2: latest = the cancellation,
--     so calendly_lifecycle = 'ce_canceled' while ever_completed = true.
-- Only matched events (lead_id not null) contribute; unmatched/ambiguous Calendly
-- events (lead_id null) never appear against any lead.

create or replace view public.calendly_lead_lifecycle
  with (security_invoker = true) as
with matched as (
  select
    ce.id, ce.lead_id, ce.monday_item_id, ce.status,
    ce.ce_booked, ce.ce_booked_at, ce.ce_completed, ce.ce_completed_at, ce.ce_completed_by,
    ce.scheduled_at, ce.created_at,
    row_number() over (
      partition by ce.lead_id
      order by coalesce(ce.scheduled_at, ce.ce_booked_at, ce.created_at) desc nulls last, ce.id desc
    ) as rn
  from public.calendly_events ce
  where ce.lead_id is not null
),
latest as (
  select * from matched where rn = 1
),
agg as (
  select lead_id,
         bool_or(ce_completed) as ever_completed,
         count(*)::int         as calendly_event_count
  from matched
  group by lead_id
)
select
  l.id                     as lead_id,
  latest.id                as calendly_event_id,
  latest.status            as calendly_status,
  latest.ce_booked         as ce_booked,
  latest.ce_booked_at      as ce_booked_at,
  latest.ce_completed      as ce_completed,
  latest.ce_completed_at   as ce_completed_at,
  latest.ce_completed_by   as ce_completed_by,
  coalesce(agg.ever_completed, false)   as ever_completed,
  coalesce(agg.calendly_event_count, 0) as calendly_event_count,
  case
    when latest.id is null          then 'none'
    when latest.ce_completed        then 'ce_completed'
    when latest.status = 'booked'   then 'ce_booked'
    when latest.status = 'canceled' then 'ce_canceled'
    when latest.status = 'no_show'  then 'ce_no_show'
    else 'none'
  end as calendly_lifecycle
from public.crm_leads l
left join latest on latest.lead_id = l.id
left join agg    on agg.lead_id = l.id
where l.is_deleted = false;

comment on view public.calendly_lead_lifecycle is
  'Read-only Calendly CE lifecycle per CRM lead, derived from calendly_events (latest relevant event; completion is sticky per event and surfaced historically via ever_completed). Never writes; security_invoker so crm_leads/calendly_events RLS applies. Does not touch crm_leads.status.';

-- Read access for allowlisted authenticated users only (RLS on the base tables
-- still gates the actual rows via security_invoker); no anon access.
revoke all on public.calendly_lead_lifecycle from anon;
grant select on public.calendly_lead_lifecycle to authenticated;
