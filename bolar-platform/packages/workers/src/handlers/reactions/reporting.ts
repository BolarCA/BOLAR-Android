/**
 * Reporting reactions and jobs (Days 75-90).
 * - Finance, lease, unit and work-order events schedule a refresh of the rpt_* materialized views, debounced 60 s
 *   in memory so a burst of payments triggers one refresh.
 * - `reportsJobHandler` serves the `reports` queue: `{ kind: 'run', reportRunId }` executes a scheduled/manual report,
 *   `{ kind: 'refresh' }` refreshes the views, `{ kind: 'daily' }` refreshes and runs every definition due today
 *   (scheduled by the repeatable job in workers/src/index.ts).
 */
import type { DomainEvent } from '@bolar/shared';
import type { JobContext } from '../index.js';
import { onEvent } from '../registry.js';

export const REFRESH_DEBOUNCE_MS = Number(process.env.REPORTING_REFRESH_DEBOUNCE_MS ?? 60_000);
const REFRESH_EVENTS = ['payment.succeeded', 'invoice.issued', 'lease.transitioned', 'work_order.transitioned', 'unit.status_changed'] as const;

let timer: NodeJS.Timeout | null = null;
let pending: { events: number; logger: JobContext['logger'] } | null = null;

async function refreshViews(): Promise<{ refreshedAt: string; durationMs: number }> {
  const { refreshReportingViews } = await import('@bolar/api/dist/modules/reporting/service.js');
  return refreshReportingViews();
}

/** Schedule one refresh REFRESH_DEBOUNCE_MS after the first event of a burst. Exported for tests and the daily job. */
export function scheduleReportingRefresh(ctx: JobContext, reason: string): void {
  if (pending) { pending.events++; return; }
  pending = { events: 1, logger: ctx.logger };
  timer = setTimeout(() => {
    const p = pending; pending = null; timer = null;
    void refreshViews()
      .then((r) => p?.logger.info({ events: p.events, durationMs: r.durationMs, refreshedAt: r.refreshedAt, reason }, 'reporting views refreshed'))
      .catch((err) => p?.logger.error({ err }, 'reporting refresh failed'));
  }, REFRESH_DEBOUNCE_MS);
  timer.unref?.();
}

export function cancelScheduledRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = null; pending = null;
}

for (const name of REFRESH_EVENTS) {
  onEvent(name, async (event: DomainEvent, ctx: JobContext) => {
    ctx.logger.debug({ name: event.name, tenantOrgId: event.tenantOrgId }, 'reporting: refresh scheduled');
    scheduleReportingRefresh(ctx, event.name);
  });
}

export interface ReportsJob { kind?: 'run' | 'refresh' | 'daily'; reportRunId?: string; tenantOrgId?: string; requestId?: string }

/** `reports` queue handler (integrator adds `reports: reportsJobHandler` to handlers/index.ts). */
export async function reportsJobHandler(data: ReportsJob, ctx: JobContext): Promise<void> {
  const kind = data.kind ?? (data.reportRunId ? 'run' : 'refresh');
  if (kind === 'run') {
    if (!data.reportRunId) throw new Error('reports job: reportRunId is required');
    const { runReportRun } = await import('@bolar/api/dist/modules/reporting/service.js');
    const result = await runReportRun(data.reportRunId);
    ctx.logger.info({ reportRunId: data.reportRunId, status: result.status, rowCount: result.rowCount, sha256: result.sha256 }, 'report run processed');
    return;
  }
  const r = await refreshViews();
  ctx.logger.info({ durationMs: r.durationMs, refreshedAt: r.refreshedAt }, 'reporting views refreshed');
  if (kind === 'daily') {
    const { runDueScheduledReports } = await import('@bolar/api/dist/modules/reporting/service.js');
    const created = await runDueScheduledReports();
    ctx.logger.info({ runs: created.length }, 'scheduled reports processed');
  }
}
