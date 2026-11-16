/**
 * Pagination audit (Days 91-104 "no unbounded lists").
 *  1. Route-level: every GET route returning a page declares `limit` (default and cap <= 100). The same assertion
 *     runs at API startup (createApp), so this test documents and double-checks it.
 *  2. Query-level: every `findMany(` in packages/api/src/modules passes `take`, or is listed with a justification
 *     in pagination-allowlist.json (bounded by an `in` list derived from a page, by a parent row, or by a tiny
 *     catalog). Adding a new unbounded query fails here until it is bounded or justified.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from '@bolar/contracts';
import '../modules/index.js';
import { routeRegistry, assertBoundedListRoutes, isPageResponse, MAX_PAGE_LIMIT, type RouteDef } from '../shared/route.js';

const MODULES_DIR = resolve(process.cwd(), 'src/modules');
const ALLOWLIST_PATH = resolve(process.cwd(), 'src/__tests__/pagination-allowlist.json');

interface AllowEntry { file: string; model: string; reason: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Extract each `<delegate>.findMany(<balanced args>)` call: delegate name + argument text. */
export function findManyCalls(source: string): { model: string; args: string; line: number }[] {
  const calls: { model: string; args: string; line: number }[] = [];
  const re = /([A-Za-z_$][\w$]*)\.findMany\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '`' || ch === "'" || ch === '"') { const q = ch; i++; while (i < source.length && source[i] !== q) { if (source[i] === '\\') i++; i++; } }
      i++;
    }
    calls.push({ model: m[1]!, args: source.slice(start, i - 1), line: source.slice(0, m.index).split('\n').length });
  }
  return calls;
}

/**
 * A findMany is considered bounded when it:
 *  - passes `take` (explicit page size), or
 *  - filters an id-like column with `{ in: [...] }` (the list comes from an already-paginated page or request body), or
 *  - is scoped to one actor/user (ReBAC edge or ownership lookups for the current user).
 * Anything else must carry `take` or an allowlist justification.
 */
export function boundedBy(args: string): 'take' | 'in-list' | 'actor' | null {
  if (/(^|[\s,{])take\s*:/.test(args)) return 'take';
  if (/\b(id|[A-Za-z]+Id|code|key)\s*:\s*\{\s*in\s*:/.test(args)) return 'in-list';
  if (/\b(subjectId|userId|ownerUserId|requesterId|assignedUserId|agentUserId|actorId)\s*(:\s*(ctx\.actor!?\.userId|userId|user\.id|[a-z]+\.userId)\b|\s*[,}])/.test(args)) return 'actor';
  return null;
}
export function isBounded(args: string): boolean { return boundedBy(args) !== null; }

describe('pagination audit', () => {
  it('every page-returning GET route declares a bounded limit (<= 100); startup assertion catches offenders', () => {
    const result = assertBoundedListRoutes();
    expect(result.pageRoutes.length).toBeGreaterThanOrEqual(40);
    for (const r of routeRegistry.filter((r) => r.method === 'get' && isPageResponse(r.responses[200] as never))) {
      const limit = (r.request!.query as unknown as { def: { shape: Record<string, z.ZodTypeAny> } }).def.shape.limit!;
      expect(limit, `${r.path} declares limit`).toBeDefined();
      expect(limit.safeParse('101').success, `${r.path} rejects limit=101`).toBe(false);
      expect(limit.safeParse('0').success, `${r.path} rejects limit=0`).toBe(false);
      expect(limit.parse(undefined)).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
    }
    const page = z.object({ items: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() });
    const offender: RouteDef = { method: 'get', path: '/x', operationId: 'listX', summary: '', tags: [], auth: 'session', responses: { 200: page }, handler: async () => ({}), request: { query: z.object({ q: z.string().optional() }) } };
    expect(() => assertBoundedListRoutes([offender])).toThrow(/Unbounded list routes[\s\S]*GET \/x \(listX\): no limit query parameter/);
    const noDefault: RouteDef = { ...offender, operationId: 'listW', path: '/w', request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100) }) } };
    expect(() => assertBoundedListRoutes([noDefault])).toThrow(/default limit is undefined/);
    const tooBig: RouteDef = { ...offender, operationId: 'listY', path: '/y', request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(25) }) } };
    expect(() => assertBoundedListRoutes([tooBig])).toThrow(/limit=101 accepted/);
    const fine: RouteDef = { ...offender, operationId: 'listZ', path: '/z', request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }) } };
    expect(assertBoundedListRoutes([fine]).pageRoutes).toEqual(['GET /z']);
    // non-page GETs and mutations are not subject to the rule
    const detail: RouteDef = { ...offender, operationId: 'getZ', path: '/z/:id', responses: { 200: z.object({ id: z.string() }) }, request: {} };
    expect(assertBoundedListRoutes([detail]).pageRoutes).toEqual([]);
  });

  it('every findMany in packages/api/src/modules passes take or is allowlisted with a justification', () => {
    const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as AllowEntry[];
    for (const e of allow) expect(e.reason.length, `${e.file} ${e.model} needs a reason`).toBeGreaterThan(15);
    const allowKey = new Set(allow.map((e) => `${e.file}::${e.model}`));
    const used = new Set<string>();
    const offenders: string[] = [];
    let total = 0;
    let bounded = 0;
    for (const file of walk(MODULES_DIR)) {
      const rel = relative(MODULES_DIR, file).replaceAll('\\', '/');
      const src = readFileSync(file, 'utf8');
      for (const call of findManyCalls(src)) {
        total++;
        if (isBounded(call.args)) { bounded++; continue; }
        const key = `${rel}::${call.model}`;
        if (allowKey.has(key)) { used.add(key); continue; }
        offenders.push(`${rel}:${call.line} ${call.model}.findMany(...) has no take`);
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(bounded).toBeGreaterThan(0);
    expect(offenders, `Unbounded findMany calls:\n${offenders.join('\n')}`).toEqual([]);
    // stale allowlist entries must be removed so the list stays honest
    const stale = [...allowKey].filter((k) => !used.has(k));
    expect(stale, `stale allowlist entries: ${stale.join(', ')}`).toEqual([]);
  });

  it('unit: call extraction handles nested parens, strings and multi-line arguments', () => {
    const src = `const a = await db.lease.findMany({ where: { x: 'take: )' }, take: limit + 1, orderBy: [{ createdAt: 'desc' }] });\n` +
      `const b = await prisma.auditLog.findMany({\n  where: { tenantOrgId },\n  orderBy: { id: 'desc' },\n});\nconst c = tenantDb(ctx).unit.findMany({ where: { id: { in: ids } }, select: { id: true } });`;
    const calls = findManyCalls(src);
    expect(calls.map((c) => c.model)).toEqual(['lease', 'auditLog', 'unit']);
    expect(isBounded(calls[0]!.args)).toBe(true);
    expect(isBounded(calls[1]!.args)).toBe(false);
    expect(boundedBy(calls[2]!.args)).toBe('in-list');
    expect(calls[1]!.line).toBe(2);
  });
});
