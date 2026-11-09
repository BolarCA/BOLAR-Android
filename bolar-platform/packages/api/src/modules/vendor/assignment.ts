import { CATEGORY_TRADES, type AssignmentReason, type WorkOrderCategory } from '@bolar/contracts';

export interface VendorForAssignment {
  status: string;
  trades: unknown;
  coverageJson: unknown;
  insuranceExpiresAt: Date | null;
  budgetLimitCents: number | null;
  userId: string | null;
}
export interface WorkOrderForAssignment {
  category: string;
  propertyId: string;
  estimateCents: number | null;
}

export function vendorTrades(v: { trades: unknown }): string[] {
  return Array.isArray(v.trades) ? v.trades.map(String) : [];
}
export function vendorCoveragePropertyIds(v: { coverageJson: unknown }): string[] {
  const c = v.coverageJson as { propertyIds?: unknown } | null;
  return c && Array.isArray(c.propertyIds) ? c.propertyIds.map(String) : [];
}

export function insuranceStatus(expiresAt: Date | null, now = new Date()): 'missing' | 'valid' | 'expiring' | 'expired' {
  if (!expiresAt) return 'missing';
  if (expiresAt.getTime() <= now.getTime()) return 'expired';
  if (expiresAt.getTime() - now.getTime() < 30 * 86_400_000) return 'expiring';
  return 'valid';
}

/**
 * Assignment rules (Day 33 "assignment checks by property/trade/approval/budget" + insurance).
 * Returns every failing reason so the UI can explain why a vendor is ineligible.
 */
export function evaluateAssignment(vendor: VendorForAssignment, wo: WorkOrderForAssignment, now = new Date()): { eligible: boolean; reasons: AssignmentReason[] } {
  const reasons: AssignmentReason[] = [];
  if (vendor.status !== 'approved') reasons.push('vendor_not_approved');
  const allowedTrades = CATEGORY_TRADES[wo.category as WorkOrderCategory] ?? [];
  const trades = vendorTrades(vendor);
  if (allowedTrades.length > 0 && !trades.some((t) => (allowedTrades as readonly string[]).includes(t))) reasons.push('trade_mismatch');
  const coverage = vendorCoveragePropertyIds(vendor);
  if (coverage.length > 0 && !coverage.includes(wo.propertyId)) reasons.push('outside_coverage');
  const ins = insuranceStatus(vendor.insuranceExpiresAt, now);
  if (ins === 'missing') reasons.push('insurance_missing');
  if (ins === 'expired') reasons.push('insurance_expired');
  if (vendor.budgetLimitCents !== null && wo.estimateCents !== null && wo.estimateCents > vendor.budgetLimitCents) reasons.push('over_budget');
  return { eligible: reasons.length === 0, reasons };
}
