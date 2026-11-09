/**
 * Compliance demo seed (Days 41-45, 59). Adds review-queue items, a notice awaiting approval and an application in
 * review for the demo org. Idempotent; synthetic data only. Wired by the integrator from seed/demo-data.ts:
 *   import { seedComplianceDemo } from './modules/compliance.js';  await seedComplianceDemo(org.id);
 */
import { prisma } from '../../src/client.js';

const DEMO_MARKER = 'seed:compliance-demo';

async function rule(key: string) {
  return prisma.complianceRule.findFirst({ where: { key, status: 'active' }, orderBy: { version: 'desc' } });
}

export async function seedComplianceDemo(orgId: string): Promise<void> {
  const [manager, officer] = await Promise.all([
    prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } }),
    prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'compliance@demo.bolar.test' } }),
  ]);
  const caProperty = await prisma.property.findFirst({ where: { tenantOrgId: orgId, state: 'CA' } });
  const txProperty = await prisma.property.findFirst({ where: { tenantOrgId: orgId, state: 'TX' } });
  const tenantProfile = await prisma.tenantProfile.findFirst({ where: { tenantOrgId: orgId, email: 'tenant@demo.bolar.test' } });
  if (!manager || !officer || !caProperty || !txProperty || !tenantProfile) {
    console.warn('[seed:compliance] demo org is missing users/properties/tenant profile; run the base demo seed first');
    return;
  }
  const already = await prisma.ruleEvaluation.findFirst({ where: { tenantOrgId: orgId, resourceId: `${DEMO_MARKER}:lease-ca` } });
  if (already) return;

  // 1) Deposit block for the CA property (hypothetical lease facts: 2x rent deposit after AB 12)
  const depositRule = await rule('us-ca.deposit.max_one_month');
  if (depositRule) {
    await prisma.ruleEvaluation.create({ data: { tenantOrgId: orgId, ruleId: depositRule.id, ruleKey: depositRule.key, ruleVersion: depositRule.version, resourceType: 'lease', resourceId: `${DEMO_MARKER}:lease-ca`, result: 'block',
      evidenceJson: { conditionsMatched: ['depositCents gt_field "rentCents" (depositCents=360000, rentCents=180000)'], facts: { depositCents: 360000, rentCents: 180000, propertyId: caProperty.id, propertyName: caProperty.name }, sourceUrl: depositRule.sourceUrl, title: depositRule.title, description: depositRule.description, jurisdiction: depositRule.jurisdiction, domain: depositRule.domain } } });
  }
  // 2) Late fee warn on the same CA property
  const lateFeeRule = await rule('us-ca.late_fee.reasonable');
  if (lateFeeRule) {
    await prisma.ruleEvaluation.create({ data: { tenantOrgId: orgId, ruleId: lateFeeRule.id, ruleKey: lateFeeRule.key, ruleVersion: lateFeeRule.version, resourceType: 'lease', resourceId: `${DEMO_MARKER}:lease-ca`, result: 'warn',
      evidenceJson: { conditionsMatched: ['lateFeePercent gt 5 (lateFeePercent=8)'], facts: { lateFeePercent: 8, propertyId: caProperty.id }, sourceUrl: lateFeeRule.sourceUrl, title: lateFeeRule.title, description: lateFeeRule.description, jurisdiction: lateFeeRule.jurisdiction, domain: lateFeeRule.domain } } });
  }
  // 3) SOI guard review on a draft listing text
  const soiRule = await rule('us.soi.voucher_refusal');
  if (soiRule) {
    await prisma.ruleEvaluation.create({ data: { tenantOrgId: orgId, ruleId: soiRule.id, ruleKey: soiRule.key, ruleVersion: soiRule.version, resourceType: 'listing', resourceId: `${DEMO_MARKER}:listing-riverside`, result: 'review',
      evidenceJson: { conditionsMatched: ['text matches_any (matched: no vouchers)'], facts: { text: 'Bright loft, no vouchers, 12-month lease.' }, matchedTerms: ['no vouchers'], sourceUrl: soiRule.sourceUrl, title: soiRule.title, description: soiRule.description, jurisdiction: soiRule.jurisdiction, domain: soiRule.domain } } });
  }
  // 4) Late-rent notice pending approval
  if (!(await prisma.notice.findFirst({ where: { tenantOrgId: orgId, kind: 'late_rent', status: 'pending_approval' } }))) {
    await prisma.notice.create({ data: { tenantOrgId: orgId, kind: 'late_rent', templateKey: 'notice.late_rent', recipientId: tenantProfile.id, status: 'pending_approval', createdBy: manager.id,
      bodyDraft: 'Dear Theo Tenant, rent of $1,450.00 for November was due Nov 1 and remains unpaid. Please remit by Nov 8. Texas Property Code Chapter 92 applies.',
      variables: { tenantName: 'Theo Tenant', amount: '$1,450.00', period: 'November', dueDate: 'Nov 1', cureDate: 'Nov 8', jurisdictionClause: 'Texas Property Code Chapter 92 applies.' } } });
  }
  // 5) Application in review with a consented, completed mock screening (summary only; report file lands via the API run)
  const applicant = (await prisma.tenantProfile.findFirst({ where: { tenantOrgId: orgId, displayName: 'Casey Candidate' } })) ??
    (await prisma.tenantProfile.create({ data: { tenantOrgId: orgId, displayName: 'Casey Candidate', email: 'casey.candidate@demo.bolar.test', status: 'applicant', classification: 'confidential' } }));
  if (!(await prisma.application.findFirst({ where: { tenantOrgId: orgId, applicantId: applicant.id } }))) {
    const unit = await prisma.unit.findFirst({ where: { tenantOrgId: orgId, propertyId: txProperty.id, status: 'vacant' } });
    const submittedAt = new Date(Date.now() - 3 * 86_400_000);
    const app = await prisma.application.create({ data: { tenantOrgId: orgId, propertyId: txProperty.id, unitId: unit?.id ?? null, applicantId: applicant.id, status: 'review', submittedAt } });
    const order = await prisma.screeningOrder.create({ data: { tenantOrgId: orgId, applicationId: app.id, provider: 'mock', status: 'completed', consentAt: submittedAt, consentDocId: 'demo-consent-form', externalId: 'tu_mock_demo_0001', orderedBy: manager.id } });
    await prisma.screeningResult.create({ data: { tenantOrgId: orgId, orderId: order.id, classification: 'restricted', summaryJson: { recommendation: 'conditional', creditBand: 'fair', evictionRecords: 0, criminalRecords: 0, providerContact: 'TransUnion Rental Screening Solutions, 1-800-000-0000 (mock)' } } });
  }
}
