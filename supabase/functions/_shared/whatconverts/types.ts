// Shapes of the WhatConverts API responses we consume. WhatConverts returns
// a rich, evolving lead object; we type only the handful of fields the CRM
// will eventually care about and keep everything else via an index
// signature, so a newly added field is preserved rather than dropped.
//
// NOTE: this is intentionally permissive — no field is required. The test
// endpoint passes leads through untouched; later phases (mapping / matching,
// NOT built yet) will narrow what they actually rely on.

export interface WhatConvertsLead {
  lead_id?: number;
  /** e.g. "Phone Call", "Web Form", "Chat", "Event", "Transaction". */
  lead_type?: string;
  date_created?: string;
  /** Marketing attribution — the gap WhatConverts fills vs. Monday. */
  lead_source?: string | null;
  lead_medium?: string | null;
  lead_campaign?: string | null;
  lead_keyword?: string | null;
  gclid?: string | null;
  landing_url?: string | null;
  referral_url?: string | null;
  /** Contact identity — the future match keys against crm_leads. */
  email_address?: string | null;
  phone_number?: string | null;
  [key: string]: unknown;
}

export interface WhatConvertsLeadsResponse {
  leads_per_page?: number;
  page_number?: number;
  total_pages?: number;
  total_leads?: number;
  leads?: WhatConvertsLead[];
  [key: string]: unknown;
}
