/**
 * Data classification (blueprint p14 Sensitive access gate).
 * public < internal < confidential < restricted
 */
export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

const RANK: Record<Classification, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

export function classificationRank(c: Classification): number {
  return RANK[c];
}

export function isAtLeast(c: Classification, min: Classification): boolean {
  return RANK[c] >= RANK[min];
}

/** Classifications that require an approved SensitiveAccessRequest (purpose + expiry) before reading. */
export const GATED_CLASSIFICATIONS: readonly Classification[] = ['confidential', 'restricted'];

export function isGated(c: Classification): boolean {
  return GATED_CLASSIFICATIONS.includes(c);
}

/** Purposes an actor may declare when requesting sensitive access. */
export const ACCESS_PURPOSES = [
  'lease_administration',
  'maintenance_coordination',
  'financial_reconciliation',
  'compliance_review',
  'legal_case',
  'privacy_request',
  'agency_request',
  'support_session',
] as const;
export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];

/** Field-level classification map helper. */
export type FieldClassification<T extends string> = Record<T, Classification>;

/** Remove fields above the viewer's cleared classification. */
export function redactFields<T extends Record<string, unknown>>(
  record: T,
  fieldClass: Partial<Record<keyof T, Classification>>,
  cleared: Classification,
): T & { redactedFields: string[] } {
  const out: Record<string, unknown> = { ...record };
  const redacted: string[] = [];
  for (const [field, cls] of Object.entries(fieldClass) as [string, Classification][]) {
    if (RANK[cls] > RANK[cleared] && field in out) {
      out[field] = null;
      redacted.push(field);
    }
  }
  return { ...(out as T), redactedFields: redacted };
}
