/**
 * Starter rule catalog fixtures (Days 41-44). Mirrors the eight rules seeded by packages/db/seed/index.ts so API
 * tests (which truncate the database) and the engine fixture tests share one explainable source of truth.
 * Every rule is source-linked and needs counsel review before production activation (docs/qa/compliance-qa.md).
 */
import type { EngineRule } from './engine.js';
import { prisma } from '../../shared/db.js';

export interface StarterRule extends EngineRule {
  key: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: 'active';
  sourceUrl: string;
}

const FROM_2020 = new Date('2020-01-01T00:00:00.000Z');

export const STARTER_RULES: StarterRule[] = [
  { key: 'us.fcra.consent_before_screening', version: 1, jurisdiction: 'US', domain: 'screening', title: 'Consent required before screening order', description: 'A screening order cannot be placed without recorded applicant consent (FCRA §604).', severity: 'critical', action: 'block', conditions: { all: [{ field: 'consentAt', op: 'is_null' }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act' },
  { key: 'us.fcra.adverse_action_waiting_period', version: 1, jurisdiction: 'US', domain: 'screening', title: 'Pre-adverse waiting period', description: 'Final adverse action requires a waiting period (industry standard 5 business days) after the pre-adverse notice.', severity: 'high', action: 'block', conditions: { all: [{ field: 'daysSincePreAdverse', op: 'lt', value: 5 }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://www.ftc.gov/legal-library/browse/statutes/fair-credit-reporting-act' },
  { key: 'us.fair_housing.protected_class_language', version: 1, jurisdiction: 'US', domain: 'fair_housing', title: 'Protected-class language in listing or criteria', description: 'Text referencing protected classes (race, color, religion, national origin, sex, familial status, disability) is routed to human review.', severity: 'critical', action: 'review', conditions: { any: [{ field: 'text', op: 'matches_any', value: ['no children', 'adults only', 'christian', 'muslim', 'jewish', 'hispanic', 'asian', 'black', 'white only', 'disabled', 'wheelchair', 'no kids', 'female only', 'male only', 'single person'] }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://www.hud.gov/program_offices/fair_housing_equal_opp/fair_housing_act_overview' },
  { key: 'us.soi.voucher_refusal', version: 1, jurisdiction: 'US', domain: 'soi', title: 'Source-of-income refusal language', description: 'Blanket refusal of vouchers or housing assistance is flagged for review; many jurisdictions prohibit SOI discrimination.', severity: 'high', action: 'review', conditions: { any: [{ field: 'text', op: 'matches_any', value: ['no section 8', 'no vouchers', 'no housing assistance', 'no hud'] }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://www.hud.gov/program_offices/public_indian_housing/programs/hcv' },
  { key: 'us-ca.deposit.max_one_month', version: 1, jurisdiction: 'US-CA', domain: 'deposit', title: 'California deposit cap (AB 12)', description: 'Security deposit may not exceed one month rent for most landlords from July 1, 2024.', severity: 'high', action: 'block', conditions: { all: [{ field: 'depositCents', op: 'gt_field', value: 'rentCents' }] }, effectiveFrom: new Date('2024-07-01T00:00:00.000Z'), effectiveTo: null, status: 'active', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB12' },
  { key: 'us-ca.late_fee.reasonable', version: 1, jurisdiction: 'US-CA', domain: 'rent', title: 'Late fee must be reasonable estimate of damages', description: 'Late fees above 5% of monthly rent are flagged for review.', severity: 'medium', action: 'warn', conditions: { all: [{ field: 'lateFeePercent', op: 'gt', value: 5 }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1671' },
  { key: 'us-tx.deposit.return_30_days', version: 1, jurisdiction: 'US-TX', domain: 'deposit', title: 'Texas deposit return within 30 days', description: 'Deposit accounting must be returned within 30 days of move-out (Tex. Prop. Code §92.103).', severity: 'high', action: 'warn', conditions: { all: [{ field: 'daysSinceMoveOut', op: 'gt', value: 30 }, { field: 'depositReturned', op: 'eq', value: false }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm' },
  { key: 'us.notice.entry_24h', version: 1, jurisdiction: 'US', domain: 'notice', title: 'Entry notice lead time', description: 'Non-emergency entry notices with less than 24 hours lead time are blocked.', severity: 'medium', action: 'block', conditions: { all: [{ field: 'entryLeadHours', op: 'lt', value: 24 }, { field: 'emergency', op: 'eq', value: false }] }, effectiveFrom: FROM_2020, effectiveTo: null, status: 'active', sourceUrl: 'https://www.hud.gov/topics/rental_assistance/tenantrights' },
];

export const GUARD_RULE_KEYS = ['us.fair_housing.protected_class_language', 'us.soi.voucher_refusal'] as const;
export const RULE_KEYS = {
  consentBeforeScreening: 'us.fcra.consent_before_screening',
  adverseWaitingPeriod: 'us.fcra.adverse_action_waiting_period',
  fairHousing: 'us.fair_housing.protected_class_language',
  soi: 'us.soi.voucher_refusal',
  caDepositCap: 'us-ca.deposit.max_one_month',
  caLateFee: 'us-ca.late_fee.reasonable',
  txDepositReturn: 'us-tx.deposit.return_30_days',
  entryNotice: 'us.notice.entry_24h',
} as const;

/** Insert any missing starter rule (platform-global). Used by API tests after the database is truncated. */
export async function ensureStarterRules(approvedBy: string | null = null): Promise<void> {
  for (const r of STARTER_RULES) {
    const existing = await prisma.complianceRule.findFirst({ where: { key: r.key, version: r.version }, select: { id: true } });
    if (!existing) await prisma.complianceRule.create({ data: { key: r.key, version: r.version, jurisdiction: r.jurisdiction, domain: r.domain, title: r.title, description: r.description, severity: r.severity, action: r.action, conditions: r.conditions as object, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, status: 'active', sourceUrl: r.sourceUrl, approvedBy } });
  }
}
