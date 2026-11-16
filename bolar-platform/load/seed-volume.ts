/**
 * Volume seed for performance work (blueprint Days 91-104). Synthetic, idempotent: tops each table up to
 * LOAD_ROWS (default 5000) rows inside a dedicated org (`load-pm`) so the demo org stays untouched.
 *
 *   pnpm exec tsx load/seed-volume.ts                       # against DATABASE_URL from .env
 *   LOAD_DATABASE_URL=postgresql://bolar@localhost:5432/bolar_agent3_load pnpm exec tsx load/seed-volume.ts
 *
 * Personas (password Bolar!Demo2026): manager@load.bolar.test, tenant@load.bolar.test, books@load.bolar.test.
 * Imports the db package by relative path so no extra root dependency is needed.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'bolar-platform/.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
import { createPrismaClient, hashPassword } from '../packages/db/src/index.js';

const TARGET = Number(process.env.LOAD_ROWS ?? 5000);
const ORG = { slug: process.env.LOAD_ORG_SLUG ?? 'load-pm', name: 'Load Test Property Management' };
const PASSWORD = process.env.LOAD_PASSWORD ?? 'Bolar!Demo2026';
const CITIES = ['Austin', 'Dallas', 'Houston', 'San Antonio', 'El Paso', 'Fort Worth', 'Plano', 'Irving'];
const PROPERTY_STATUS = ['active', 'active', 'active', 'inactive', 'onboarding', 'archived'];
const WO_STATUS = ['new', 'triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'review', 'complete', 'canceled'];
const WO_PRIORITY = ['emergency', 'high', 'normal', 'normal', 'low'];
const WO_CATEGORY = ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest', 'safety', 'other'];
const INVOICE_STATUS = ['open', 'open', 'partially_paid', 'paid', 'overdue', 'void', 'draft'];
const LEASE_STATUS = ['active', 'active', 'active', 'signed', 'renewal', 'terminated', 'draft'];
const TP_STATUS = ['prospect', 'applicant', 'active', 'active', 'former'];
const RESULTS = ['allow', 'warn', 'block', 'review'];
const DOC_OWNER = ['property', 'lease', 'tenant_profile', 'work_order'];
const AUDIT_ACTIONS = ['property.create', 'lease.transition', 'work_order.transition', 'access.denied', 'document.upload', 'invoice.issue'];

const prisma = createPrismaClient(process.env.LOAD_DATABASE_URL ?? process.env.DATABASE_URL);
const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const CHUNK = 500;

async function topUp(label: string, count: () => Promise<number>, insert: (from: number, to: number) => Promise<void>): Promise<void> {
  const have = await count();
  if (have >= TARGET) { console.info(`[seed-volume] ${label}: ${have} rows (ok)`); return; }
  for (let from = have; from < TARGET; from += CHUNK) await insert(from, Math.min(TARGET, from + CHUNK));
  console.info(`[seed-volume] ${label}: ${have} -> ${TARGET} rows`);
}

async function main() {
  const started = Date.now();
  const org = await prisma.tenantOrg.upsert({ where: { slug: ORG.slug }, update: {}, create: ORG });
  const orgId = org.id;
  const ba = (await prisma.businessAccount.findFirst({ where: { tenantOrgId: orgId } })) ?? (await prisma.businessAccount.create({ data: { tenantOrgId: orgId, name: 'Load Holdings LLC' } }));
  const sub = (await prisma.subaccount.findFirst({ where: { tenantOrgId: orgId } })) ?? (await prisma.subaccount.create({ data: { tenantOrgId: orgId, businessAccountId: ba.id, name: 'Default' } }));
  const pwd = await hashPassword(PASSWORD);
  const users: Record<string, string> = {};
  for (const [email, role] of [['manager@load.bolar.test', 'property_manager'], ['tenant@load.bolar.test', 'tenant'], ['books@load.bolar.test', 'bookkeeper'], ['admin@load.bolar.test', 'org_admin']] as const) {
    const u = await prisma.userProfile.upsert({ where: { tenantOrgId_email: { tenantOrgId: orgId, email } }, update: {}, create: { tenantOrgId: orgId, email, name: email.split('@')[0]!, passwordHash: pwd } });
    users[role] = u.id;
    const has = await prisma.roleAssignment.findFirst({ where: { tenantOrgId: orgId, userId: u.id, role, revokedAt: null } });
    if (!has) await prisma.roleAssignment.create({ data: { tenantOrgId: orgId, userId: u.id, role, scopeType: 'org', scopeId: orgId } });
  }
  const rule = await prisma.complianceRule.upsert({
    where: { key_version: { key: 'load.synthetic', version: 1 } }, update: {},
    create: { key: 'load.synthetic', version: 1, jurisdiction: 'US-TX', domain: 'maintenance', title: 'Synthetic load rule', description: 'Load test only', conditions: {}, effectiveFrom: daysAgo(365) },
  });

  await topUp('Property', () => prisma.property.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.property.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, subaccountId: sub.id, name: `LOAD Property ${i}`, addressLine1: `${i} Load St`, city: pick(CITIES, i), state: 'TX', postalCode: `7${String(i % 9000 + 1000)}`, status: pick(PROPERTY_STATUS, i), createdAt: daysAgo(i % 720) }; }) });
  });
  const properties = await prisma.property.findMany({ where: { tenantOrgId: orgId }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: TARGET });

  await topUp('Unit', () => prisma.unit.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.unit.createMany({ skipDuplicates: true, data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, propertyId: pick(properties, i).id, unitNumber: `U${i}`, status: i % 3 === 0 ? 'vacant' : 'occupied', targetRentCents: 100000 + (i % 50) * 1000 }; }) });
  });
  const units = await prisma.unit.findMany({ where: { tenantOrgId: orgId }, select: { id: true, propertyId: true }, orderBy: { id: 'asc' }, take: TARGET });

  await topUp('TenantProfile', () => prisma.tenantProfile.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.tenantProfile.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, displayName: `Load Resident ${i}`, email: `resident${i}@load.bolar.test`, status: pick(TP_STATUS, i), userId: i === 0 ? users.tenant : null, createdAt: daysAgo(i % 720) }; }) });
  });
  const profiles = await prisma.tenantProfile.findMany({ where: { tenantOrgId: orgId }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: TARGET });

  await topUp('Lease', () => prisma.lease.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.lease.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; const u = pick(units, i); return { tenantOrgId: orgId, propertyId: u.propertyId, unitId: u.id, status: pick(LEASE_STATUS, i), startDate: daysAgo(400 - (i % 300)), endDate: daysAgo(35 - (i % 300)), rentCents: 100000 + (i % 50) * 1000, createdBy: users.property_manager!, createdAt: daysAgo(i % 720) }; }) });
  });
  const leases = await prisma.lease.findMany({ where: { tenantOrgId: orgId }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: TARGET });
  if ((await prisma.leaseParty.count({ where: { tenantOrgId: orgId } })) < Math.min(TARGET, leases.length)) {
    await prisma.leaseParty.createMany({ skipDuplicates: true, data: leases.map((l, i) => ({ tenantOrgId: orgId, leaseId: l.id, tenantProfileId: pick(profiles, i).id, role: 'primary' })) });
  }

  await topUp('Invoice', () => prisma.invoice.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.invoice.createMany({ skipDuplicates: true, data: Array.from({ length: to - from }, (_, k) => { const i = from + k; const status = pick(INVOICE_STATUS, i); const total = 100000 + (i % 50) * 1000; return { tenantOrgId: orgId, leaseId: pick(leases, i).id, tenantProfileId: pick(profiles, i).id, number: `LOAD-${String(i).padStart(6, '0')}`, status, dueDate: daysAgo(60 - (i % 120)), totalCents: total, paidCents: status === 'paid' ? total : status === 'partially_paid' ? Math.floor(total / 2) : 0, issuedAt: status === 'draft' ? null : daysAgo(90 - (i % 120)), createdAt: daysAgo(i % 720) }; }) });
  });

  await topUp('WorkOrder', () => prisma.workOrder.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.workOrder.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; const u = pick(units, i); const status = pick(WO_STATUS, i); return { tenantOrgId: orgId, propertyId: u.propertyId, unitId: u.id, requesterId: users.tenant!, title: `LOAD ${pick(WO_CATEGORY, i)} issue ${i}`, description: `Synthetic work order ${i} for load testing`, category: pick(WO_CATEGORY, i), priority: pick(WO_PRIORITY, i), status, slaDueAt: daysAgo(10 - (i % 20)), createdAt: daysAgo(i % 365) }; }) });
  });

  await topUp('Document', () => prisma.document.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.document.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; const ownerType = pick(DOC_OWNER, i); const ownerId = ownerType === 'property' ? pick(properties, i).id : ownerType === 'lease' ? pick(leases, i).id : ownerType === 'tenant_profile' ? pick(profiles, i).id : pick(units, i).id; return { tenantOrgId: orgId, ownerType, ownerId, title: `LOAD document ${i}`, classification: i % 7 === 0 ? 'confidential' : 'internal', category: 'general', createdBy: users.property_manager!, createdAt: daysAgo(i % 720) }; }) });
  });

  await topUp('AuditLog', () => prisma.auditLog.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.auditLog.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, actorId: i % 2 ? users.property_manager! : users.bookkeeper!, action: pick(AUDIT_ACTIONS, i), resourceType: pick(['property', 'lease', 'work_order', 'document', 'invoice'], i), resourceId: pick(properties, i).id, outcome: i % 11 === 0 ? 'deny' : 'allow', requestId: `load-${i}`, createdAt: daysAgo(i % 180) }; }) });
  });

  await topUp('RuleEvaluation', () => prisma.ruleEvaluation.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.ruleEvaluation.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, ruleId: rule.id, ruleKey: rule.key, ruleVersion: 1, resourceType: 'lease', resourceId: pick(leases, i).id, result: pick(RESULTS, i), evidenceJson: { i }, reviewedAt: i % 3 === 0 ? daysAgo(1) : null, createdAt: daysAgo(i % 180) }; }) });
  });

  // Users + role assignments: the per-request role resolution (shared/context.ts) must stay an index scan at volume.
  await topUp('UserProfile', () => prisma.userProfile.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.userProfile.createMany({ skipDuplicates: true, data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, email: `user${i}@load.bolar.test`, name: `Load User ${i}`, passwordHash: pwd, status: i % 50 === 0 ? 'suspended' : 'active' }; }) });
  });
  const loadUsers = await prisma.userProfile.findMany({ where: { tenantOrgId: orgId, email: { startsWith: 'user' } }, select: { id: true }, orderBy: { id: 'asc' }, take: TARGET });
  await topUp('RoleAssignment', () => prisma.roleAssignment.count({ where: { tenantOrgId: orgId } }), async (from, to) => {
    await prisma.roleAssignment.createMany({ data: Array.from({ length: to - from }, (_, k) => { const i = from + k; return { tenantOrgId: orgId, userId: pick(loadUsers, i).id, role: pick(['tenant', 'tenant', 'landlord', 'vendor', 'property_manager'], i), scopeType: i % 5 === 4 ? 'property' : 'org', scopeId: i % 5 === 4 ? pick(properties, i).id : orgId, revokedAt: i % 9 === 0 ? daysAgo(1) : null }; }) });
  });

  await prisma.$executeRawUnsafe('ANALYZE');
  console.info(`[seed-volume] org ${ORG.slug} (${orgId}) ready in ${((Date.now() - started) / 1000).toFixed(1)}s; personas: manager@load.bolar.test, tenant@load.bolar.test, books@load.bolar.test / ${PASSWORD}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
