// template contracts (Day 29): template registry, versions, approval workflow, rendering.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const TEMPLATE_CHANNELS = ['email', 'sms', 'document', 'notice'] as const;
export const TEMPLATE_RISK_LEVELS = ['low', 'high'] as const;
export const TEMPLATE_VERSION_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'retired'] as const;

export const templateKeySchema = z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Key must be lowercase dot/dash separated, e.g. notice.late_rent');
const variableName = z.string().trim().min(1).max(60).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Variable names are identifiers');

export const templateVersion = z
  .object({
    id: idSchema, templateId: idSchema, version: z.number().int(), subject: z.string().nullable(), body: z.string(), variables: z.array(z.string()),
    status: z.enum(TEMPLATE_VERSION_STATUSES), approvedBy: idSchema.nullable(), approvedAt: z.string().nullable(), createdBy: idSchema, createdAt: z.string(),
  })
  .openapi('TemplateVersion');

export const template = z
  .object({
    id: idSchema, tenantOrgId: idSchema.nullable(), key: templateKeySchema, channel: z.enum(TEMPLATE_CHANNELS), name: z.string(), riskLevel: z.enum(TEMPLATE_RISK_LEVELS), jurisdiction: z.string().nullable(),
    currentVersion: z.number().int(), scope: z.enum(['platform', 'org']), createdAt: z.string(), updatedAt: z.string(),
    /** Status of the newest version, for list badges. */
    latestStatus: z.enum(TEMPLATE_VERSION_STATUSES).nullable(),
  })
  .openapi('Template');
export const templatePage = pageOf(template, 'Template');
export const templateDetail = template.extend({ versions: z.array(templateVersion) }).openapi('TemplateDetail');

export const templateQuery = paginationQuery.extend({
  channel: z.enum(TEMPLATE_CHANNELS).optional(), riskLevel: z.enum(TEMPLATE_RISK_LEVELS).optional(), scope: z.enum(['platform', 'org']).optional(), q: z.string().trim().max(100).optional(),
});

export const createTemplate = z
  .object({
    key: templateKeySchema, channel: z.enum(TEMPLATE_CHANNELS), name: z.string().trim().min(1).max(120), riskLevel: z.enum(TEMPLATE_RISK_LEVELS).default('low'), jurisdiction: z.string().trim().max(16).optional(),
    subject: z.string().trim().max(300).optional(), body: z.string().min(1).max(20_000), variables: z.array(variableName).max(50).optional(),
  })
  .openapi('CreateTemplate');

export const createTemplateVersion = z
  .object({ subject: z.string().trim().max(300).optional(), body: z.string().min(1).max(20_000), variables: z.array(variableName).max(50).optional() })
  .openapi('CreateTemplateVersion');

export const templateDecision = z.object({ note: z.string().trim().max(1000).optional() }).openapi('TemplateDecision');

export const renderTemplate = z.object({ variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }).openapi('RenderTemplate');
export const renderedTemplate = z
  .object({ templateId: idSchema, versionId: idSchema, version: z.number().int(), key: templateKeySchema, channel: z.enum(TEMPLATE_CHANNELS), subject: z.string().nullable(), body: z.string() })
  .openapi('RenderedTemplate');

export const templateVersionParams = z.object({ id: idSchema, versionId: idSchema });
export const templateKeyParams = z.object({ key: templateKeySchema });

export type TemplateDto = z.infer<typeof template>;
export type TemplateDetailDto = z.infer<typeof templateDetail>;
export type TemplateVersionDto = z.infer<typeof templateVersion>;
export type CreateTemplateDto = z.infer<typeof createTemplate>;
export type RenderedTemplateDto = z.infer<typeof renderedTemplate>;
