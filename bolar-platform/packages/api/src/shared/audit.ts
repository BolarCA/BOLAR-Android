import type { RequestContext } from '@bolar/shared';
import { redactObject } from '@bolar/shared';
import { prisma } from './db.js';
import { logger } from '../logger.js';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: 'allow' | 'deny' | 'review_required' | 'error';
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  policyVersion?: string | null;
  /** Override tenant (platform actions on another org). */
  tenantOrgId?: string | null;
}

/** Append-only audit writer (blueprint p22, Day 46). Awaited so the request fails if audit fails. */
export async function audit(ctx: RequestContext, input: AuditInput): Promise<void> {
  const data = {
    tenantOrgId: input.tenantOrgId === undefined ? ctx.tenantOrgId : input.tenantOrgId,
    actorId: ctx.actor?.userId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome ?? 'allow',
    requestId: ctx.requestId,
    purpose: ctx.purpose,
    policyVersion: input.policyVersion ?? null,
    before: input.before === undefined ? undefined : (redactObject(input.before) as object),
    after: input.after === undefined ? undefined : (redactObject(input.after) as object),
    metadata: { ...(input.metadata ?? {}), supportSessionId: ctx.supportSessionId ?? undefined, userAgent: ctx.userAgent ?? undefined } as object,
    ip: ctx.ip,
  };
  try {
    await prisma.auditLog.create({ data: data as never });
  } catch (err) {
    logger.error({ err, action: input.action, requestId: ctx.requestId }, 'audit write failed');
    throw err;
  }
}
