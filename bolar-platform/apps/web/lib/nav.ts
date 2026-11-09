export interface NavItem { label: string; href: string; permission?: string }
export interface PortalDef { key: string; base: string; title: string; description: string; roles: string[]; nav: NavItem[] }

/** Portal registry (blueprint pages 37-47). Role gating mirrors packages/api/src/modules/auth/portals.ts. */
export const PORTALS: PortalDef[] = [
  { key: 'admin', base: '/admin', title: 'Master admin', description: 'Platform health, orgs, global audit, support sessions, feature flags.', roles: ['platform_admin', 'support_agent'],
    nav: [{ label: 'Overview', href: '/admin' }, { label: 'Organizations', href: '/admin/orgs', permission: 'platform:admin' }, { label: 'Users', href: '/admin/users', permission: 'user:read' }, { label: 'Audit', href: '/admin/audit', permission: 'audit:read' }, { label: 'Feature flags', href: '/admin/feature-flags', permission: 'feature_flag:write' }, { label: 'Support sessions', href: '/admin/support-sessions', permission: 'support_session:start' }, { label: 'AI audit', href: '/admin/ai-audit', permission: 'ai:audit' }] },
  { key: 'subaccount', base: '/subaccount', title: 'Subaccount admin', description: 'Staff, roles, properties, reports, operational settings, scoped audit.', roles: ['org_admin', 'subaccount_admin'],
    nav: [{ label: 'Overview', href: '/subaccount' }, { label: 'Staff & roles', href: '/subaccount/users', permission: 'user:read' }, { label: 'Access requests', href: '/subaccount/access-requests', permission: 'sensitive_access:request' }, { label: 'Privacy requests', href: '/subaccount/privacy-requests', permission: 'privacy_request:read' }, { label: 'Retention', href: '/subaccount/retention', permission: 'retention:read' }, { label: 'Audit', href: '/subaccount/audit', permission: 'audit:read' }] },
  { key: 'owner', base: '/owner', title: 'Landlord', description: 'Portfolio, occupancy, income, approvals, documents, property performance.', roles: ['landlord', 'org_admin'],
    nav: [{ label: 'Dashboard', href: '/owner' }, { label: 'Properties', href: '/owner/properties', permission: 'property:read' }, { label: 'Approvals', href: '/owner/approvals', permission: 'lease:approve' }, { label: 'Documents', href: '/owner/documents', permission: 'document:read' }] },
  { key: 'manager', base: '/manager', title: 'Property manager', description: 'Daily operations, work orders, leases, tenants, vendors, notices, reporting.', roles: ['property_manager', 'org_admin', 'subaccount_admin'],
    nav: [{ label: 'Operations', href: '/manager' }, { label: 'Properties', href: '/manager/properties', permission: 'property:read' }, { label: 'Tenants', href: '/manager/tenants', permission: 'tenant_profile:read' }, { label: 'Leases', href: '/manager/leases', permission: 'lease:read' }, { label: 'Applications', href: '/manager/applications', permission: 'application:read' }, { label: 'Notices', href: '/manager/notices', permission: 'notice:draft' }, { label: 'Maintenance', href: '/manager/maintenance', permission: 'work_order:read' }, { label: 'Vendors', href: '/manager/vendors', permission: 'vendor:read' }, { label: 'Documents', href: '/manager/documents', permission: 'document:read' }, { label: 'Templates', href: '/manager/templates', permission: 'template:read' }] },
  { key: 'tenant', base: '/tenant', title: 'Resident', description: 'Rent, lease, documents, messages, maintenance, notices, profile.', roles: ['tenant'],
    nav: [{ label: 'Home', href: '/tenant' }, { label: 'Pay rent', href: '/tenant/pay' }, { label: 'Maintenance', href: '/tenant/maintenance' }, { label: 'Documents', href: '/tenant/documents' }, { label: 'Profile', href: '/tenant/profile' }] },
  { key: 'corporate-admin', base: '/corporate-admin', title: 'Corporate tenant admin', description: 'Employee housing, occupant invites, spend tracking, policy compliance.', roles: ['corp_admin'],
    nav: [{ label: 'Overview', href: '/corporate-admin' }, { label: 'Occupants', href: '/corporate-admin/occupants' }, { label: 'Spend', href: '/corporate-admin/spend' }] },
  { key: 'occupant', base: '/occupant', title: 'Occupant', description: 'Housing status, support, documents, requests, move in/out.', roles: ['occupant'],
    nav: [{ label: 'Home', href: '/occupant' }, { label: 'Requests', href: '/occupant/requests' }, { label: 'Documents', href: '/occupant/documents' }] },
  { key: 'finance', base: '/finance', title: 'Bookkeeper', description: 'Invoices, payments, ledger, reconciliation, exports, reports.', roles: ['bookkeeper', 'org_admin'],
    nav: [{ label: 'Dashboard', href: '/finance' }, { label: 'Invoices', href: '/finance/invoices', permission: 'finance:read' }, { label: 'Payments', href: '/finance/payments', permission: 'payment:read' }, { label: 'Ledger', href: '/finance/ledger', permission: 'finance:read' }] },
  { key: 'legal', base: '/legal', title: 'Lawyer', description: 'Cases, privileged threads, documents, deadlines, evidence packets.', roles: ['lawyer'],
    nav: [{ label: 'Cases', href: '/legal' }, { label: 'Legal holds', href: '/legal/legal-holds', permission: 'legal_hold:read' }, { label: 'Privacy requests', href: '/legal/privacy-requests', permission: 'privacy_request:read' }, { label: 'Access approvals', href: '/legal/access-requests', permission: 'sensitive_access:approve' }] },
  { key: 'vendor', base: '/vendor', title: 'Vendor', description: 'Assigned jobs, schedule, photos, invoices, warranty documents.', roles: ['vendor'],
    nav: [{ label: 'My jobs', href: '/vendor' }, { label: 'Schedule', href: '/vendor/schedule' }, { label: 'Documents', href: '/vendor/documents' }] },
  { key: 'gov', base: '/gov', title: 'Government (restricted)', description: 'Agency requests, stored data gate, exports, audit manifest, limited access.', roles: ['government'],
    nav: [{ label: 'Requests', href: '/gov' }, { label: 'Exports', href: '/gov/exports' }] },
  { key: 'compliance', base: '/compliance', title: 'Compliance', description: 'Review queue, rules, notices, remediation, evidence.', roles: ['compliance_officer', 'org_admin'],
    nav: [{ label: 'Queue', href: '/compliance' }, { label: 'Rules', href: '/compliance/rules', permission: 'compliance:read' }, { label: 'Notices', href: '/compliance/notices', permission: 'notice:draft' }, { label: 'AI audit', href: '/compliance/ai-audit', permission: 'ai:audit' }] },
];

export function portalForPath(pathname: string): PortalDef | undefined {
  return PORTALS.find((p) => pathname === p.base || pathname.startsWith(p.base + '/'));
}
export function portalsForRoles(roles: string[]): PortalDef[] {
  return PORTALS.filter((p) => p.roles.some((r) => roles.includes(r)));
}
