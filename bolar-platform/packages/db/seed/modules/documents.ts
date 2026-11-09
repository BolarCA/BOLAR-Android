/**
 * Documents & communications demo seed (Days 26-30). Attaches real bytes to the two seeded Document
 * rows (local storage driver layout: `<STORAGE_LOCAL_ROOT>/<key>` + `<key>.meta.json`, the same format
 * LocalStorageAdapter in @bolar/integrations reads) and creates two in-app notifications for the demo
 * tenant. Idempotent. Synthetic content only.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../src/client.js';

function storageRoot(): string {
  // Mirrors createStorageAdapter(): STORAGE_LOCAL_ROOT (default `.storage`) is relative to the API process cwd, which is
  // packages/api when started with `pnpm --filter @bolar/api dev|start`. Resolve the same way so the API can read seeded bytes.
  const root = process.env.STORAGE_LOCAL_ROOT ?? '.storage';
  if (isAbsolute(root)) return root;
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../api');
  return resolve(apiDir, root);
}

async function putLocalObject(key: string, body: Buffer, contentType: string): Promise<{ sha256: string; sizeBytes: number }> {
  if ((process.env.STORAGE_DRIVER ?? 'local') !== 'local') throw new Error('seedDocumentsDemo requires STORAGE_DRIVER=local');
  const path = join(storageRoot(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  await writeFile(`${path}.meta.json`, JSON.stringify({ contentType, metadata: { seeded: 'true' } }));
  return { sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.length };
}

const LEASE_TEXT = `RESIDENTIAL LEASE AGREEMENT (DEMO)\n\nThis is a synthetic lease document used for demonstration only.\nParties: Demo Property Management and Theo Tenant.\nPremises: Maple Court Apartments, Unit 101, Austin TX.\nTerm: 12 months. Rent: $1,450.00 per month.\n\nSigned electronically by both parties.\n`;
const INSURANCE_TEXT = `CERTIFICATE OF PROPERTY INSURANCE (DEMO)\n\nInsured: Demo Property Management\nProperty: Maple Court Apartments, 100 Maple St, Austin TX 78701\nPolicy period: 2026-01-01 to 2026-12-31\nCoverage: General liability and property damage (synthetic sample).\n`;

export async function seedDocumentsDemo(orgId: string): Promise<void> {
  const manager = await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } });
  const tenant = await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: orgId, email: 'tenant@demo.bolar.test' } });

  const files: { title: string; fileName: string; body: string }[] = [
    { title: 'Residential Lease Agreement (signed)', fileName: 'residential-lease-signed.txt', body: LEASE_TEXT },
    { title: 'Property insurance certificate 2026', fileName: 'insurance-certificate-2026.txt', body: INSURANCE_TEXT },
  ];
  for (const f of files) {
    const doc = await prisma.document.findFirst({ where: { tenantOrgId: orgId, title: f.title, deletedAt: null } });
    if (!doc) continue;
    const existing = await prisma.documentVersion.findFirst({ where: { documentId: doc.id, version: 1 } });
    if (existing && doc.currentVersionId === existing.id && existing.scanStatus === 'clean') continue;
    const key = `org/${orgId}/documents/${doc.id}/v1/${f.fileName}`;
    const body = Buffer.from(f.body, 'utf8');
    const put = await putLocalObject(key, body, 'text/plain');
    const version = existing
      ? await prisma.documentVersion.update({ where: { id: existing.id }, data: { storageKey: key, fileName: f.fileName, mimeType: 'text/plain', sizeBytes: put.sizeBytes, sha256: put.sha256, scanStatus: 'clean' } })
      : await prisma.documentVersion.create({ data: { tenantOrgId: orgId, documentId: doc.id, version: 1, storageKey: key, fileName: f.fileName, mimeType: 'text/plain', sizeBytes: put.sizeBytes, sha256: put.sha256, scanStatus: 'clean', createdBy: manager.id } });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  }

  // Two in-app notifications for the demo tenant (rendered from approved platform templates at read time).
  const wo = await prisma.workOrder.findFirst({ where: { tenantOrgId: orgId, requesterId: tenant.id }, orderBy: { createdAt: 'asc' } });
  const invoice = await prisma.invoice.findFirst({ where: { tenantOrgId: orgId, status: 'open' }, orderBy: { createdAt: 'asc' } });
  const notifications: { idempotencyKey: string; templateKey: string; variables: Record<string, string> }[] = [
    { idempotencyKey: `seed:${orgId}:tenant:workorder.created`, templateKey: 'workorder.created', variables: { name: tenant.name, workOrderId: wo?.id ?? 'WO-DEMO', title: wo?.title ?? 'Kitchen sink leaking', priority: wo?.priority ?? 'high' } },
    { idempotencyKey: `seed:${orgId}:tenant:invoice.issued`, templateKey: 'invoice.issued', variables: { name: tenant.name, number: invoice?.number ?? 'INV-000001', amount: invoice ? `$${(invoice.totalCents / 100).toFixed(2)}` : '$1,450.00', dueDate: (invoice?.dueDate ?? new Date()).toISOString().slice(0, 10) } },
  ];
  for (const n of notifications) {
    await prisma.notification.upsert({
      where: { idempotencyKey: n.idempotencyKey },
      update: {},
      create: { tenantOrgId: orgId, channel: 'in_app', recipientId: tenant.id, recipientAddress: null, templateKey: n.templateKey, variables: n.variables, status: 'delivered', sentAt: new Date(), idempotencyKey: n.idempotencyKey },
    });
  }
}
