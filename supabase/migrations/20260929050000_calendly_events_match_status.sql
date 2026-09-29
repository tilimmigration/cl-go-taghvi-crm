-- Historical Calendly sync: record the email-match OUTCOME so an ambiguous
-- match is distinguishable from a plain miss (lead_id alone cannot tell them
-- apart — both are NULL). This is the smallest additive change needed for the
-- calendly-sync backfill; it does not alter the webhook or any existing row.
--
--   matched   -> exactly one crm_leads.email matched (lead_id is set)
--   unmatched -> zero leads matched (lead_id NULL)
--   ambiguous -> two or more leads matched; never auto-resolved (lead_id NULL)
--
-- Nullable with no default: webhook-ingested rows leave it NULL (their link is
-- already indicated by lead_id); the calendly-sync backfill sets it explicitly.
-- The CHECK allows NULL so existing rows and the webhook remain valid untouched.

alter table public.calendly_events
  add column if not exists match_status text
    check (match_status is null or match_status in ('matched', 'unmatched', 'ambiguous'));

comment on column public.calendly_events.match_status is
  'Email-match outcome recorded by the calendly-sync backfill: matched (exactly one crm_leads.email), unmatched (zero), ambiguous (2+). NULL for webhook-ingested rows (their link is indicated by lead_id). Never used to guess an ambiguous match.';
