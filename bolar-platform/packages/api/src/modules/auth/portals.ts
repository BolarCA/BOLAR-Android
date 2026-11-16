import type { Role } from '@bolar/shared';

/** Portal routes a role may enter (blueprint pages 37-47). Used by web nav and route-matrix tests. */
export const ROLE_PORTALS: Record<Role, string[]> = {
  platform_admin: ['/admin'],
  support_agent: ['/admin'],
  org_admin: ['/subaccount', '/manager', '/owner', '/finance', '/compliance'],
  subaccount_admin: ['/subaccount', '/manager'],
  landlord: ['/owner'],
  property_manager: ['/manager'],
  tenant: ['/tenant'],
  corp_admin: ['/corporate-admin'],
  occupant: ['/occupant'],
  bookkeeper: ['/finance'],
  lawyer: ['/legal'],
  vendor: ['/vendor'],
  government: ['/gov'],
  compliance_officer: ['/compliance'],
};
/** Canonical order: the first entry is the default landing portal after login. */
export const PORTAL_ORDER = ['/admin', '/subaccount', '/manager', '/owner', '/finance', '/compliance', '/legal', '/tenant', '/corporate-admin', '/occupant', '/vendor', '/gov'];
export function portalsFor(roles: readonly Role[]): string[] {
  const set = new Set(roles.flatMap((r) => ROLE_PORTALS[r] ?? []));
  return PORTAL_ORDER.filter((p) => set.has(p));
}
