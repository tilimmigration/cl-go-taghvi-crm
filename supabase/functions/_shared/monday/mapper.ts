// Transforms a raw Monday.com item into the normalized shape the CRM
// leads table stores. This is the single source of truth for
// column -> field mapping: both the webhook pipeline and the bulk import
// (supabase/functions/_shared/monday/import.ts) call mapMondayItemToLead()
// rather than re-implementing this transformation.
//
// Column matching strategy: by default, columns are matched by TITLE
// (case-insensitive, whitespace-trimmed) against the well-known Leads
// fields below. This is resilient to column ids being unknown ahead of
// time, at the cost of breaking if someone renames a column on the
// Monday board. Once the real board's column ids are confirmed, set
// MONDAY_COLUMN_ID_MAP (JSON, e.g. '{"email":"email_9"}') to pin exact
// ids per field — id-based entries always take priority over title
// matches.
//
// Every column type Monday supports (text, status, people, date, formula,
// mirror, connect boards, ...) already carries a display `text` and a raw
// `value` on every column_value regardless of type — so a column that
// isn't one of the standard fields below is never dropped, it lands in
// customFields with its title, type, text and raw value intact. Nothing
// requires per-column-type special-casing to be preserved.

import type { MondayColumnValue, MondayItem, NormalizedLead } from "./types.ts";

export type LeadFieldKey =
  | "firstName"
  | "lastName"
  | "leadType"
  | "leadSource"
  | "status"
  | "stage"
  | "owner"
  | "email"
  | "phone"
  | "company"
  | "website"
  | "address"
  | "city"
  | "state"
  | "country"
  | "industry"
  | "notes";

const DEFAULT_TITLE_MAP: Record<string, LeadFieldKey> = {
  "first name": "firstName",
  "last name": "lastName",
  "lead type": "leadType",
  "lead source": "leadSource",
  "source": "leadSource",
  "status": "status",
  "stage": "stage",
  "owner": "owner",
  "assigned to": "owner",
  "email": "email",
  "phone": "phone",
  "company": "company",
  "website": "website",
  "address": "address",
  "city": "city",
  "state": "state",
  "country": "country",
  "industry": "industry",
  "notes": "notes",
};

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractPersonUserId(rawValue: string | null): string | null {
  const parsed = safeParseJson(rawValue) as { personsAndTeams?: Array<{ id?: number | string; kind?: string }> } | null;
  const person = parsed?.personsAndTeams?.find((p) => p.kind === "person");
  return person?.id != null ? String(person.id) : null;
}

const RELATED_LEAD_TITLE_HINTS = ["lead", "related lead", "linked lead", "leads"];

/**
 * Finds a "connect boards" (Monday type `board_relation`) column that
 * links this item back to a Lead, and returns the first linked item's
 * Monday id. Used by crm_calls/crm_deals imports — crm_leads itself
 * never calls this.
 *
 * Matching: prefers a column of type `board_relation` whose title hints
 * at "lead" (resilient to the exact column id being unknown); falls back
 * to any `board_relation` column at all if none match by title, since a
 * Call Log Tracker or Deals board realistically only links to one other
 * board. Returns null if no such column/value exists — a call or deal
 * with no resolvable link still imports, just without related_lead_id
 * filled in.
 */
export function extractRelatedLeadMondayItemId(item: MondayItem): string | null {
  const relationColumns = item.column_values.filter((cv) => cv.type === "board_relation");
  if (relationColumns.length === 0) return null;

  const byTitle = relationColumns.find((cv) => {
    const title = cv.column?.title?.trim().toLowerCase();
    return title && RELATED_LEAD_TITLE_HINTS.includes(title);
  });
  const column = byTitle ?? relationColumns[0];

  const parsed = safeParseJson(column.value) as { linkedPulseIds?: Array<{ linkedPulseId?: number | string }> } | null;
  const firstLink = parsed?.linkedPulseIds?.[0]?.linkedPulseId;
  return firstLink != null ? String(firstLink) : null;
}

/**
 * Builds a normalized column-id -> field-key map from an optional explicit
 * override JSON (field key -> column id) plus the default title map
 * resolved against this item's actual columns.
 */
function resolveColumnFieldMap(
  columnValues: MondayColumnValue[],
  columnIdMapJson: string | undefined,
): Map<string, LeadFieldKey> {
  const byColumnId = new Map<string, LeadFieldKey>();

  // 1. Title-based defaults (lowest priority)
  for (const cv of columnValues) {
    const title = cv.column?.title?.trim().toLowerCase();
    if (title && DEFAULT_TITLE_MAP[title]) {
      byColumnId.set(cv.id, DEFAULT_TITLE_MAP[title]);
    }
  }

  // 2. Explicit id overrides (highest priority)
  if (columnIdMapJson) {
    try {
      const explicit = JSON.parse(columnIdMapJson) as Record<string, string>;
      for (const [fieldKey, columnId] of Object.entries(explicit)) {
        byColumnId.set(columnId, fieldKey as LeadFieldKey);
      }
    } catch {
      // Malformed override config: fall back to title-based defaults only.
      // (Deliberately non-fatal — a bad env var shouldn't take the whole
      // pipeline down; the mismatch will be visible in customFields.)
    }
  }

  return byColumnId;
}

export function mapMondayItemToLead(item: MondayItem, boardId: string, columnIdMapJson?: string): NormalizedLead {
  const fieldMap = resolveColumnFieldMap(item.column_values, columnIdMapJson);

  const mapped: Record<LeadFieldKey, string | null> = {
    firstName: null,
    lastName: null,
    leadType: null,
    leadSource: null,
    status: null,
    stage: null,
    owner: null,
    email: null,
    phone: null,
    company: null,
    website: null,
    address: null,
    city: null,
    state: null,
    country: null,
    industry: null,
    notes: null,
  };
  let ownerMondayUserId: string | null = null;
  const customFields: NormalizedLead["customFields"] = {};

  for (const cv of item.column_values) {
    const fieldKey = fieldMap.get(cv.id);
    const text = cv.text ?? null;

    if (fieldKey) {
      mapped[fieldKey] = text && text.length > 0 ? text : null;
      if (fieldKey === "owner") {
        ownerMondayUserId = extractPersonUserId(cv.value);
      }
      continue;
    }

    customFields[cv.id] = {
      title: cv.column?.title ?? null,
      type: cv.type ?? null,
      text,
      value: safeParseJson(cv.value),
    };
  }

  return {
    mondayBoardId: boardId,
    mondayItemId: item.id,
    mondayGroupId: item.group?.id ?? null,
    mondayGroupTitle: item.group?.title ?? null,
    name: item.name,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    leadType: mapped.leadType,
    leadSource: mapped.leadSource,
    status: mapped.status,
    stage: mapped.stage,
    ownerName: mapped.owner,
    ownerMondayUserId,
    email: mapped.email,
    phone: mapped.phone,
    company: mapped.company,
    website: mapped.website,
    address: mapped.address,
    city: mapped.city,
    state: mapped.state,
    country: mapped.country,
    industry: mapped.industry,
    notes: mapped.notes,
    customFields,
    rawColumnValues: item.column_values,
    mondayCreatedAt: item.created_at ?? null,
    mondayUpdatedAt: item.updated_at ?? null,
  };
}
