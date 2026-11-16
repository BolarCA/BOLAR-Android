/**
 * AI tool registry (Days 61-74). Every tool is read-only except the two draft tools, which only create *drafts* through
 * the owning module's service so the existing human approval chain applies (p300). Each tool runs the SAME access checks
 * as the HTTP routes (loadLease / loadCase / requireWorkOrderView / loadDocument + requireDocumentClearance) and goes
 * through tenantDb(ctx); a denial surfaces as the same AppError the route would throw and the router records it as
 * `denied`. Tools return structured facts plus sources; free text from records is returned separately as `untrusted`.
 */
import { z } from 'zod';
import type { AiDraftRefDto, AiToolName } from '@bolar/contracts';
import type { AiSource, AiToolSpec, AiUntrustedText } from '@bolar/integrations';
import { errors, type Permission, type RequestContext } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { tenantDb } from '../../shared/db.js';
import { hasPermission } from '../../shared/access.js';
import { requireAuth } from '../../shared/context.js';
import { loadLease, visibleLeaseWhere, type LeaseRow } from '../lease/service.js';
import { loadCase } from '../legal/routes.js';
import { isOpenStatus, requireWorkOrderView, visibilityWhere, workOrderNumber } from '../maintenance/service.js';
import { loadDocument, requireDocumentClearance } from '../document/service.js';
import { assertOrgKey, storage } from '../storage/adapter.js';
import { createNoticeDraft } from '../notice/service.js';

export interface AiToolRunResult {
  facts: Record<string, unknown>;
  sources: AiSource[];
  untrusted?: AiUntrustedText[];
  draft?: AiDraftRefDto;
}

export interface AiTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: AiToolName;
  description: string;
  /** Coarse permission checked before the tool runs; fine-grained checks happen inside `run` exactly as in the routes. */
  permission: Permission;
  /** `true` for every tool except the draft tools (which create drafts only; nothing is sent, approved or paid). */
  readOnly: boolean;
  input: S;
  run(ctx: RequestContext, input: z.infer<S>): Promise<AiToolRunResult>;
}

const DAY_MS = 86_400_000;
const idField = z.string().min(1).max(64);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function leaseSources(row: LeaseRow): AiSource[] {
  return [
    { type: 'lease', id: row.id, label: `Lease ${row.unit.property.name} · Unit ${row.unit.unitNumber}` },
    { type: 'property', id: row.unit.property.id, label: row.unit.property.name },
  ];
}

function leaseFacts(row: LeaseRow, now = new Date()): Record<string, unknown> {
  return {
    property: row.unit.property.name,
    unit: row.unit.unitNumber,
    status: row.status,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    daysUntilEnd: Math.ceil((row.endDate.getTime() - now.getTime()) / DAY_MS),
    monthlyRent: money(row.rentCents),
    deposit: money(row.depositCents),
    // Party names and roles only; profile identifiers (DOB, SSN, contact details) are never selected here.
    parties: row.parties.map((p) => ({ label: p.tenantProfile.displayName, role: p.role, signed: Boolean(p.signedAt) })),
    recurringCharges: row.charges.length,
    versions: row.versions.length,
  };
}

async function summarizeLease(ctx: RequestContext, input: { leaseId: string }): Promise<AiToolRunResult> {
  const row = await loadLease(ctx, input.leaseId, 'lease:read');
  return { facts: leaseFacts(row), sources: leaseSources(row) };
}

async function summarizeCase(ctx: RequestContext, input: { caseId: string }): Promise<AiToolRunResult> {
  const row = await loadCase(ctx, input.caseId, 'case:read');
  const deadlines = Array.isArray(row.deadlines) ? (row.deadlines as { label?: string; dueAt?: string }[]) : [];
  const upcoming = deadlines.filter((d) => d.dueAt && new Date(d.dueAt).getTime() >= Date.now()).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  return {
    facts: { title: row.title, kind: row.kind, status: row.status, privileged: row.privileged, deadlineCount: deadlines.length, nextDeadline: upcoming[0] ? { label: upcoming[0].label ?? 'deadline', dueAt: upcoming[0].dueAt } : null, linkedLease: Boolean(row.leaseId) },
    sources: [{ type: 'case', id: row.id, label: `Case: ${row.title}` }, ...(row.leaseId ? [{ type: 'lease', id: row.leaseId, label: 'Linked lease' }] : [])],
  };
}

async function summarizeWorkOrder(ctx: RequestContext, input: { workOrderId: string }): Promise<AiToolRunResult> {
  const wo = await tenantDb(ctx).workOrder.findFirst({ where: { id: input.workOrderId } });
  if (!wo) throw errors.notFound();
  await requireWorkOrderView(ctx, wo);
  const now = new Date();
  return {
    facts: { number: workOrderNumber(wo.id), title: wo.title, status: wo.status, priority: wo.priority, category: wo.category, slaDueAt: wo.slaDueAt?.toISOString() ?? null, overdue: Boolean(wo.slaDueAt && isOpenStatus(wo.status) && wo.slaDueAt < now), scheduledFor: wo.scheduledFor?.toISOString() ?? null, vendorAssigned: Boolean(wo.assignedVendorId), entryPermission: wo.entryPermission },
    sources: [{ type: 'work_order', id: wo.id, label: `${workOrderNumber(wo.id)} ${wo.title}` }],
    // Resident-written text is data, not instructions: the provider wraps it in untrusted delimiters.
    untrusted: [{ label: 'Work order description', text: wo.description }],
  };
}

const TEXT_MIME = /^text\/(plain|markdown)\b/;
const MAX_DOC_CHARS = 4000;

async function summarizeDocument(ctx: RequestContext, input: { documentId: string }): Promise<AiToolRunResult> {
  const { doc } = await loadDocument(ctx, input.documentId, 'document:read');
  await requireDocumentClearance(ctx, doc); // confidential/restricted without clearance -> review_required -> denied
  const versions = await tenantDb(ctx).documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: 'desc' }, take: 20 });
  const current = versions.find((v) => v.id === doc.currentVersionId) ?? versions[0] ?? null;
  const untrusted: AiUntrustedText[] = [];
  if (current && TEXT_MIME.test(current.mimeType) && current.scanStatus === 'clean') {
    assertOrgKey(ctx.tenantOrgId!, current.storageKey);
    const obj = await storage().getObject(current.storageKey);
    if (obj) untrusted.push({ label: `Document text (${current.fileName}, first ${MAX_DOC_CHARS} chars)`, text: obj.body.toString('utf8').slice(0, MAX_DOC_CHARS) });
  }
  return {
    facts: { title: doc.title, classification: doc.classification, category: doc.category, owner: `${doc.ownerType} ${doc.ownerId}`, legalHold: doc.legalHold, versionCount: versions.length, currentVersion: current ? { fileName: current.fileName, mimeType: current.mimeType, sizeBytes: current.sizeBytes, scanStatus: current.scanStatus, sha256: current.sha256 } : null, textIncluded: untrusted.length > 0 },
    sources: [{ type: 'document', id: doc.id, label: `Document: ${doc.title}` }],
    untrusted,
  };
}

const OPEN_WORK_ORDER_STATUSES = ['new', 'triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'review', 'reopened'];

async function listDueItems(ctx: RequestContext): Promise<AiToolRunResult> {
  const db = tenantDb(ctx);
  const now = new Date();
  const sources: AiSource[] = [];
  const facts: Record<string, unknown> = {};
  if (hasPermission(ctx, 'work_order:read')) {
    const rows = await db.workOrder.findMany({ where: { AND: [await visibilityWhere(ctx), { status: { in: OPEN_WORK_ORDER_STATUSES }, slaDueAt: { lt: now } }] }, orderBy: { slaDueAt: 'asc' }, take: 10 });
    facts.overdueWorkOrders = rows.map((w) => ({ label: `${workOrderNumber(w.id)} ${w.title}`, priority: w.priority, status: w.status, slaDueAt: w.slaDueAt?.toISOString() }));
    sources.push(...rows.map((w) => ({ type: 'work_order', id: w.id, label: `${workOrderNumber(w.id)} ${w.title}` })));
  }
  if (hasPermission(ctx, 'lease:read')) {
    const visible = await visibleLeaseWhere(ctx);
    const rows = await db.lease.findMany({ where: { AND: [visible, { OR: [{ status: { in: ['review', 'approved', 'sent'] } }, { status: 'active', endDate: { lte: new Date(now.getTime() + 30 * DAY_MS) } }] }] }, include: { unit: { include: { property: true } } }, orderBy: { endDate: 'asc' }, take: 10 });
    facts.leaseTasks = rows.map((l) => ({ label: `${l.unit.property.name} · Unit ${l.unit.unitNumber}`, status: l.status, task: l.status === 'active' ? `ends ${day(l.endDate)} (renewal decision due)` : `awaiting ${l.status === 'review' ? 'approval' : l.status === 'approved' ? 'sending' : 'signature'}` }));
    sources.push(...rows.map((l) => ({ type: 'lease', id: l.id, label: `Lease ${l.unit.property.name} · Unit ${l.unit.unitNumber}` })));
  }
  if (hasPermission(ctx, 'compliance:read')) {
    const rows = await db.ruleEvaluation.findMany({ where: { result: { in: ['block', 'review'] }, reviewedAt: null }, orderBy: { createdAt: 'asc' }, take: 10 });
    facts.complianceHits = rows.map((r) => ({ label: r.ruleKey, result: r.result, resource: `${r.resourceType} ${r.resourceId}`, raisedAt: r.createdAt.toISOString() }));
    sources.push(...rows.map((r) => ({ type: 'rule_evaluation', id: r.id, label: `${r.ruleKey} (${r.result})` })));
  }
  if (Object.keys(facts).length === 0) facts.note = 'Your role has no due-item categories (work orders, leases, compliance).';
  return { facts, sources };
}

async function flagAnomalies(ctx: RequestContext): Promise<AiToolRunResult> {
  const db = tenantDb(ctx);
  const now = new Date();
  const facts: Record<string, unknown> = {};
  const sources: AiSource[] = [];
  if (hasPermission(ctx, 'finance:read') && hasPermission(ctx, 'lease:read')) {
    const visible = await visibleLeaseWhere(ctx);
    const candidates = await db.invoice.findMany({ where: { status: { in: ['open', 'partially_paid', 'overdue'] }, dueDate: { lt: now } }, orderBy: { dueDate: 'asc' }, take: 50 });
    const visibleLeases = candidates.length ? await db.lease.findMany({ where: { AND: [visible, { id: { in: [...new Set(candidates.map((i) => i.leaseId))] } }] }, select: { id: true } }) : [];
    const visibleIds = new Set(visibleLeases.map((l) => l.id));
    const overdue = candidates.filter((i) => visibleIds.has(i.leaseId)).slice(0, 25);
    const notices = overdue.length ? await db.notice.findMany({ where: { kind: 'late_rent', leaseId: { in: overdue.map((i) => i.leaseId) }, status: { notIn: ['canceled', 'rejected'] } }, select: { leaseId: true } }) : [];
    const noticed = new Set(notices.map((n) => n.leaseId));
    const flagged = overdue.filter((i) => !noticed.has(i.leaseId)).slice(0, 10);
    facts.overdueInvoicesWithoutNotice = flagged.map((i) => ({ label: `Invoice ${i.number}`, dueDate: day(i.dueDate), outstanding: money(i.totalCents - i.paidCents) }));
    sources.push(...flagged.map((i) => ({ type: 'invoice', id: i.id, label: `Invoice ${i.number}` })));
  }
  if (hasPermission(ctx, 'vendor:read')) {
    const vendors = await db.vendorProfile.findMany({ where: { status: { in: ['approved', 'pending'] }, insuranceExpiresAt: { lt: now } }, take: 10 });
    facts.vendorsWithExpiredInsurance = vendors.map((v) => ({ label: v.name, expiredOn: day(v.insuranceExpiresAt), status: v.status }));
    sources.push(...vendors.map((v) => ({ type: 'vendor', id: v.id, label: v.name })));
  }
  if (hasPermission(ctx, 'lease:read')) {
    const visible = await visibleLeaseWhere(ctx);
    const ending = await db.lease.findMany({ where: { AND: [visible, { status: 'active', endDate: { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) } }] }, include: { unit: { include: { property: true } } }, take: 25 });
    const renewals = ending.length ? await db.lease.findMany({ where: { unitId: { in: ending.map((l) => l.unitId) }, status: { notIn: ['canceled', 'terminated'] }, id: { notIn: ending.map((l) => l.id) }, startDate: { gte: now } }, select: { unitId: true } }) : [];
    const renewed = new Set(renewals.map((r) => r.unitId));
    const flagged = ending.filter((l) => !renewed.has(l.unitId)).slice(0, 10);
    facts.leasesEndingWithoutRenewal = flagged.map((l) => ({ label: `${l.unit.property.name} · Unit ${l.unit.unitNumber}`, endDate: day(l.endDate) }));
    sources.push(...flagged.map((l) => ({ type: 'lease', id: l.id, label: `Lease ${l.unit.property.name} · Unit ${l.unit.unitNumber}` })));
    if (hasPermission(ctx, 'document:read')) {
      const active = await db.lease.findMany({ where: { AND: [visible, { status: 'active' }] }, include: { unit: { include: { property: true } } }, take: 50 });
      const docs = active.length ? await db.document.findMany({ where: { ownerType: 'lease', ownerId: { in: active.map((l) => l.id) }, deletedAt: null }, select: { ownerId: true } }) : [];
      const withDocs = new Set(docs.map((d) => d.ownerId));
      const missing = active.filter((l) => !withDocs.has(l.id)).slice(0, 10);
      facts.activeLeasesMissingDocuments = missing.map((l) => ({ label: `${l.unit.property.name} · Unit ${l.unit.unitNumber}`, status: l.status }));
      sources.push(...missing.map((l) => ({ type: 'lease', id: l.id, label: `Lease ${l.unit.property.name} · Unit ${l.unit.unitNumber}` })));
    }
  }
  if (Object.keys(facts).length === 0) facts.note = 'Your role has no anomaly categories available.';
  return { facts, sources };
}

const NOTICE_KINDS = ['late_rent', 'entry', 'general'] as const;

function monthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function draftNotice(ctx: RequestContext, input: { leaseId: string; kind: (typeof NOTICE_KINDS)[number]; variables?: Record<string, string | number | boolean | null> }): Promise<AiToolRunResult> {
  // Same gates as POST /notices: MFA-verified session and the notice:draft permission.
  requireAuth(ctx, 'mfa');
  if (!hasPermission(ctx, 'notice:draft')) throw errors.forbidden();
  const row = await loadLease(ctx, input.leaseId, 'lease:read');
  const recipient = row.parties.find((p) => p.role === 'primary') ?? row.parties[0];
  if (!recipient) throw errors.validation([{ path: 'leaseId', message: 'The lease has no tenant party to address the notice to' }]);
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaults: Record<(typeof NOTICE_KINDS)[number], Record<string, string | number | boolean | null>> = {
    late_rent: { amount: money(row.rentCents), period: monthLabel(now), dueDate: day(firstOfMonth), cureDate: day(new Date(now.getTime() + 5 * DAY_MS)), jurisdictionClause: `Issued under ${row.unit.property.state} law; approver to confirm the statutory cure period.` },
    entry: { entryAt: new Date(now.getTime() + 2 * DAY_MS).toISOString(), reason: 'Routine inspection' },
    general: { body: 'Draft prepared by the assistant for human review; edit before submitting.' },
  };
  const variables = { ...defaults[input.kind], ...(input.variables ?? {}) };
  const facts = input.kind === 'entry' ? { entryLeadHours: 48, emergency: false } : {};
  const notice = await createNoticeDraft(ctx, { kind: input.kind, templateKey: `notice.${input.kind}`, recipientId: recipient.tenantProfileId, leaseId: row.id, variables, facts, propertyId: row.propertyId });
  const href = `/manager/notices?focus=${notice.id}`;
  return {
    facts: { noticeId: notice.id, draftStatus: 'draft', kind: input.kind, recipient: recipient.tenantProfile.displayName, guardFlagged: notice.guard.flagged, ruleHits: notice.ruleHits.length, complianceResult: notice.result, nextStep: 'A human with notice:draft submits it; a different human with notice:approve approves before anything is sent.' },
    sources: [{ type: 'notice', id: notice.id, label: `Notice draft (${input.kind.replace('_', ' ')})` }, ...leaseSources(row)],
    draft: { type: 'notice', id: notice.id, status: notice.status, href, label: `${input.kind.replace('_', ' ')} notice for ${recipient.tenantProfile.displayName}` },
  };
}

async function draftEmail(ctx: RequestContext, input: { leaseId?: string; workOrderId?: string; purpose: string }): Promise<AiToolRunResult> {
  const sources: AiSource[] = [];
  let subject = 'Follow-up from your property management team';
  let body = `Hello,\n\n${input.purpose.trim()}\n\nPlease reply to this message or contact the office with any questions.\n\nKind regards,\nProperty management`;
  if (input.leaseId) {
    const lease = await summarizeLease(ctx, { leaseId: input.leaseId });
    sources.push(...lease.sources);
    subject = `${lease.facts.property} · Unit ${lease.facts.unit}: ${input.purpose.slice(0, 60)}`;
    body = `Hello,\n\nRegarding your lease at ${lease.facts.property}, Unit ${lease.facts.unit} (${lease.facts.startDate} to ${lease.facts.endDate}):\n\n${input.purpose.trim()}\n\nPlease reply to this message or contact the office with any questions.\n\nKind regards,\nProperty management`;
  } else if (input.workOrderId) {
    const wo = await summarizeWorkOrder(ctx, { workOrderId: input.workOrderId });
    sources.push(...wo.sources);
    subject = `${wo.facts.number}: update on "${wo.facts.title}"`;
    body = `Hello,\n\nAn update on your maintenance request ${wo.facts.number} ("${wo.facts.title}", currently ${wo.facts.status}):\n\n${input.purpose.trim()}\n\nPlease reply to this message or contact the office with any questions.\n\nKind regards,\nProperty management`;
  }
  return { facts: { subject, body, draftOnly: true, note: 'Text only. Nothing was sent; copy it into your email client or a notification template after review.' }, sources };
}

async function preparePacketOutline(ctx: RequestContext, input: { caseId: string }): Promise<AiToolRunResult> {
  const row = await loadCase(ctx, input.caseId, 'case:read');
  const db = tenantDb(ctx);
  const ownerFilter: Prisma.DocumentWhereInput[] = [{ ownerType: 'case', ownerId: row.id }];
  if (row.leaseId) ownerFilter.push({ ownerType: 'lease', ownerId: row.leaseId });
  const [documentCount, auditEventCount] = await Promise.all([
    db.document.count({ where: { deletedAt: null, OR: ownerFilter } }),
    db.auditLog.count({ where: { resourceType: 'case', resourceId: row.id } }),
  ]);
  return {
    facts: {
      caseTitle: row.title,
      sections: ['Case summary and parties', 'Lease and tenancy record', `Documents (${documentCount}) with SHA-256 hashes and source links`, `Audit manifest (${auditEventCount} case events)`, 'Open deadlines and holds'],
      documentCount,
      auditEventCount,
      exportNote: 'Outline only. The actual packet is produced by a packet-export request that a second human approves (export:approve).',
    },
    sources: [{ type: 'case', id: row.id, label: `Case: ${row.title}` }, ...(row.leaseId ? [{ type: 'lease', id: row.leaseId, label: 'Linked lease' }] : [])],
  };
}

interface Step { step: string; confidence: number; uncertainty: string }

async function recommendNextSteps(ctx: RequestContext, input: { resourceType?: string; resourceId?: string }): Promise<AiToolRunResult> {
  const steps: Step[] = [];
  let sources: AiSource[] = [];
  let basis = 'general guidance (no record in context)';
  if (input.resourceType === 'lease' && input.resourceId) {
    const row = await loadLease(ctx, input.resourceId, 'lease:read');
    sources = leaseSources(row);
    basis = `lease status ${row.status}`;
    const daysToEnd = Math.ceil((row.endDate.getTime() - Date.now()) / DAY_MS);
    if (row.status === 'draft') steps.push({ step: 'Complete the draft and submit it for review', confidence: 0.85, uncertainty: 'Assumes all parties and charges are already entered.' });
    if (row.status === 'review') steps.push({ step: 'Ask the approving landlord/admin to review; resolve any blocking compliance hits first', confidence: 0.8, uncertainty: 'Compliance queue state was not re-checked here.' });
    if (row.status === 'approved' || row.status === 'sent') steps.push({ step: 'Send or chase the e-signature envelope', confidence: 0.75, uncertainty: 'Signature provider status is not included in this summary.' });
    if (row.status === 'active' && daysToEnd <= 60) steps.push({ step: `Start the renewal or move-out conversation (lease ends in ${daysToEnd} days)`, confidence: 0.7, uncertainty: 'Depends on owner strategy and local notice requirements.' });
    if (row.parties.some((p) => !p.signedAt) && ['sent', 'signed', 'active'].includes(row.status)) steps.push({ step: 'Confirm every party has signed', confidence: 0.6, uncertainty: 'Signature timestamps may lag the provider webhook.' });
  } else if (input.resourceType === 'work_order' && input.resourceId) {
    const wo = await tenantDb(ctx).workOrder.findFirst({ where: { id: input.resourceId } });
    if (!wo) throw errors.notFound();
    await requireWorkOrderView(ctx, wo);
    sources = [{ type: 'work_order', id: wo.id, label: `${workOrderNumber(wo.id)} ${wo.title}` }];
    basis = `work order status ${wo.status}`;
    if (wo.slaDueAt && wo.slaDueAt < new Date() && isOpenStatus(wo.status)) steps.push({ step: 'Escalate: the SLA is breached', confidence: 0.9, uncertainty: 'Escalation path depends on the property on-call roster.' });
    if (['new', 'triaged'].includes(wo.status)) steps.push({ step: 'Triage and assign an eligible vendor', confidence: 0.8, uncertainty: 'Vendor eligibility (trade, insurance, coverage) must be confirmed on assignment.' });
    if (wo.status === 'assigned') steps.push({ step: 'Schedule the visit with the resident (entry permission required)', confidence: 0.75, uncertainty: 'Resident availability windows may have changed.' });
    if (wo.status === 'blocked') steps.push({ step: 'Resolve the blocker noted in the timeline and resume work', confidence: 0.7, uncertainty: 'The blocking reason is in free text, not read here.' });
    if (wo.status === 'review') steps.push({ step: 'Verify completion and close the order', confidence: 0.8, uncertainty: 'Photos and resident confirmation were not checked.' });
  } else if (input.resourceType === 'case' && input.resourceId) {
    const row = await loadCase(ctx, input.resourceId, 'case:read');
    sources = [{ type: 'case', id: row.id, label: `Case: ${row.title}` }];
    basis = `case status ${row.status}`;
    steps.push({ step: 'Confirm deadlines and calendar the next one', confidence: 0.7, uncertainty: 'Deadlines are entered manually by counsel.' });
    steps.push({ step: 'Check whether a legal hold is needed on related documents', confidence: 0.65, uncertainty: 'Depends on litigation likelihood; counsel decides.' });
  }
  if (steps.length === 0) steps.push({ step: 'Review the record in its workspace and decide with your team; no automatic action is recommended', confidence: 0.4, uncertainty: 'Not enough record context for a specific recommendation.' });
  return { facts: { basis, steps, disclaimer: 'Recommendations are advisory; a human decides and acts.' }, sources };
}

const summarizeLeaseInput = z.object({ leaseId: idField.describe('Lease id') });
const summarizeCaseInput = z.object({ caseId: idField.describe('Case id') });
const summarizeWorkOrderInput = z.object({ workOrderId: idField.describe('Work order id') });
const summarizeDocumentInput = z.object({ documentId: idField.describe('Document id') });
const emptyInput = z.object({});
const draftNoticeInput = z.object({ leaseId: idField.describe('Lease the notice is about'), kind: z.enum(NOTICE_KINDS).describe('late_rent | entry | general'), variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Template variables to override') });
const draftEmailInput = z.object({ leaseId: idField.optional(), workOrderId: idField.optional(), purpose: z.string().min(1).max(500).describe('What the email should say') });
const packetInput = z.object({ caseId: idField.describe('Case id') });
const recommendInput = z.object({ resourceType: z.enum(['lease', 'work_order', 'case']).optional(), resourceId: idField.optional() });

function tool<S extends z.ZodTypeAny>(def: AiTool<S>): AiTool {
  return def as unknown as AiTool;
}

export const AI_TOOL_REGISTRY: Record<AiToolName, AiTool> = {
  summarize_lease: tool({ name: 'summarize_lease', description: 'Summarise a lease: property, unit, status, dates, rent, deposit, parties (names and roles only).', permission: 'lease:read', readOnly: true, input: summarizeLeaseInput, run: summarizeLease }),
  summarize_case: tool({ name: 'summarize_case', description: 'Summarise a legal case the actor may access (privileged cases need representation).', permission: 'case:read', readOnly: true, input: summarizeCaseInput, run: summarizeCase }),
  summarize_work_order: tool({ name: 'summarize_work_order', description: 'Summarise a maintenance work order: status, priority, SLA, schedule, plus the resident description as quoted data.', permission: 'work_order:read', readOnly: true, input: summarizeWorkOrderInput, run: summarizeWorkOrder }),
  summarize_document: tool({ name: 'summarize_document', description: 'Summarise a document: metadata, current version and, for plain-text or markdown files, the first part of the text. Classified documents require clearance.', permission: 'document:read', readOnly: true, input: summarizeDocumentInput, run: summarizeDocument }),
  list_due_items: tool({ name: 'list_due_items', description: 'List items due for the actor: overdue work orders (SLA breaches), lease tasks (approvals, signatures, renewals within 30 days) and unresolved compliance hits.', permission: 'ai:use', readOnly: true, input: emptyInput, run: listDueItems }),
  flag_anomalies: tool({ name: 'flag_anomalies', description: 'Flag anomalies in the actor scope: overdue invoices without a late-rent notice, vendors with expired insurance, active leases ending within 60 days without a renewal, active leases with no documents.', permission: 'ai:use', readOnly: true, input: emptyInput, run: flagAnomalies }),
  draft_notice: tool({ name: 'draft_notice', description: 'Create a notice DRAFT (late_rent, entry or general) for the lease\'s primary tenant through the notice module. Never sends; a human must submit and a different human must approve.', permission: 'notice:draft', readOnly: false, input: draftNoticeInput, run: draftNotice }),
  draft_email: tool({ name: 'draft_email', description: 'Draft email text (subject and body) about a lease or work order. Returns text only; nothing is sent.', permission: 'ai:use', readOnly: false, input: draftEmailInput, run: draftEmail }),
  prepare_packet_outline: tool({ name: 'prepare_packet_outline', description: 'Outline an evidence packet for a case: sections, document count and audit event count. The export itself goes through the approved packet-export flow.', permission: 'case:read', readOnly: true, input: packetInput, run: preparePacketOutline }),
  recommend_next_steps: tool({ name: 'recommend_next_steps', description: 'Recommend next steps for a lease, work order or case with a confidence score (0-1) and explicit uncertainty for each step.', permission: 'ai:use', readOnly: true, input: recommendInput, run: recommendNextSteps }),
};

export function getTool(name: string): AiTool | null {
  return Object.prototype.hasOwnProperty.call(AI_TOOL_REGISTRY, name) ? AI_TOOL_REGISTRY[name as AiToolName] : null;
}

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** Provider-facing specs for the whole registry (the provider sees every registered tool; execution is permission-gated). */
export function toolSpecs(): AiToolSpec[] {
  return Object.values(AI_TOOL_REGISTRY).map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t.input) }));
}
