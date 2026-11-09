import { Router } from 'express';
import { idParams, templateDetail, templatePage, templateQuery, createTemplate, createTemplateVersion, templateDecision, renderTemplate, renderedTemplate, templateVersionParams, templateKeyParams } from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { templateMachine, scopeFilter, templateDto, versionDto, loadTemplate, assertEditable, approveVersion, actorRolesFor, renderTemplateKey, type VersionStatus } from './service.js';

export { renderTemplateKey, findApprovedVersion } from './service.js';
export { renderVersion, missingVariables, requiredVariables, escapeHtml } from './render.js';

/**
 * Template registry (Day 29): org templates plus read-only platform defaults, versioned with an
 * approval workflow (low risk auto-approves; high risk needs a second person with template:approve)
 * and a render endpoint that fails loudly on missing variables.
 */
/** Approvers must be able to read what they approve: template:read or template:approve grants read. */
function requireTemplateRead(ctx: RequestContext): void {
  if (!ctx.permissions.has('template:read') && !ctx.permissions.has('template:approve')) throw errors.forbidden();
}

export const templateRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/templates', operationId: 'listTemplates', summary: 'List org templates and platform defaults (template:read or template:approve)', tags: ['template'], auth: 'session',
    request: { query: templateQuery }, responses: { 200: templatePage },
    handler: async ({ query, ctx }) => {
      requireTemplateRead(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.template.findMany({
        where: {
          ...(query.scope === 'org' ? { tenantOrgId: ctx.tenantOrgId! } : query.scope === 'platform' ? { tenantOrgId: null } : scopeFilter(ctx.tenantOrgId!)),
          ...(query.channel ? { channel: query.channel } : {}), ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
          ...(query.q ? { OR: [{ key: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] } : {}),
        },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(templateDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates', operationId: 'createTemplate', summary: 'Create an org template with a draft version 1', tags: ['template'], auth: 'mfa', permission: 'template:write',
    request: { body: createTemplate }, responses: { 201: templateDetail },
    handler: async ({ body, ctx }) => {
      const dup = await prisma.template.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, key: body.key } });
      if (dup) throw errors.conflict('A template with this key already exists in your organization');
      const t = await prisma.template.create({ data: { tenantOrgId: ctx.tenantOrgId!, key: body.key, channel: body.channel, name: body.name, riskLevel: body.riskLevel, jurisdiction: body.jurisdiction ?? null, currentVersion: 0 } });
      const v = await prisma.templateVersion.create({ data: { tenantOrgId: ctx.tenantOrgId!, templateId: t.id, version: 1, subject: body.subject ?? null, body: body.body, variables: body.variables ?? [], status: 'draft', createdBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'template.create', resourceType: 'template', resourceId: t.id, after: { key: t.key, channel: t.channel, riskLevel: t.riskLevel, jurisdiction: t.jurisdiction, versionId: v.id } });
      return { status: 201, body: { ...templateDto({ ...t, versions: [v] }), versions: [versionDto(v)] } };
    } }),

  defineRoute({ method: 'get', path: '/templates/:id', operationId: 'getTemplate', summary: 'Get a template with all versions (template:read or template:approve)', tags: ['template'], auth: 'session',
    request: { params: idParams }, responses: { 200: templateDetail },
    handler: async ({ params, ctx }) => {
      requireTemplateRead(ctx);
      const t = await loadTemplate(ctx, params.id);
      return { body: { ...templateDto(t), versions: t.versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates/:id/versions', operationId: 'createTemplateVersion', summary: 'Add a draft version', tags: ['template'], auth: 'mfa', permission: 'template:write',
    request: { params: idParams, body: createTemplateVersion }, responses: { 201: templateDetail },
    handler: async ({ params, body, ctx }) => {
      const t = await loadTemplate(ctx, params.id);
      assertEditable(ctx, t);
      const next = (t.versions[0]?.version ?? 0) + 1;
      const v = await prisma.templateVersion.create({ data: { tenantOrgId: t.tenantOrgId, templateId: t.id, version: next, subject: body.subject ?? null, body: body.body, variables: body.variables ?? [], status: 'draft', createdBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'template.version_create', resourceType: 'template', resourceId: t.id, after: { versionId: v.id, version: next } });
      const fresh = await loadTemplate(ctx, t.id);
      return { status: 201, body: { ...templateDto(fresh), versions: fresh.versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates/:id/versions/:versionId/submit', operationId: 'submitTemplateVersion', summary: 'Submit a draft for approval (low-risk templates auto-approve)', tags: ['template'], auth: 'mfa', permission: 'template:write',
    request: { params: templateVersionParams }, responses: { 200: templateDetail },
    handler: async ({ params, ctx }) => {
      const t = await loadTemplate(ctx, params.id);
      assertEditable(ctx, t);
      const v = t.versions.find((x) => x.id === params.versionId);
      if (!v) throw errors.notFound();
      templateMachine.assertTransition(v.status as VersionStatus, 'pending_approval', actorRolesFor(ctx, v));
      const pending = await prisma.templateVersion.update({ where: { id: v.id }, data: { status: 'pending_approval' } });
      await audit(ctx, { action: 'template.submit', resourceType: 'template', resourceId: t.id, before: { status: v.status }, after: { status: 'pending_approval', versionId: v.id, riskLevel: t.riskLevel } });
      if (t.riskLevel === 'low') await approveVersion(ctx, t, pending, 'auto');
      const fresh = await loadTemplate(ctx, t.id);
      return { status: 200, body: { ...templateDto(fresh), versions: fresh.versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates/:id/versions/:versionId/approve', operationId: 'approveTemplateVersion', summary: 'Approve a pending high-risk version (approver cannot be the author)', tags: ['template'], auth: 'mfa', permission: 'template:approve',
    request: { params: templateVersionParams, body: templateDecision.optional() }, responses: { 200: templateDetail },
    handler: async ({ params, body, ctx }) => {
      const t = await loadTemplate(ctx, params.id);
      assertEditable(ctx, t);
      const v = t.versions.find((x) => x.id === params.versionId);
      if (!v) throw errors.notFound();
      if (v.createdBy === ctx.actor!.userId) throw errors.forbidden('You cannot approve your own template version');
      templateMachine.assertTransition(v.status as VersionStatus, 'approved', actorRolesFor(ctx, v));
      await approveVersion(ctx, t, v, 'approver', body?.note);
      const fresh = await loadTemplate(ctx, t.id);
      return { status: 200, body: { ...templateDto(fresh), versions: fresh.versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates/:id/versions/:versionId/reject', operationId: 'rejectTemplateVersion', summary: 'Reject a pending version', tags: ['template'], auth: 'mfa', permission: 'template:approve',
    request: { params: templateVersionParams, body: templateDecision.optional() }, responses: { 200: templateDetail },
    handler: async ({ params, body, ctx }) => {
      const t = await loadTemplate(ctx, params.id);
      assertEditable(ctx, t);
      const v = t.versions.find((x) => x.id === params.versionId);
      if (!v) throw errors.notFound();
      if (v.createdBy === ctx.actor!.userId) throw errors.forbidden('You cannot decide on your own template version');
      templateMachine.assertTransition(v.status as VersionStatus, 'rejected', actorRolesFor(ctx, v));
      await prisma.templateVersion.update({ where: { id: v.id }, data: { status: 'rejected' } });
      await audit(ctx, { action: 'template.reject', resourceType: 'template', resourceId: t.id, before: { status: v.status }, after: { status: 'rejected', versionId: v.id, note: body?.note } });
      const fresh = await loadTemplate(ctx, t.id);
      return { status: 200, body: { ...templateDto(fresh), versions: fresh.versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/templates/:key/render', operationId: 'renderTemplate', summary: 'Render the approved version of a template key with variables (400 lists missing variables)', tags: ['template'], auth: 'session', permission: 'template:read',
    request: { params: templateKeyParams, body: renderTemplate }, responses: { 200: renderedTemplate },
    handler: async ({ params, body, ctx }) => {
      const r = await renderTemplateKey(ctx.tenantOrgId!, params.key, body.variables);
      return { status: 200, body: { templateId: r.template.id, versionId: r.version.id, version: r.version.version, key: r.template.key, channel: r.template.channel, subject: r.subject, body: r.body } };
    } }),
];

export const templateRouter: Router = Router();
mount(templateRouter, templateRoutes);
