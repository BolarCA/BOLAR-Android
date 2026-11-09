import { errors } from '@bolar/shared';

/**
 * Template rendering (Day 29). `{{variable}}` interpolation with HTML escaping of every value.
 * Missing variables are a hard failure (400 validation) so a notice can never go out with a blank.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export type TemplateVariables = Record<string, string | number | boolean | null | undefined>;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

export function placeholdersIn(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (text ?? '').matchAll(PLACEHOLDER)) out.add(m[1]!);
  return [...out];
}

/** Variables the version needs: declared list union placeholders found in subject/body. */
export function requiredVariables(version: { subject: string | null; body: string; variables: unknown }): string[] {
  const declared = Array.isArray(version.variables) ? (version.variables as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  return [...new Set([...declared, ...placeholdersIn(version.subject), ...placeholdersIn(version.body)])];
}

export function missingVariables(version: { subject: string | null; body: string; variables: unknown }, vars: TemplateVariables): string[] {
  return requiredVariables(version).filter((name) => vars[name] === undefined || vars[name] === null || vars[name] === '');
}

function interpolate(text: string, vars: TemplateVariables, escape: boolean): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    const v = vars[name];
    const str = v === undefined || v === null ? '' : String(v);
    return escape ? escapeHtml(str) : str;
  });
}

export interface Rendered { subject: string | null; body: string }

/**
 * Render a version. Throws a validation error listing every missing variable. SMS bodies are plain
 * text and are not HTML-escaped; every other channel is escaped to neutralize injected markup.
 */
export function renderVersion(version: { subject: string | null; body: string; variables: unknown }, vars: TemplateVariables, channel: string): Rendered {
  const missing = missingVariables(version, vars);
  if (missing.length) {
    throw errors.validation(missing.map((name) => ({ path: `variables.${name}`, message: 'Missing template variable' })), `Missing template variables: ${missing.join(', ')}`);
  }
  const escape = channel !== 'sms';
  return { subject: version.subject === null ? null : interpolate(version.subject, vars, escape), body: interpolate(version.body, vars, escape) };
}
