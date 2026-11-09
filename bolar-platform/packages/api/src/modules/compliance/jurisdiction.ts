/**
 * Jurisdiction resolver (blueprint Day 42). Builds the applicable jurisdiction chain from a property address,
 * applies a per-property override, and selects the rules in force at a point in time (highest version per key).
 */
import type { RequestContext } from '@bolar/shared';
import { errors } from '@bolar/shared';
import { prisma, tenantDb } from '../../shared/db.js';
import type { EngineRule } from './engine.js';

export interface AddressParts { state: string; county?: string | null; city?: string | null; country?: string | null }
export interface ScopedRule extends EngineRule { id: string; status: string; effectiveFrom: Date; effectiveTo: Date | null }

export function jurisdictionSegment(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** ['US', 'US-TX', 'US-TX-TRAVIS', 'US-TX-AUSTIN'] (duplicates collapse, e.g. city == county). */
export function jurisdictionChain(addr: AddressParts): string[] {
  const chain: string[] = ['US'];
  const st = addr.state ? jurisdictionSegment(addr.state) : '';
  if (!st) return chain;
  chain.push(`US-${st}`);
  if (addr.county) chain.push(`US-${st}-${jurisdictionSegment(addr.county)}`);
  if (addr.city) chain.push(`US-${st}-${jurisdictionSegment(addr.city)}`);
  return [...new Set(chain)];
}

/** 'US-CA-WEST_HOLLYWOOD' -> ['US', 'US-CA', 'US-CA-WEST_HOLLYWOOD'] */
export function expandJurisdiction(code: string): string[] {
  const parts = code.toUpperCase().split('-').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('-'));
  return out[0] === 'US' ? out : ['US', ...out];
}

/** The override replaces the most specific level of the address chain; its own parents are kept so state rules still apply. */
export function applyOverride(chain: string[], overrideJurisdiction: string | null | undefined): string[] {
  if (!overrideJurisdiction) return chain;
  const base = chain.length > 1 ? chain.slice(0, -1) : chain;
  return [...new Set([...base, ...expandJurisdiction(overrideJurisdiction)])];
}

export function isEffective(rule: { effectiveFrom: Date; effectiveTo: Date | null }, asOf: Date): boolean {
  return rule.effectiveFrom.getTime() <= asOf.getTime() && (rule.effectiveTo === null || asOf.getTime() < rule.effectiveTo.getTime());
}

/** Pure selection: active, in chain, effective at asOf, highest version per key, optional domain filter. */
export function selectRules<T extends ScopedRule>(rules: readonly T[], chain: readonly string[], asOf: Date, domains?: readonly string[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rules) {
    if (r.status !== 'active' || !chain.includes(r.jurisdiction) || !isEffective(r, asOf)) continue;
    if (domains && domains.length && !domains.includes(r.domain)) continue;
    const prev = byKey.get(r.key);
    if (!prev || r.version > prev.version) byKey.set(r.key, r);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface ResolvedJurisdiction { chain: string[]; override: { id: string; propertyId: string; jurisdiction: string; reason: string; createdBy: string; createdAt: Date } | null; propertyId: string | null }

/** Resolve a property's chain inside the caller's tenant (404 if the property is not theirs). */
export async function resolvePropertyJurisdiction(ctx: RequestContext, propertyId: string): Promise<ResolvedJurisdiction> {
  const db = tenantDb(ctx);
  const property = await db.property.findFirst({ where: { id: propertyId }, select: { id: true, state: true, county: true, city: true, country: true } });
  if (!property) throw errors.notFound();
  const override = await db.jurisdictionOverride.findFirst({ where: { propertyId } });
  return { chain: applyOverride(jurisdictionChain(property), override?.jurisdiction), override: override ?? null, propertyId };
}

/** Chain from an explicit code, a property, or the national default. */
export async function resolveChain(ctx: RequestContext, input: { propertyId?: string; jurisdiction?: string }): Promise<ResolvedJurisdiction> {
  if (input.propertyId) return resolvePropertyJurisdiction(ctx, input.propertyId);
  if (input.jurisdiction) return { chain: expandJurisdiction(input.jurisdiction), override: null, propertyId: null };
  return { chain: ['US'], override: null, propertyId: null };
}

/** Rules are platform-global (no tenantOrgId), so the root client is used deliberately here. */
export async function loadRulesForChain(chain: readonly string[], asOf: Date, domains?: readonly string[]): Promise<ScopedRule[]> {
  const rows = await prisma.complianceRule.findMany({ where: { jurisdiction: { in: [...chain] }, status: 'active', ...(domains?.length ? { domain: { in: [...domains] } } : {}) }, take: 500 });
  return selectRules(rows, chain, asOf, domains);
}

export async function loadRulesByKeys(keys: readonly string[], asOf = new Date()): Promise<ScopedRule[]> {
  const rows = await prisma.complianceRule.findMany({ where: { key: { in: [...keys] }, status: 'active' } });
  const chain = [...new Set(rows.map((r) => r.jurisdiction))];
  return selectRules(rows, chain, asOf);
}
