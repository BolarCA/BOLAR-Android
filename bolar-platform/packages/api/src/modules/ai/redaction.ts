import { redactObject, redactText } from '@bolar/shared';

/**
 * Field classification for anything that leaves the API towards a model or is stored in AI tables (blueprint p14, p300).
 * Restricted identifiers are dropped entirely; pattern redaction (`redactText`) covers free text; sensitive keys
 * (email, phone, account numbers, tokens) are masked by `redactObject`. Counts are kept for the audit row.
 */
export const RESTRICTED_FIELDS = ['ssnlast4', 'ssn', 'dateofbirth', 'dob', 'birthdate', 'passwordhash', 'mfasecret', 'accountnumber', 'routingnumber', 'bankaccount', 'taxid', 'ein', 'licensenumber'];
const MASKED_KEYS = ['password', 'ssn', 'token', 'secret', 'accountnumber', 'routingnumber', 'email', 'phone'];

const COUNT_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g,
  /\b\d{9,18}\b/g,
  /(bearer\s+)[A-Za-z0-9._-]+/gi,
];

export function countRedactions(text: string): number {
  let n = 0;
  for (const re of COUNT_PATTERNS) n += (text.match(re) ?? []).length;
  return n;
}

export function redactTextCounted(text: string): { text: string; count: number } {
  return { text: redactText(text), count: countRedactions(text) };
}

function isRestrictedKey(key: string): boolean {
  const k = key.toLowerCase();
  return RESTRICTED_FIELDS.some((f) => k === f || k.endsWith(f));
}
function isMaskedKey(key: string): boolean {
  const k = key.toLowerCase();
  return MASKED_KEYS.some((f) => k.includes(f));
}

function walk(value: unknown, counter: { n: number }): unknown {
  if (typeof value === 'string') { const r = redactTextCounted(value); counter.n += r.count; return r.text; }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => walk(v, counter));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isRestrictedKey(k)) { counter.n++; continue; }
      if (isMaskedKey(k)) { counter.n++; out[k] = '[redacted]'; continue; }
      out[k] = walk(v, counter);
    }
    return out;
  }
  return value;
}

/** Drop restricted fields, mask sensitive keys and redact PII patterns in every string. Idempotent. */
export function redactForModel<T>(value: T): { value: T; count: number } {
  const counter = { n: 0 };
  const walked = walk(value, counter);
  // Second pass with the shared helper as defense in depth (same key list, no extra counting).
  return { value: redactObject(walked) as T, count: counter.n };
}
