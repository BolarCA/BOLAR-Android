/** Log/notification redaction: never emit emails, phones, SSNs, account numbers, or tokens in logs. */
const PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, '[phone]'],
  [/\b\d{9,18}\b/g, '[number]'],
  [/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[token]'],
];
export function redactText(input: string): string {
  return PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), input);
}
export function redactObject<T>(obj: T, sensitiveKeys: string[] = ['password', 'ssn', 'token', 'secret', 'accountNumber', 'routingNumber', 'email', 'phone']): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, sensitiveKeys)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase())) ? '[redacted]' : redactObject(v, sensitiveKeys);
  }
  return out as T;
}
