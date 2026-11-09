/**
 * Base seed (Days 8, 12): permission catalog, platform templates, retention defaults, a dev
 * platform admin and a demo org with one user per persona. Synthetic data only.
 * Idempotent: safe to re-run.
 */
import 'dotenv/config';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Role } from '@bolar/shared';
import { prisma } from '../src/client.js';
import { hashPassword } from '../src/password.js';

export const DEV_PASSWORD = 'Bolar!Demo2026';

export const DEMO_ORG = { slug: 'demo-pm', name: 'Demo Property Management' };

export const DEMO_USERS: { email: string; name: string; role: Role; scopeType: 'org' | 'platform' }[] = [
  { email: 'orgadmin@demo.bolar.test', name: 'Olivia Orgadmin', role: 'org_admin', scopeType: 'org' },
  { email: 'manager@demo.bolar.test', name: 'Marcus Manager', role: 'property_manager', scopeType: 'org' },
  { email: 'owner@demo.bolar.test', name: 'Lena Landlord', role: 'landlord', scopeType: 'org' },
  { email: 'tenant@demo.bolar.test', name: 'Theo Tenant', role: 'tenant', scopeType: 'org' },
  { email: 'books@demo.bolar.test', name: 'Bea Bookkeeper', role: 'bookkeeper', scopeType: 'org' },
  { email: 'legal@demo.bolar.test', name: 'Luis Lawyer', role: 'lawyer', scopeType: 'org' },
  { email: 'vendor@demo.bolar.test', name: 'Vera Vendor', role: 'vendor', scopeType: 'org' },
  { email: 'compliance@demo.bolar.test', name: 'Cam Compliance', role: 'compliance_officer', scopeType: 'org' },
  { email: 'gov@demo.bolar.test', name: 'Gia Government', role: 'government', scopeType: 'org' },
  { email: 'corp@demo.bolar.test', name: 'Cory Corpadmin', role: 'corp_admin', scopeType: 'org' },
  { email: 'occupant@demo.bolar.test', name: 'Omar Occupant', role: 'occupant', scopeType: 'org' },
];

export async function seedBase() {
  // Permission catalog
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, description: key.replace(':', ' ') } });
  }
  // Platform org hosts platform admins
  const platform = await prisma.tenantOrg.upsert({
    where: { slug: 'bolar-platform' },
    update: {},
    create: { slug: 'bolar-platform', name: 'BOLAR Platform', plan: 'platform' },
  });
  const pwd = await hashPassword(DEV_PASSWORD);
  const admin = await prisma.userProfile.upsert({
    where: { tenantOrgId_email: { tenantOrgId: platform.id, email: 'platform@bolar.test' } },
    update: { passwordHash: pwd, isPlatform: true, status: 'active' },
    create: { tenantOrgId: platform.id, email: 'platform@bolar.test', name: 'Pat Platform', passwordHash: pwd, isPlatform: true },
  });
  await ensureRole(platform.id, admin.id, 'platform_admin', 'platform', null);

  // Demo org
  const org = await prisma.tenantOrg.upsert({ where: { slug: DEMO_ORG.slug }, update: {}, create: DEMO_ORG });
  const ba = (await prisma.businessAccount.findFirst({ where: { tenantOrgId: org.id } })) ??
    (await prisma.businessAccount.create({ data: { tenantOrgId: org.id, name: 'Demo PM LLC' } }));
  if (!(await prisma.subaccount.findFirst({ where: { tenantOrgId: org.id } }))) {
    await prisma.subaccount.create({ data: { tenantOrgId: org.id, businessAccountId: ba.id, name: 'Austin Region' } });
  }
  for (const u of DEMO_USERS) {
    const user = await prisma.userProfile.upsert({
      where: { tenantOrgId_email: { tenantOrgId: org.id, email: u.email } },
      update: { passwordHash: pwd, status: 'active' },
      create: { tenantOrgId: org.id, email: u.email, name: u.name, passwordHash: pwd },
    });
    await ensureRole(org.id, user.id, u.role, 'org', org.id);
  }

  // Platform templates (Day 29)
  const templates: { key: string; channel: string; name: string; riskLevel: string; subject?: string; body: string; variables: string[] }[] = [
    { key: 'invite.staff', channel: 'email', name: 'Staff invitation', riskLevel: 'low', subject: 'You are invited to {{orgName}} on BOLAR', body: 'Hi {{name}}, accept your invitation: {{acceptUrl}} (expires {{expiresAt}}).', variables: ['orgName', 'name', 'acceptUrl', 'expiresAt'] },
    { key: 'workorder.created', channel: 'email', name: 'Maintenance request received', riskLevel: 'low', subject: 'We received your request #{{workOrderId}}', body: 'Hi {{name}}, your request "{{title}}" was received. Priority: {{priority}}.', variables: ['name', 'workOrderId', 'title', 'priority'] },
    { key: 'invoice.issued', channel: 'email', name: 'Invoice issued', riskLevel: 'low', subject: 'Invoice {{number}} due {{dueDate}}', body: 'Hi {{name}}, invoice {{number}} for {{amount}} is due {{dueDate}}.', variables: ['name', 'number', 'amount', 'dueDate'] },
    { key: 'notice.late_rent', channel: 'notice', name: 'Late rent notice', riskLevel: 'high', subject: 'Notice of late rent', body: 'Dear {{tenantName}}, rent of {{amount}} for {{period}} was due {{dueDate}} and remains unpaid. Please remit by {{cureDate}}. {{jurisdictionClause}}', variables: ['tenantName', 'amount', 'period', 'dueDate', 'cureDate', 'jurisdictionClause'] },
    { key: 'notice.pre_adverse', channel: 'notice', name: 'Pre-adverse action notice (FCRA)', riskLevel: 'high', subject: 'Pre-adverse action notice', body: 'Dear {{applicantName}}, we are considering an adverse decision based in whole or part on a consumer report from {{providerName}}. A copy of the report and the Summary of Rights is enclosed. You have {{waitingDays}} days to dispute.', variables: ['applicantName', 'providerName', 'waitingDays'] },
    { key: 'notice.final_adverse', channel: 'notice', name: 'Final adverse action notice (FCRA)', riskLevel: 'high', subject: 'Adverse action notice', body: 'Dear {{applicantName}}, your application was {{decision}}. Reasons: {{reasons}}. Report provider: {{providerName}} ({{providerContact}}). The provider did not make this decision.', variables: ['applicantName', 'decision', 'reasons', 'providerName', 'providerContact'] },
    { key: 'privacy.confirmation', channel: 'email', name: 'Privacy request confirmation', riskLevel: 'high', subject: 'Your privacy request {{requestId}}', body: 'We received your {{kind}} request on {{receivedAt}}. Reference {{requestId}}. We will respond by {{dueAt}}.', variables: ['requestId', 'kind', 'receivedAt', 'dueAt'] },
    { key: 'sms.workorder.scheduled', channel: 'sms', name: 'Work order scheduled', riskLevel: 'low', body: 'BOLAR: your maintenance visit is scheduled for {{when}}. Reply STOP to opt out.', variables: ['when'] },
  ];
  for (const t of templates) {
    const tpl =
      (await prisma.template.findFirst({ where: { tenantOrgId: null, key: t.key } })) ??
      (await prisma.template.create({ data: { key: t.key, channel: t.channel, name: t.name, riskLevel: t.riskLevel, currentVersion: 1 } }));
    const v = await prisma.templateVersion.findFirst({ where: { templateId: tpl.id, version: 1 } });
    if (!v) {
      await prisma.templateVersion.create({ data: { templateId: tpl.id, version: 1, subject: t.subject, body: t.body, variables: t.variables, status: 'approved', approvedBy: admin.id, approvedAt: new Date(), createdBy: admin.id } });
    }
  }

  // Default retention policies (Day 47) - platform level
  const retention = [
    { key: 'lease.records', name: 'Lease records', resourceType: 'lease', retainDays: 365 * 7, disposition: 'review' },
    { key: 'screening.reports', name: 'Screening reports', resourceType: 'screening_result', classification: 'restricted', retainDays: 365 * 2, disposition: 'delete' },
    { key: 'audit.logs', name: 'Audit logs', resourceType: 'audit_log', retainDays: 365 * 7, disposition: 'archive' },
    { key: 'maintenance.media', name: 'Maintenance media', resourceType: 'media', retainDays: 365 * 3, disposition: 'delete' },
    { key: 'notifications', name: 'Notifications', resourceType: 'notification', retainDays: 365, disposition: 'delete' },
    { key: 'documents.general', name: 'General documents', resourceType: 'document', retainDays: 365 * 5, disposition: 'review' },
  ];
  for (const r of retention) {
    const existing = await prisma.retentionPolicy.findFirst({ where: { tenantOrgId: null, key: r.key } });
    if (!existing) await prisma.retentionPolicy.create({ data: { ...r } });
  }

  // Starter compliance rules (Day 41-44) - versioned, source-linked, counsel review required before activation in prod
  const rules = [
    { key: 'us.fcra.consent_before_screening', jurisdiction: 'US', domain: 'screening', title: 'Consent required before screening order', description: 'A screening order cannot be placed without recorded applicant consent (FCRA §604).', severity: 'critical', action: 'block', conditions: { all: [{ field: 'consentAt', op: 'is_null' }] }, sourceUrl: 'https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act' },
    { key: 'us.fcra.adverse_action_waiting_period', jurisdiction: 'US', domain: 'screening', title: 'Pre-adverse waiting period', description: 'Final adverse action requires a waiting period (industry standard 5 business days) after the pre-adverse notice.', severity: 'high', action: 'block', conditions: { all: [{ field: 'daysSincePreAdverse', op: 'lt', value: 5 }] }, sourceUrl: 'https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act' },
    { key: 'us.fair_housing.protected_class_language', jurisdiction: 'US', domain: 'fair_housing', title: 'Protected-class language in listing or criteria', description: 'Text referencing protected classes (race, color, religion, national origin, sex, familial status, disability) is routed to human review.', severity: 'critical', action: 'review', conditions: { any: [{ field: 'text', op: 'matches_any', value: ['no children', 'adults only', 'christian', 'muslim', 'jewish', 'hispanic', 'asian', 'black', 'white only', 'disabled', 'wheelchair', 'no kids', 'female only', 'male only', 'single person'] }] }, sourceUrl: 'https://www.hud.gov/program_offices/fair_housing_equal_opp/fair_housing_act_overview' },
    { key: 'us.soi.voucher_refusal', jurisdiction: 'US', domain: 'soi', title: 'Source-of-income refusal language', description: 'Blanket refusal of vouchers or housing assistance is flagged for review; many jurisdictions prohibit SOI discrimination.', severity: 'high', action: 'review', conditions: { any: [{ field: 'text', op: 'matches_any', value: ['no section 8', 'no vouchers', 'no housing assistance', 'no hud'] }] }, sourceUrl: 'https://www.hud.gov/program_offices/public_indian_housing/programs/hcv' },
    { key: 'us-ca.deposit.max_one_month', jurisdiction: 'US-CA', domain: 'deposit', title: 'California deposit cap (AB 12)', description: 'Security deposit may not exceed one month rent for most landlords from July 1, 2024.', severity: 'high', action: 'block', conditions: { all: [{ field: 'depositCents', op: 'gt_field', value: 'rentCents' }] }, effectiveFrom: new Date('2024-07-01'), sourceUrl: 'https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB12' },
    { key: 'us-ca.late_fee.reasonable', jurisdiction: 'US-CA', domain: 'rent', title: 'Late fee must be reasonable estimate of damages', description: 'Late fees above 5% of monthly rent are flagged for review.', severity: 'medium', action: 'warn', conditions: { all: [{ field: 'lateFeePercent', op: 'gt', value: 5 }] }, sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1671' },
    { key: 'us-tx.deposit.return_30_days', jurisdiction: 'US-TX', domain: 'deposit', title: 'Texas deposit return within 30 days', description: 'Deposit accounting must be returned within 30 days of move-out (Tex. Prop. Code §92.103).', severity: 'high', action: 'warn', conditions: { all: [{ field: 'daysSinceMoveOut', op: 'gt', value: 30 }, { field: 'depositReturned', op: 'eq', value: false }] }, sourceUrl: 'https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm' },
    { key: 'us.notice.entry_24h', jurisdiction: 'US', domain: 'notice', title: 'Entry notice lead time', description: 'Non-emergency entry notices with less than 24 hours lead time are blocked.', severity: 'medium', action: 'block', conditions: { all: [{ field: 'entryLeadHours', op: 'lt', value: 24 }, { field: 'emergency', op: 'eq', value: false }] }, sourceUrl: 'https://www.hud.gov/topics/rental_assistance/tenantrights' },
  ];
  for (const r of rules) {
    const existing = await prisma.complianceRule.findFirst({ where: { key: r.key, version: 1 } });
    if (!existing) {
      await prisma.complianceRule.create({ data: { ...r, version: 1, effectiveFrom: r.effectiveFrom ?? new Date('2020-01-01'), status: 'active', approvedBy: admin.id } });
    }
  }
  return { platform, org, admin };
}

async function ensureRole(tenantOrgId: string, userId: string, role: Role, scopeType: string, scopeId: string | null) {
  const existing = await prisma.roleAssignment.findFirst({ where: { tenantOrgId, userId, role, scopeType, scopeId, revokedAt: null } });
  if (!existing) await prisma.roleAssignment.create({ data: { tenantOrgId, userId, role, scopeType, scopeId } });
}

export function rbacSeedMatrix() {
  return ROLES.map((role) => ({ role, permissions: [...ROLE_PERMISSIONS[role]] }));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  seedBase()
    .then(({ org }) => { console.info(`[seed] base seed complete for org ${org.slug}; dev password: ${DEV_PASSWORD}`); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
