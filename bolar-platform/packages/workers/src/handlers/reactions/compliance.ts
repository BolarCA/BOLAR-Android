/**
 * Compliance reactions (Days 41-45). Rule evaluation itself runs synchronously in the API (`POST /rules/evaluate`,
 * `evaluateAndPersist`) so a block can stop the request that caused it; the lease module calls it when a lease moves to
 * review/approved (integration step owned by the lease slice). The worker only observes and logs so operators can trace
 * which compliance events were raised; no decision is taken here (p300: humans decide, AI/automation only flags).
 */
import { onEvent } from '../registry.js';

const COMPLIANCE_DOMAINS_FOR_LEASE = ['rent', 'deposit'] as const;

onEvent('lease.transitioned', async (event, ctx) => {
  const payload = event.payload as { leaseId?: string; from?: string; to?: string };
  if (payload.to === 'review' || payload.to === 'approved') {
    ctx.logger.info({ leaseId: payload.leaseId, to: payload.to, domains: COMPLIANCE_DOMAINS_FOR_LEASE, tenantOrgId: event.tenantOrgId }, 'compliance: lease reached a gated state; rent/deposit rules are evaluated synchronously by the lease module via POST /rules/evaluate');
  }
});

onEvent('rule.evaluated', async (event, ctx) => {
  const payload = event.payload as { resourceType: string; resourceId: string; result: string; evaluationIds: string[]; ruleKeys: string[] };
  ctx.logger.info({ tenantOrgId: event.tenantOrgId, resourceType: payload.resourceType, resourceId: payload.resourceId, result: payload.result, ruleKeys: payload.ruleKeys, evaluationIds: payload.evaluationIds.length }, 'compliance: rule hits queued for human review');
});

onEvent('adverse_action.final', async (event, ctx) => {
  const payload = event.payload as { adverseActionId: string; applicationId: string; noticeId: string };
  ctx.logger.info({ tenantOrgId: event.tenantOrgId, adverseActionId: payload.adverseActionId, applicationId: payload.applicationId, noticeId: payload.noticeId }, 'compliance: final adverse action recorded; final notice awaits human approval and send');
});

onEvent('notice.approved', async (event, ctx) => {
  const payload = event.payload as { noticeId: string; recipientId: string; templateKey: string };
  ctx.logger.info({ tenantOrgId: event.tenantOrgId, noticeId: payload.noticeId, templateKey: payload.templateKey }, 'compliance: notice approved by an accountable human');
});
