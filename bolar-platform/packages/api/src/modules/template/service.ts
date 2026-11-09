import { errors, StateMachine, type RequestContext } from '@bolar/shared';
import type { Template, TemplateVersion } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { toDto } from '../../shared/route.js';
import { renderVersion, type TemplateVariables, type Rendered } from './render.js';

export type VersionStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'retired';

/**
 * Approval workflow (Day 29, blueprint p300 human approval gates). Low-risk templates auto-approve on
 * submit; high-risk (notices, FCRA, privacy) require `template:approve` from someone other than the author.
 */
export const templateMachine = new StateMachine<VersionStatus, 'author' | 'approver'>([
  { from: 'draft', to: 'pending_approval', allowed: (r) => r.includes('author') || r.includes('approver') },
  { from: 'pending_approval', to: 'approved', allowed: (r) => r.includes('approver') },
  { from: 'pending_approval', to: 'rejected', allowed: (r) => r.includes('approver') },
  { from: 'approved', to: 'retired', allowed: () => true },
]);

/** Templates are readable across the org plus platform defaults (tenantOrgId null), so the root client is used with an explicit scope filter. */
export function scopeFilter(tenantOrgId: string) {
  return { OR: [{ tenantOrgId }, { tenantOrgId: null }] };
}

export function templateDto(t: Template & { versions?: TemplateVersion[] }) {
  const { versions, ...rest } = t;
  const latest = versions?.slice().sort((a, b) => b.version - a.version)[0];
  return { ...toDto(rest), scope: t.tenantOrgId ? ('org' as const) : ('platform' as const), latestStatus: (latest?.status as VersionStatus | undefined) ?? null };
}

export function versionDto(v: TemplateVersion) {
  return { ...toDto(v), variables: Array.isArray(v.variables) ? (v.variables as string[]) : [] };
}

export async function loadTemplate(ctx: RequestContext, id: string): Promise<Template & { versions: TemplateVersion[] }> {
  const t = await prisma.template.findFirst({ where: { id, ...scopeFilter(ctx.tenantOrgId!) }, include: { versions: { orderBy: { version: 'desc' } } } });
  if (!t) throw errors.notFound();
  return t;
}

/** Org templates are editable by the org; platform templates only by platform actors. */
export function assertEditable(ctx: RequestContext, t: Template): void {
  if (t.tenantOrgId === null && !ctx.actor?.isPlatform) throw errors.forbidden('Platform templates are managed by the platform team');
}

/** Approved version for a key: the org override wins over the platform default. */
export async function findApprovedVersion(tenantOrgId: string, key: string): Promise<{ template: Template; version: TemplateVersion } | null> {
  const templates = await prisma.template.findMany({ where: { key, ...scopeFilter(tenantOrgId) }, include: { versions: { where: { status: 'approved' }, orderBy: { version: 'desc' }, take: 1 } } });
  const pick = templates.find((t) => t.tenantOrgId === tenantOrgId && t.versions.length) ?? templates.find((t) => t.tenantOrgId === null && t.versions.length);
  if (!pick) return null;
  return { template: pick, version: pick.versions[0]! };
}

export interface RenderedTemplate extends Rendered { template: Template; version: TemplateVersion }

/** Render the approved version of `key` for the org; missing template or variables -> validation error. */
export async function renderTemplateKey(tenantOrgId: string, key: string, vars: TemplateVariables): Promise<RenderedTemplate> {
  const found = await findApprovedVersion(tenantOrgId, key);
  if (!found) throw errors.validation([{ path: 'templateKey', message: 'No approved template for this key' }], `No approved template for key ${key}`);
  const out = renderVersion(found.version, vars, found.template.channel);
  return { ...out, template: found.template, version: found.version };
}

async function retirePrevious(templateId: string, keepVersionId: string): Promise<void> {
  await prisma.templateVersion.updateMany({ where: { templateId, status: 'approved', id: { not: keepVersionId } }, data: { status: 'retired' } });
}

export async function approveVersion(ctx: RequestContext, t: Template, v: TemplateVersion, via: 'auto' | 'approver', note?: string): Promise<TemplateVersion> {
  const updated = await prisma.templateVersion.update({ where: { id: v.id }, data: { status: 'approved', approvedBy: ctx.actor!.userId, approvedAt: new Date() } });
  await retirePrevious(t.id, v.id);
  await prisma.template.update({ where: { id: t.id }, data: { currentVersion: v.version } });
  await audit(ctx, { action: 'template.approve', resourceType: 'template', resourceId: t.id, before: { status: v.status }, after: { status: 'approved', versionId: v.id, version: v.version, via, note, riskLevel: t.riskLevel } });
  await publish(ctx, 'template.approved', { templateId: t.id, key: t.key, versionId: v.id, version: v.version, riskLevel: t.riskLevel, via });
  return updated;
}

export function actorRolesFor(ctx: RequestContext, v: TemplateVersion): ('author' | 'approver')[] {
  const roles: ('author' | 'approver')[] = [];
  if (v.createdBy === ctx.actor?.userId) roles.push('author');
  if (ctx.permissions.has('template:approve') && v.createdBy !== ctx.actor?.userId) roles.push('approver');
  if (ctx.permissions.has('template:write') && !roles.includes('author')) roles.push('author');
  return roles;
}
