/**
 * Reporting demo seed (Days 75-90). Adds one scheduled report definition (monthly rent roll CSV owned by the demo
 * bookkeeper) with a completed run, then refreshes the reporting materialized views so dashboards show the demo data
 * immediately. Idempotent; synthetic data only. Wired by the integrator after the other module seeds:
 *   import { seedReportingDemo } from './modules/reporting.js';  await seedReportingDemo(org.id);
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../src/client.js';

const DEFINITION_NAME = 'Monthly rent roll (CSV)';
const CSV_COLUMNS = ['leaseId', 'propertyName', 'unitNumber', 'tenantName', 'status', 'startDate', 'endDate', 'rentCents', 'depositCents', 'targetRentCents', 'propertyId', 'unitId', 'tenantProfileId'] as const;

/** Refresh every rpt_* materialized view (same function the API and workers call). */
export async function refreshReportingViews(): Promise<void> {
  await prisma.$executeRawUnsafe('SELECT rpt_refresh_all()');
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function seedReportingDemo(orgId: string): Promise<void> {
  const books = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'books@demo.bolar.test' }, select: { id: true, email: true } });
  if (!books) {
    console.warn('[seed:reporting] demo bookkeeper missing; run the base seed first');
    return;
  }
  const definition =
    (await prisma.reportDefinition.findFirst({ where: { tenantOrgId: orgId, name: DEFINITION_NAME } })) ??
    (await prisma.reportDefinition.create({ data: { tenantOrgId: orgId, name: DEFINITION_NAME, kind: 'rent_roll', filtersJson: {}, scheduleCron: '0 6 1 * *', recipients: [books.email], format: 'csv', createdBy: books.id } }));

  const hasRun = await prisma.reportRun.findFirst({ where: { tenantOrgId: orgId, definitionId: definition.id, status: 'complete' }, select: { id: true } });
  if (!hasRun) {
    // Build the same CSV the API export produces from the rent roll (active leases), so the download works in dev.
    const leases = await prisma.lease.findMany({ where: { tenantOrgId: orgId, status: 'active' }, include: { unit: { include: { property: true } }, parties: { include: { tenantProfile: true }, orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
    const rows = leases.map((l) => {
      const primary = l.parties.find((p) => p.role === 'primary') ?? l.parties[0];
      return { leaseId: l.id, propertyName: l.unit.property.name, unitNumber: l.unit.unitNumber, tenantName: primary?.tenantProfile.displayName ?? null, status: l.status, startDate: l.startDate, endDate: l.endDate, rentCents: l.rentCents, depositCents: l.depositCents, targetRentCents: l.unit.targetRentCents, propertyId: l.propertyId, unitId: l.unitId, tenantProfileId: primary?.tenantProfileId ?? null };
    });
    const body = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c])).join(','))].join('\r\n') + '\r\n';
    const run = await prisma.reportRun.create({ data: { tenantOrgId: orgId, definitionId: definition.id, status: 'running', format: 'csv', trigger: 'seed', requestedBy: books.id, startedAt: new Date(Date.now() - 60_000) } });
    const storageKey = `org/${orgId}/reports/${run.id}.csv`;
    let stored = false;
    if ((process.env.STORAGE_DRIVER ?? 'local') === 'local') {
      // Mirror the local storage adapter layout (STORAGE_LOCAL_ROOT/<key> + <key>.meta.json) so the signed download resolves.
      // A relative root is resolved against packages/api, the cwd of the API process that serves /storage/object.
      const root = process.env.STORAGE_LOCAL_ROOT ?? '.storage';
      const path = isAbsolute(root) ? join(root, storageKey) : join(fileURLToPath(new URL('../../../api/', import.meta.url)), root, storageKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}.meta.json`, JSON.stringify({ contentType: 'text/csv', metadata: { reportRunId: run.id, tenantOrgId: orgId, kind: 'rent_roll', source: 'seed' } }));
      stored = true;
    }
    await prisma.reportRun.update({ where: { id: run.id }, data: { status: 'complete', rowCount: rows.length, storageKey: stored ? storageKey : null, sha256: createHash('sha256').update(body).digest('hex'), completedAt: new Date() } });
    await prisma.reportDefinition.update({ where: { id: definition.id }, data: { lastRunAt: new Date() } });
    await prisma.auditLog.create({ data: { tenantOrgId: orgId, actorId: books.id, action: 'report.export', resourceType: 'report_run', resourceId: run.id, requestId: `seed_report_${run.id}`, metadata: { definitionId: definition.id, kind: 'rent_roll', format: 'csv', rowCount: rows.length, storageKey: stored ? storageKey : null, trigger: 'seed' } } });
  }

  await refreshReportingViews();
  console.info(`[seed:reporting] org ${orgId}: definition "${DEFINITION_NAME}" ready, views refreshed`);
}
