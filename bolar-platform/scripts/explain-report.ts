/**
 * EXPLAIN ANALYZE report for the hot list queries (blueprint Days 91-104: "optimize measured bottlenecks only").
 *
 *   pnpm exec tsx load/seed-volume.ts            # ~5k rows per table in the load-pm org first
 *   pnpm exec tsx scripts/explain-report.ts      # markdown to stdout; --json for machine output
 *
 * The SQL mirrors what Prisma emits for each route (same predicates, ORDER BY and LIMIT limit+1). A query is
 * flagged when its plan contains a sequential scan on the main table; only those justify a new index.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'bolar-platform/.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
import { createPrismaClient } from '../packages/db/src/index.js';

const prisma = createPrismaClient(process.env.LOAD_DATABASE_URL ?? process.env.DATABASE_URL);
const ORG_SLUG = process.env.LOAD_ORG_SLUG ?? 'load-pm';
const json = process.argv.includes('--json');

interface Target { name: string; route: string; sql: (p: { org: string; propertyId: string; actorId: string }) => string }

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const TARGETS: Target[] = [
  { name: 'work-order board (open, newest first)', route: 'GET /work-orders?limit=25', sql: ({ org }) => `SELECT * FROM "WorkOrder" WHERE "tenantOrgId" = ${q(org)} AND NOT (status = 'canceled') ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'work-order board (overdue filter)', route: 'GET /work-orders?overdue=true&limit=25', sql: ({ org }) => `SELECT * FROM "WorkOrder" WHERE "tenantOrgId" = ${q(org)} AND "slaDueAt" < now() AND status IN ('new','triaged','assigned','scheduled','in_progress','blocked','review','reopened') ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'work-order board (property + status)', route: 'GET /work-orders?propertyId=&status=assigned&limit=25', sql: ({ org, propertyId }) => `SELECT * FROM "WorkOrder" WHERE "tenantOrgId" = ${q(org)} AND "propertyId" = ${q(propertyId)} AND status IN ('assigned') ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'invoices list (org scope)', route: 'GET /invoices?limit=25', sql: ({ org }) => `SELECT * FROM "Invoice" WHERE "tenantOrgId" = ${q(org)} ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'invoices list (overdue)', route: 'GET /invoices?overdue=true&limit=25', sql: ({ org }) => `SELECT * FROM "Invoice" WHERE "tenantOrgId" = ${q(org)} AND (status = 'overdue' OR (status IN ('open','partially_paid') AND "dueDate" < date_trunc('day', now()))) ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'audit query (action prefix)', route: 'GET /audit?action=lease.&limit=25', sql: ({ org }) => `SELECT * FROM "AuditLog" WHERE "tenantOrgId" = ${q(org)} AND action LIKE 'lease.%' ORDER BY id DESC LIMIT 26` },
  { name: 'audit query (resource)', route: 'GET /audit?resourceType=property&resourceId=&limit=25', sql: ({ org, propertyId }) => `SELECT * FROM "AuditLog" WHERE "tenantOrgId" = ${q(org)} AND "resourceType" = 'property' AND "resourceId" = ${q(propertyId)} ORDER BY id DESC LIMIT 26` },
  { name: 'audit query (actor, time window)', route: 'GET /audit?actorId=&from=&limit=25', sql: ({ org, actorId }) => `SELECT * FROM "AuditLog" WHERE "tenantOrgId" = ${q(org)} AND "actorId" = ${q(actorId)} AND "createdAt" >= now() - interval '30 days' ORDER BY id DESC LIMIT 26` },
  { name: 'documents by owner', route: 'GET /documents?ownerType=property&ownerId=&limit=25', sql: ({ org, propertyId }) => `SELECT * FROM "Document" WHERE "tenantOrgId" = ${q(org)} AND "deletedAt" IS NULL AND "ownerType" = 'property' AND "ownerId" = ${q(propertyId)} AND classification IN ('public','internal','confidential') ORDER BY id DESC LIMIT 26` },
  { name: 'rule evaluations review queue', route: 'GET /rules/evaluations?result=block&reviewed=false&limit=25', sql: ({ org }) => `SELECT e.*, r.severity, r.domain FROM "RuleEvaluation" e JOIN "ComplianceRule" r ON r.id = e."ruleId" WHERE e."tenantOrgId" = ${q(org)} AND e.result = 'block' AND e."reviewedAt" IS NULL ORDER BY e."createdAt" DESC, e.id DESC LIMIT 26` },
  { name: 'tenant profile search (status + q)', route: 'GET /tenant-profiles?status=active&q=Resident 12&limit=25', sql: ({ org }) => `SELECT * FROM "TenantProfile" WHERE "tenantOrgId" = ${q(org)} AND status = 'active' AND ("displayName" ILIKE '%Resident 12%' OR email ILIKE '%Resident 12%') ORDER BY id DESC LIMIT 26` },
  { name: 'property list by status + city', route: 'GET /properties?status=active&city=Austin&limit=25', sql: ({ org }) => `SELECT * FROM "Property" WHERE "tenantOrgId" = ${q(org)} AND status = 'active' AND city ILIKE 'Austin' ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'property list (default, keyset page 2)', route: 'GET /properties?cursor=...&limit=25', sql: ({ org }) => `SELECT * FROM "Property" WHERE "tenantOrgId" = ${q(org)} AND NOT (status = 'archived') AND ("createdAt" < now() - interval '100 days' OR ("createdAt" = now() - interval '100 days' AND id < 'zzz')) ORDER BY "createdAt" DESC, id DESC LIMIT 26` },
  { name: 'role resolution per request (context.ts)', route: 'every authenticated request (cached 30 s)', sql: ({ org, actorId }) => `SELECT * FROM "RoleAssignment" WHERE "userId" = ${q(actorId)} AND "revokedAt" IS NULL AND ("tenantOrgId" = ${q(org)} OR "scopeType" = 'platform') LIMIT 200` },
  { name: 'active support session lookup (X-Tenant-Org)', route: 'cross-tenant requests', sql: ({ org, actorId }) => `SELECT id FROM "SupportSession" WHERE "tenantOrgId" = ${q(org)} AND "agentUserId" = ${q(actorId)} AND "endedAt" IS NULL AND "endsAt" > now() LIMIT 1` },
];

interface Row { 'QUERY PLAN': string }

async function main() {
  const org = await prisma.tenantOrg.findUnique({ where: { slug: ORG_SLUG }, select: { id: true } });
  if (!org) throw new Error(`org ${ORG_SLUG} not found; run load/seed-volume.ts first`);
  const prop = await prisma.property.findFirst({ where: { tenantOrgId: org.id }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const actor = await prisma.userProfile.findFirst({ where: { tenantOrgId: org.id }, select: { id: true } });
  if (!prop || !actor) throw new Error('load org has no properties/users; run load/seed-volume.ts first');
  const params = { org: org.id, propertyId: prop.id, actorId: actor.id };
  const counts: Record<string, number> = {};
  for (const t of ['Property', 'WorkOrder', 'Invoice', 'AuditLog', 'Document', 'RuleEvaluation', 'TenantProfile']) {
    const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${t}"`);
    counts[t] = Number(r[0]?.n ?? 0);
  }
  const results: Array<{ name: string; route: string; seqScan: boolean; ms: number; plan: string[] }> = [];
  for (const t of TARGETS) {
    const sql = t.sql(params);
    const rows = await prisma.$queryRawUnsafe<Row[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
    const plan = rows.map((r) => r['QUERY PLAN']);
    const mainTable = /FROM "(\w+)"/.exec(sql)?.[1] ?? '';
    const seqScan = plan.some((l) => new RegExp(`Seq Scan on "?${mainTable}"?`).test(l));
    const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan.join('\n'))?.[1] ?? 0);
    results.push({ name: t.name, route: t.route, seqScan, ms, plan });
  }
  if (json) { console.info(JSON.stringify({ counts, results }, null, 2)); return; }
  const out: string[] = [];
  out.push(`Table sizes: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  out.push('');
  out.push('| Query | Route | Scan | Exec ms |');
  out.push('| --- | --- | --- | --- |');
  for (const r of results) out.push(`| ${r.name} | \`${r.route}\` | ${r.seqScan ? 'SEQ SCAN' : 'index'} | ${r.ms.toFixed(2)} |`);
  out.push('');
  for (const r of results) {
    out.push(`### ${r.name}`);
    out.push('```');
    out.push(...r.plan);
    out.push('```');
    out.push('');
  }
  console.info(out.join('\n'));
  const flagged = results.filter((r) => r.seqScan);
  console.error(`[explain-report] ${results.length} queries, ${flagged.length} with a sequential scan${flagged.length ? ': ' + flagged.map((f) => f.name).join('; ') : ''}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
