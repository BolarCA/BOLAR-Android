import { Router } from 'express';
import { idParams, signatureEnvelope, signatureEnvelopeList, createEnvelope, voidEnvelope, type EnvelopeRecipientDto, type SignatureEnvelopeDto } from '@bolar/contracts';
import { errors, systemContext, type RequestContext } from '@bolar/shared';
import { createSignatureProvider, type WebhookEvent } from '@bolar/integrations';
import type { Prisma } from '@bolar/db';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { logger } from '../../logger.js';
import { registerWebhookProvider, onWebhook } from '../integrations/routes.js';
import { LEASE_INCLUDE, loadLease, transitionLease, type LeaseRow } from '../lease/service.js';

/** Single provider instance for the process (mock unless DOCUSIGN_MODE says otherwise). Exported for tests. */
export const signatureProvider = createSignatureProvider();
const PROVIDER = signatureProvider.name;
const OPEN_STATUSES = ['created', 'sent', 'delivered'];

type EnvelopeRow = Prisma.SignatureEnvelopeGetPayload<object>;

function serializeEnvelope(row: EnvelopeRow): SignatureEnvelopeDto {
  const { tenantOrgId: _t, ...rest } = row;
  return { ...(toDto(rest) as unknown as Omit<SignatureEnvelopeDto, 'recipients' | 'status'>), status: row.status as SignatureEnvelopeDto['status'], recipients: (row.recipients as EnvelopeRecipientDto[] | null) ?? [] };
}

/** Minimal single-page PDF (placeholder when no signed document version is stored yet). */
export function placeholderPdfBase64(lines: string[]): string {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = ['BT', '/F1 12 Tf', '50 760 Td', '14 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'utf8')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8').toString('base64');
}

async function recipientsFor(ctx: RequestContext, row: LeaseRow): Promise<EnvelopeRecipientDto[]> {
  const out: EnvelopeRecipientDto[] = [];
  for (const p of row.parties) {
    let email = p.tenantProfile.email;
    if (!email) {
      const c = await tenantDb(ctx).contactMethod.findFirst({ where: { tenantProfileId: p.tenantProfileId, kind: 'email' }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] });
      email = c?.value ?? null;
    }
    if (email) out.push({ name: p.tenantProfile.displayName, email, role: p.role, tenantProfileId: p.tenantProfileId });
  }
  return out;
}

export const signatureRoutes = [
  defineRoute({ method: 'get', path: '/leases/:id/envelopes', operationId: 'listLeaseEnvelopes', summary: 'E-sign envelopes for a lease', tags: ['signature'], auth: 'session', permission: 'lease:read',
    request: { params: idParams }, responses: { 200: signatureEnvelopeList },
    handler: async ({ params, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:read');
      const items = await tenantDb(ctx).signatureEnvelope.findMany({ where: { leaseId: row.id }, orderBy: { createdAt: 'desc' }, take: 50 });
      return { body: { items: items.map(serializeEnvelope) } };
    } }),

  defineRoute({ method: 'post', path: '/leases/:id/envelopes', operationId: 'createLeaseEnvelope', summary: 'Send the current lease version for e-signature (moves an approved lease to sent)', tags: ['signature'], auth: 'mfa', permission: 'lease:send',
    request: { params: idParams, body: createEnvelope }, responses: { 201: signatureEnvelope },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:send');
      if (row.status !== 'approved' && row.status !== 'sent') throw errors.conflict(`Lease is ${row.status}; only approved leases can be sent for signature`);
      const version = row.versions.find((v) => v.id === row.currentVersionId);
      if (!version) throw errors.conflict('A lease version (terms) is required before sending');
      const db = tenantDb(ctx);
      const open = await db.signatureEnvelope.findFirst({ where: { leaseId: row.id, status: { in: OPEN_STATUSES } }, select: { id: true } });
      if (open) throw errors.conflict('An envelope is already out for signature; void it before sending a new one');

      let documentVersionId: string | null = body.documentVersionId ?? null;
      if (documentVersionId) {
        const dv = await db.documentVersion.findFirst({ where: { id: documentVersionId }, select: { id: true } });
        if (!dv) throw errors.validation([{ path: 'body.documentVersionId', message: 'Unknown document version' }]);
      } else if (version.documentId) {
        const doc = await db.document.findFirst({ where: { id: version.documentId, deletedAt: null }, select: { currentVersionId: true } });
        documentVersionId = doc?.currentVersionId ?? null;
      }
      const recipients = await recipientsFor(ctx, row);
      if (!recipients.length) throw errors.validation([{ path: 'body', message: 'At least one party needs an email address to receive the envelope' }]);

      const terms = version.termsJson as Record<string, unknown>;
      const documentName = `Lease ${row.unit.property.name} ${row.unit.unitNumber} v${version.version}.pdf`;
      const documentBase64 = placeholderPdfBase64([
        `Residential lease - ${row.unit.property.name}, unit ${row.unit.unitNumber}`,
        `Term: ${row.startDate.toISOString().slice(0, 10)} to ${row.endDate.toISOString().slice(0, 10)}`,
        `Rent: $${(row.rentCents / 100).toFixed(2)} per month; deposit $${(row.depositCents / 100).toFixed(2)}`,
        `Version ${version.version}${documentVersionId ? ` (document version ${documentVersionId})` : ' (placeholder - generated for signature)'}`,
        ...Object.entries(terms).slice(0, 20).map(([k, v]) => `${k}: ${String(v)}`),
        ...recipients.map((r) => `Signer: ${r.name} (${r.role})`),
      ]);
      const result = await signatureProvider.execute(
        { documentName, documentBase64, recipients: recipients.map(({ name, email, role }) => ({ name, email, role })), metadata: { leaseId: row.id, leaseVersionId: version.id, tenantOrgId: ctx.tenantOrgId! } },
        { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor!.userId, idempotencyKey: `${row.id}:${version.id}:${Date.now()}` },
      );
      const env = await db.signatureEnvelope.create({ data: { tenantOrgId: ctx.tenantOrgId!, provider: PROVIDER, externalId: result.externalId, leaseId: row.id, leaseVersionId: version.id, documentVersionId, status: result.status, recipients: recipients as unknown as Prisma.InputJsonValue } });
      await audit(ctx, { action: 'signature.envelope.create', resourceType: 'lease', resourceId: row.id, after: { envelopeId: env.id, provider: PROVIDER, mode: signatureProvider.mode, leaseVersionId: version.id, documentVersionId, recipientCount: recipients.length } });
      await publish(ctx, 'signature.envelope.sent', { envelopeId: env.id, leaseId: row.id, provider: PROVIDER });
      if (row.status === 'approved') await transitionLease(ctx, row, 'sent');
      return { status: 201, body: serializeEnvelope(env) };
    } }),

  defineRoute({ method: 'post', path: '/envelopes/:id/void', operationId: 'voidEnvelope', summary: 'Void an envelope; a sent lease reopens as draft with the reason noted', tags: ['signature'], auth: 'mfa', permission: 'lease:send',
    request: { params: idParams, body: voidEnvelope }, responses: { 200: signatureEnvelope },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const env = await db.signatureEnvelope.findFirst({ where: { id: params.id } });
      if (!env) throw errors.notFound();
      const row = await loadLease(ctx, env.leaseId, 'lease:send');
      if (!OPEN_STATUSES.includes(env.status)) throw errors.conflict(`Envelope is already ${env.status}`);
      if (env.externalId) await signatureProvider.void(env.externalId, body.reason, { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor!.userId });
      const updated = await db.signatureEnvelope.update({ where: { id: env.id }, data: { status: 'voided', lastEventId: `void:${ctx.requestId}` } });
      await audit(ctx, { action: 'signature.envelope.void', resourceType: 'lease', resourceId: row.id, before: { envelopeId: env.id, status: env.status }, after: { status: 'voided', reason: body.reason } });
      if (row.status === 'sent') await transitionLease(ctx, row, 'draft', { note: `E-sign envelope voided: ${body.reason}`, system: true });
      return { status: 200, body: serializeEnvelope(updated) };
    } }),
];

// ---- DocuSign webhook (Day 57): verified by the provider, persisted once by (provider, externalId), then applied idempotently ----
type DocuSignPayload = { envelopeId?: string; envelopeSummary?: { status?: string } };
const EVENT_STATUS: Record<string, string> = { 'envelope-sent': 'sent', 'envelope-delivered': 'delivered', 'envelope-completed': 'completed', 'envelope-declined': 'declined', 'envelope-voided': 'voided' };

export async function handleSignatureWebhook(event: WebhookEvent): Promise<'processed' | 'ignored'> {
  const payload = (event.payload ?? {}) as DocuSignPayload;
  const status = EVENT_STATUS[event.type];
  if (!payload.envelopeId || !status) return 'ignored';
  const env = await prisma.signatureEnvelope.findUnique({ where: { provider_externalId: { provider: PROVIDER, externalId: payload.envelopeId } } });
  if (!env) { logger.warn({ envelopeId: payload.envelopeId, type: event.type }, 'webhook for unknown envelope'); return 'ignored'; }
  const ctx = systemContext(env.tenantOrgId, `wh_${event.externalId}`.slice(0, 128));
  const db = tenantDb(ctx);
  // Terminal statuses never regress (late or replayed events).
  const terminal = ['completed', 'declined', 'voided'].includes(env.status);
  if (!terminal || status === env.status) await db.signatureEnvelope.update({ where: { id: env.id }, data: { ...(terminal ? {} : { status }), lastEventId: event.externalId } });
  await audit(ctx, { action: 'signature.webhook', resourceType: 'lease', resourceId: env.leaseId, metadata: { envelopeId: env.id, event: event.type, provider: PROVIDER } });

  const lease = await db.lease.findFirst({ where: { id: env.leaseId }, include: LEASE_INCLUDE });
  if (!lease) return 'processed';
  if (status === 'completed') {
    if (lease.status === 'sent') await transitionLease(ctx, lease, 'signed', { system: true, envelopeCompleted: true });
    else logger.info({ leaseId: lease.id, status: lease.status }, 'envelope completed; lease already past sent (idempotent skip)');
  } else if ((status === 'declined' || status === 'voided') && lease.status === 'sent') {
    await transitionLease(ctx, lease, 'draft', { system: true, note: `E-sign envelope ${status} (${event.type})` });
  }
  return 'processed';
}

registerWebhookProvider(PROVIDER, (headers, body) => signatureProvider.verifyWebhook(headers, body));
onWebhook(PROVIDER, handleSignatureWebhook);

export const signatureRouter: Router = Router();
mount(signatureRouter, signatureRoutes);
