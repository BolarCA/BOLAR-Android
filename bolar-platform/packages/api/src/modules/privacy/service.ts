import { createHash } from 'node:crypto';
import { createIdentityVerificationProvider, type IdentityVerificationProvider } from '@bolar/integrations';
import { AppError, errors, type RequestContext } from '@bolar/shared';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { config } from '../../config.js';
import { isHeld } from '../legal-hold/service.js';
import { effectivePolicies } from '../retention/service.js';

/** One provider instance per process: the mock keeps verification results in memory between start and callback. */
let idv: IdentityVerificationProvider | null = null;
export function identityProvider(): IdentityVerificationProvider {
  idv ??= createIdentityVerificationProvider();
  return idv;
}

// ---- Public intake rate limit (simple in-memory per-IP window) ----
const WINDOW_MS = 15 * 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();
export function checkIntakeRate(ip: string | null, now = Date.now()): void {
  const key = ip ?? 'unknown';
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) throw new AppError('rate_limited', 'Too many privacy requests from this address; try again later', 429);
  list.push(now);
  hits.set(key, list);
}
export function resetIntakeRateForTests(): void { hits.clear(); }

export const SLA_DAYS: Record<string, number> = { access: 30, correction: 30, portability: 30, deletion: 45 };

export interface DiscoveryResult {
  subjects: { userIds: string[]; tenantProfileIds: string[] };
  ids: { leaseIds: string[]; documentIds: string[]; notificationIds: string[] };
  counts: Record<string, number>;
  discoveredAt: string;
}

/** Find everything held about the subject (email) inside this org only. */
export async function discoverSubject(tenantOrgId: string, email: string): Promise<DiscoveryResult> {
  const users = await prisma.userProfile.findMany({ where: { tenantOrgId, email }, select: { id: true } });
  const profiles = await prisma.tenantProfile.findMany({ where: { tenantOrgId, OR: [{ email }, ...(users.length ? [{ userId: { in: users.map((u) => u.id) } }] : [])] }, select: { id: true } });
  const tenantProfileIds = profiles.map((p) => p.id);
  const userIds = users.map((u) => u.id);
  const parties = tenantProfileIds.length ? await prisma.leaseParty.findMany({ where: { tenantOrgId, tenantProfileId: { in: tenantProfileIds } }, select: { leaseId: true } }) : [];
  const leaseIds = [...new Set(parties.map((p) => p.leaseId))];
  const notifications = await prisma.notification.findMany({ where: { tenantOrgId, OR: [{ recipientAddress: email }, ...(userIds.length ? [{ recipientId: { in: userIds } }] : [])] }, select: { id: true } });
  const documents = tenantProfileIds.length ? await prisma.document.findMany({ where: { tenantOrgId, ownerType: 'tenant_profile', ownerId: { in: tenantProfileIds }, deletedAt: null }, select: { id: true } }) : [];
  const auditCount = userIds.length ? await prisma.auditLog.count({ where: { tenantOrgId, actorId: { in: userIds } } }) : 0;
  const contactCount = tenantProfileIds.length ? await prisma.contactMethod.count({ where: { tenantOrgId, tenantProfileId: { in: tenantProfileIds } } }) : 0;
  const emergencyCount = tenantProfileIds.length ? await prisma.emergencyContact.count({ where: { tenantOrgId, tenantProfileId: { in: tenantProfileIds } } }) : 0;
  return {
    subjects: { userIds, tenantProfileIds },
    ids: { leaseIds, documentIds: documents.map((d) => d.id), notificationIds: notifications.map((n) => n.id) },
    counts: { userProfiles: userIds.length, tenantProfiles: tenantProfileIds.length, leaseParties: parties.length, leases: leaseIds.length, notifications: notifications.length, documents: documents.length, auditLogs: auditCount, contactMethods: contactCount, emergencyContacts: emergencyCount },
    discoveredAt: new Date().toISOString(),
  };
}

export interface PrivacyException { type: string; resourceType?: string; ids?: string[]; policyKey?: string; holdIds?: string[]; processors?: { name: string; mode: string }[]; note: string }

/** Exceptions that limit or block deletion: legal holds, retention duties, audit immutability, third-party processors. */
export async function reviewExceptions(tenantOrgId: string, kind: string, discovery: DiscoveryResult): Promise<PrivacyException[]> {
  const out: PrivacyException[] = [];
  const heldBy = async (type: string, ids: string[]) => {
    const held: string[] = []; const holdIds = new Set<string>();
    for (const id of ids) { const c = await isHeld(tenantOrgId, type, id); if (c.held) { held.push(id); c.holdIds.forEach((h) => holdIds.add(h)); } }
    if (held.length) out.push({ type: 'legal_hold', resourceType: type, ids: held, holdIds: [...holdIds], note: `${held.length} ${type} record(s) are under an active legal hold and cannot be deleted or altered.` });
  };
  await heldBy('tenant_profile', discovery.subjects.tenantProfileIds);
  await heldBy('lease', discovery.ids.leaseIds);
  await heldBy('document', discovery.ids.documentIds);
  await heldBy('user', discovery.subjects.userIds);
  const policies = await effectivePolicies(tenantOrgId);
  const leasePolicy = policies.find((p) => p.resourceType === 'lease');
  if (discovery.ids.leaseIds.length && leasePolicy) {
    out.push({ type: 'retention', resourceType: 'lease', ids: discovery.ids.leaseIds, policyKey: leasePolicy.key, note: `Lease records are retained ${Math.round(leasePolicy.retainDays / 365)} years under policy ${leasePolicy.key}; the subject's identity on the lease is anonymized rather than deleted.` });
  }
  const docPolicy = policies.find((p) => p.resourceType === 'document');
  if (kind === 'deletion' && discovery.ids.documentIds.length && docPolicy && docPolicy.disposition !== 'delete') {
    out.push({ type: 'retention', resourceType: 'document', ids: discovery.ids.documentIds, policyKey: docPolicy.key, note: `Documents fall under policy ${docPolicy.key} (${docPolicy.disposition}); deletion is a soft delete pending disposition review.` });
  }
  out.push({ type: 'audit_log', note: `${discovery.counts.auditLogs ?? 0} audit events reference the subject. Audit logs are append-only and are never deleted; actor identifiers are retained.` });
  const cfg = config();
  const processors = [
    { name: 'stripe', mode: cfg.STRIPE_MODE }, { name: 'plaid', mode: cfg.PLAID_MODE }, { name: 'sendgrid', mode: cfg.SENDGRID_MODE }, { name: 'twilio', mode: cfg.TWILIO_MODE },
    { name: 'docusign', mode: cfg.DOCUSIGN_MODE }, { name: 'transunion', mode: cfg.TRANSUNION_MODE }, { name: 'idme', mode: cfg.IDME_MODE },
  ];
  out.push({ type: 'third_party', processors, note: processors.some((p) => p.mode !== 'mock') ? 'Third-party processors hold copies; forward the deletion request to each live processor.' : 'All processors run in mock mode; no third-party copies exist in this environment.' });
  return out;
}

function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`);
}

/** Render the approved `privacy.confirmation` template (org override first, then platform). */
export async function renderConfirmation(tenantOrgId: string, vars: Record<string, string>): Promise<string> {
  const templates = await prisma.template.findMany({ where: { key: 'privacy.confirmation', OR: [{ tenantOrgId }, { tenantOrgId: null }] } });
  const tpl = templates.find((t) => t.tenantOrgId === tenantOrgId) ?? templates.find((t) => t.tenantOrgId === null);
  const version = tpl ? await prisma.templateVersion.findFirst({ where: { templateId: tpl.id, status: 'approved' }, orderBy: { version: 'desc' } }) : null;
  const body = version?.body ?? 'We received your {{kind}} request on {{receivedAt}}. Reference {{requestId}}. We will respond by {{dueAt}}.';
  const subject = version?.subject ? `${render(version.subject, vars)}\n\n` : '';
  return `${subject}${render(body, vars)}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Execute an approved request. Deletion anonymizes; access/portability builds an export manifest. Audit is never touched. */
export async function fulfill(ctx: RequestContext, requestId: string) {
  const tenantOrgId = ctx.tenantOrgId!;
  const req = await prisma.privacyRequest.findFirst({ where: { id: requestId, tenantOrgId } });
  if (!req) throw errors.notFound();
  if (req.status !== 'approved') throw errors.invalidTransition(req.status, 'fulfilled');
  const discovery = (req.discoveryJson as unknown as Partial<DiscoveryResult>) ?? {};
  const subjects = discovery.subjects ?? { userIds: [], tenantProfileIds: [] };
  const ids = discovery.ids ?? { leaseIds: [], documentIds: [], notificationIds: [] };
  const actions: Record<string, unknown> = {};
  if (req.kind === 'deletion') {
    const anonymized: string[] = []; const skippedHeld: string[] = [];
    for (const pid of subjects.tenantProfileIds) {
      const c = await isHeld(tenantOrgId, 'tenant_profile', pid);
      if (c.held) { skippedHeld.push(pid); continue; }
      await prisma.tenantProfile.update({ where: { id: pid }, data: { displayName: 'Deleted subject', email: null, phone: null, ssnLast4: null, dateOfBirth: null, notes: null, status: 'former' } });
      await prisma.contactMethod.deleteMany({ where: { tenantOrgId, tenantProfileId: pid } });
      await prisma.emergencyContact.deleteMany({ where: { tenantOrgId, tenantProfileId: pid } });
      anonymized.push(pid);
    }
    const softDeleted: string[] = []; const heldDocs: string[] = [];
    for (const did of ids.documentIds) {
      const c = await isHeld(tenantOrgId, 'document', did);
      if (c.held) { heldDocs.push(did); continue; }
      await prisma.document.updateMany({ where: { id: did, tenantOrgId, deletedAt: null }, data: { deletedAt: new Date() } });
      softDeleted.push(did);
    }
    const notifications = ids.notificationIds.length ? await prisma.notification.updateMany({ where: { tenantOrgId, id: { in: ids.notificationIds } }, data: { recipientAddress: null, variables: {} } }) : { count: 0 };
    Object.assign(actions, { anonymizedTenantProfiles: anonymized, skippedHeldTenantProfiles: skippedHeld, softDeletedDocuments: softDeleted, heldDocuments: heldDocs, notificationsScrubbed: notifications.count, auditLogs: 'retained (append-only)' });
  } else {
    const profiles = subjects.tenantProfileIds.length ? await prisma.tenantProfile.findMany({ where: { tenantOrgId, id: { in: subjects.tenantProfileIds } }, select: { id: true, displayName: true, email: true, phone: true, status: true, kind: true, createdAt: true } }) : [];
    const leases = ids.leaseIds.length ? await prisma.lease.findMany({ where: { tenantOrgId, id: { in: ids.leaseIds } }, select: { id: true, status: true, startDate: true, endDate: true, rentCents: true, depositCents: true } }) : [];
    const documents = ids.documentIds.length ? await prisma.document.findMany({ where: { tenantOrgId, id: { in: ids.documentIds } }, select: { id: true, title: true, category: true, classification: true, createdAt: true } }) : [];
    Object.assign(actions, { subjects: profiles, leases, documents, notificationCount: ids.notificationIds.length, auditEventCount: discovery.counts?.auditLogs ?? 0 });
  }
  const manifest = { generatedAt: new Date().toISOString(), requestId: req.id, kind: req.kind, decision: req.decision, exceptions: req.exceptionsJson, actions };
  const manifestJson = { ...manifest, sha256: sha256(manifest) };
  const confirmationDraft = await renderConfirmation(tenantOrgId, { requestId: req.id, kind: req.kind, receivedAt: req.createdAt.toISOString().slice(0, 10), dueAt: req.dueAt.toISOString().slice(0, 10) });
  const updated = await prisma.privacyRequest.update({ where: { id: req.id }, data: { status: 'fulfilled', manifestJson: manifestJson as object, confirmationDraft } });
  await audit(ctx, { action: 'privacy_request.fulfilled', resourceType: 'privacy_request', resourceId: req.id, before: { status: 'approved' }, after: { status: 'fulfilled', manifestSha256: manifestJson.sha256, actions: Object.keys(actions) } });
  return updated;
}
