// Transforms a raw Monday.com item into the normalized shape the CRM
// leads table stores. This is the single source of truth for
// column -> field mapping: both the webhook pipeline and any future
// initial/bulk import script must call mapMondayItemToLead() rather than
// re-implementing this transformation.
//
// Column matching strategy: by default, columns are matched by TITLE
// (case-insensitive, whitespace-trimmed) against the well-known Leads
// fields below. This is resilient to column ids being unknown ahead of
// time, at the cost of breaking if someone renames a column on the
// Monday board. Once the real board's column ids are confirmed, set
// MONDAY_COLUMN_ID_MAP (JSON, e.g. '{"email":"email_9"}') to pin exact
// ids per field — id-based entries always take priority over title
// matches.

import type { MondayColumnValue, MondayItem, NormalizedLead } from "./types.ts";

export type LeadFieldKey =
  | "leadType"
  | "leadSource"
  | "status"
  | "owner"
  | "email"
  | "phone"
  | "company";

const DEFAULT_TITLE_MAP: Record<string, LeadFieldKey> = {
  "lead type": "leadType",
  "lead source": "leadSource",
  "source": "leadSource",
  "status": "status",
  "owner": "owner",
  "assigned to": "owner",
  "email": "email",
  "phone": "phone",
  "company": "company",
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
    leadType: null,
    leadSource: null,
    status: null,
    owner: null,
    email: null,
    phone: null,
    company: null,
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
    leadType: mapped.leadType,
    leadSource: mapped.leadSource,
    status: mapped.status,
    ownerName: mapped.owner,
    ownerMondayUserId,
    email: mapped.email,
    phone: mapped.phone,
    company: mapped.company,
    customFields,
    rawColumnValues: item.column_values,
    mondayCreatedAt: item.created_at ?? null,
    mondayUpdatedAt: item.updated_at ?? null,
  };
}
