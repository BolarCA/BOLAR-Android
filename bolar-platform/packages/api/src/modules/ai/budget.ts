import type { AiBudgetDto } from '@bolar/contracts';
import { AppError, type RequestContext } from '@bolar/shared';
import type { AiBudget } from '@bolar/db';
import { config } from '../../config.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Load (or create from AI_MONTHLY_BUDGET_CENTS) the org budget, lazily resetting it when the month changed. */
export async function loadBudget(ctx: RequestContext): Promise<AiBudget> {
  const db = tenantDb(ctx);
  const period = currentPeriod();
  const existing = await db.aiBudget.findFirst({});
  if (!existing) return db.aiBudget.create({ data: { tenantOrgId: ctx.tenantOrgId!, monthlyLimitCents: config().AI_MONTHLY_BUDGET_CENTS, period } });
  if (existing.period !== period) {
    const reset = await db.aiBudget.update({ where: { id: existing.id }, data: { spentCents: 0, commandCount: 0, period } });
    await audit(ctx, { action: 'ai.budget_reset', resourceType: 'ai_budget', resourceId: existing.id, before: { period: existing.period, spentCents: existing.spentCents }, after: { period, spentCents: 0 } });
    return reset;
  }
  return existing;
}

export function budgetDto(row: AiBudget): AiBudgetDto {
  const remaining = Math.max(0, row.monthlyLimitCents - row.spentCents);
  return { monthlyLimitCents: row.monthlyLimitCents, spentCents: row.spentCents, remainingCents: remaining, commandCount: row.commandCount, period: row.period, exhausted: row.spentCents >= row.monthlyLimitCents };
}

/** 429 `rate_limited` when the period's spend reached the limit; audited so finance can see refused commands. */
export async function assertBudget(ctx: RequestContext, row: AiBudget): Promise<void> {
  if (row.spentCents < row.monthlyLimitCents) return;
  await audit(ctx, { action: 'ai.budget_exceeded', resourceType: 'ai_budget', resourceId: row.id, outcome: 'deny', metadata: { period: row.period, spentCents: row.spentCents, monthlyLimitCents: row.monthlyLimitCents } });
  throw new AppError('rate_limited', 'The AI assistant budget for this month is exhausted. Ask an administrator to raise it.', 429, { details: { period: row.period, monthlyLimitCents: row.monthlyLimitCents } });
}

export async function chargeBudget(ctx: RequestContext, row: AiBudget, costCents: number): Promise<AiBudget> {
  return tenantDb(ctx).aiBudget.update({ where: { id: row.id }, data: { spentCents: { increment: Math.max(0, costCents) }, commandCount: { increment: 1 } } });
}
