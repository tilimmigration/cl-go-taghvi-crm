-- Retain unmatched WhatConverts leads in lead_attribution.
--
-- Follow-up to 20260923000000_whatconverts_lead_attribution.sql (already
-- applied — that file is intentionally left untouched). Changes the model so
-- a WhatConverts lead can be stored BEFORE it is matched to a Monday CRM
-- lead, then matched later in place:
--
--   * monday_item_id becomes NULLABLE — an unmatched WhatConverts lead is
--     stored with monday_item_id / match_method / match_confidence all NULL.
--     Its WhatConverts attribution (source/medium/campaign/... /gclid/fbclid,
--     raw_* and raw_attribution) is still captured at ingest; only the
--     match link is deferred.
--   * Uniqueness moves from the PAIR (whatconverts_lead_id, monday_item_id)
--     to whatconverts_lead_id ALONE, so each WhatConverts lead is stored
--     exactly once. The old pair-unique would also have allowed duplicate
--     unmatched rows once monday_item_id could be NULL (NULLs are distinct in
--     a UNIQUE), so it is replaced, not kept.
--
-- Note: monday_item_id is deliberately NOT unique — one Monday lead can have
-- several WhatConverts touchpoints (e.g. a phone call and a web form), so
-- multiple attribution rows may legitimately share a monday_item_id.
--
-- Reconciliation (implemented LATER, not here): the WhatConverts sync upserts
-- on whatconverts_lead_id; the future matching step UPDATEs that same row to
-- fill in monday_item_id + match_method + match_confidence. A lead that goes
-- unmatched -> matched never produces a duplicate row.
--
-- Unchanged: raw_attribution payload, the match_confidence 0..1 CHECK, the
-- set_updated_at trigger, RLS (allowlisted SELECT) and the service-role-only
-- write model. No Monday table or Monday integration code is touched.

alter table public.lead_attribution
  alter column monday_item_id drop not null;

-- Replace the pair-unique with a single-column unique on whatconverts_lead_id.
alter table public.lead_attribution
  drop constraint if exists lead_attribution_wc_monday_unique;

alter table public.lead_attribution
  add constraint lead_attribution_whatconverts_lead_id_key
  unique (whatconverts_lead_id);

-- Refresh the semantics captured in the comments.
comment on table public.lead_attribution is
  'WhatConverts marketing attribution, one row per whatconverts_lead_id. Linked to a Monday CRM lead by monday_item_id once matched; monday_item_id / match_method / match_confidence stay NULL while unmatched. Separate from crm_leads — never creates or modifies a CRM lead.';
comment on column public.lead_attribution.monday_item_id is
  'Monday pulse/item id of the matched lead (matches crm_leads.monday_item_id), or NULL while the WhatConverts lead is not yet matched. Raw external reference, no FK — Monday item ids are globally unique so the join is unambiguous, and one Monday lead may have several WhatConverts touchpoints. Filled in later by the matching step.';
