/**
 * Governance reactions and jobs (Days 47-50).
 * - legal_hold.created / legal_hold.released: log for the compliance channel (notifications are mapped by the notification module).
 * - export.completed: log the manifest hash so the worker trail matches the API audit row.
 * - retentionSweepJob: daily schedule entry point (integrator wires it to a cron/repeatable job; no cron wiring here).
 * - exportsJobHandler: handler for the `exports` queue (integrator adds `exports: exportsJobHandler` to handlers/index.ts).
 */
import type { DomainEvent } from '@bolar/shared';
import type { JobContext } from '../index.js';
import { onEvent } from '../registry.js';

interface HoldPayload { legalHoldId: string; scope?: Record<string, string[]>; caseId?: string }
interface ExportPayload { exportJobId: string; tenantOrgId: string; manifestSha256: string; storageKey: string }

onEvent('legal_hold.created', async (event: DomainEvent, ctx: JobContext) => {
  const p = event.payload as HoldPayload;
  const scopeSummary = Object.fromEntries(Object.entries(p.scope ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  ctx.logger.info({ legalHoldId: p.legalHoldId, tenantOrgId: event.tenantOrgId, caseId: p.caseId, scope: scopeSummary }, 'legal hold created; deletion and retention actions are blocked for the scope');
});

onEvent('legal_hold.released', async (event: DomainEvent, ctx: JobContext) => {
  const p = event.payload as HoldPayload;
  ctx.logger.info({ legalHoldId: p.legalHoldId, tenantOrgId: event.tenantOrgId }, 'legal hold released');
});

onEvent('export.completed', async (event: DomainEvent, ctx: JobContext) => {
  const p = event.payload as ExportPayload;
  ctx.logger.info({ exportJobId: p.exportJobId, tenantOrgId: event.tenantOrgId, manifestSha256: p.manifestSha256 }, 'export manifest written');
});

onEvent('privacy_request.received', async (event: DomainEvent, ctx: JobContext) => {
  const p = event.payload as { privacyRequestId: string; kind: string; dueAt: string };
  ctx.logger.info({ privacyRequestId: p.privacyRequestId, kind: p.kind, dueAt: p.dueAt, tenantOrgId: event.tenantOrgId }, 'privacy request received; SLA clock started');
});

/**
 * Daily retention sweep (Day 47). Proposes dispositions for every org; never deletes. Schedule suggestion:
 * a BullMQ repeatable job `{ pattern: '0 3 * * *' }` on a `retention` queue calling this function.
 */
export async function retentionSweepJob(_data: Record<string, unknown>, ctx: JobContext): Promise<void> {
  const { sweepAllTenants } = await import('@bolar/api/dist/modules/retention/service.js');
  const results = await sweepAllTenants();
  const totals = Object.values(results).reduce((t, r) => ({ scanned: t.scanned + r.scanned, proposed: t.proposed + r.proposed, held: t.held + r.held }), { scanned: 0, proposed: 0, held: 0 });
  ctx.logger.info({ orgs: Object.keys(results).length, ...totals }, 'retention sweep complete (proposals only; human approval required)');
}

/** `exports` queue handler: builds the packet manifest for an approved export job. */
export async function exportsJobHandler(data: { exportJobId: string; tenantOrgId: string; requestId: string }, ctx: JobContext): Promise<void> {
  const { runExportJob } = await import('@bolar/api/dist/modules/packet-export/service.js');
  const result = await runExportJob(data.exportJobId);
  ctx.logger.info({ exportJobId: data.exportJobId, status: result.status, manifestSha256: result.sha256 }, 'export job processed');
}
