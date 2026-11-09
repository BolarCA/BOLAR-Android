/**
 * RBAC catalog (blueprint p15, Day 12). Roles are assigned within a scope.
 * Scope types: platform | org | subaccount | property | case
 */
export const SCOPE_TYPES = ['platform', 'org', 'subaccount', 'property', 'case'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const ROLES = [
  'platform_admin',
  'org_admin',
  'subaccount_admin',
  'landlord',
  'property_manager',
  'tenant',
  'corp_admin',
  'occupant',
  'bookkeeper',
  'lawyer',
  'vendor',
  'government',
  'compliance_officer',
  'support_agent',
] as const;
export type Role = (typeof ROLES)[number];

/** Permission keys: `<resource>:<action>` */
export const PERMISSIONS = [
  // platform / org
  'platform:admin',
  'org:read',
  'org:write',
  'subaccount:read',
  'subaccount:write',
  'user:read',
  'user:invite',
  'user:write',
  'role:read',
  'role:assign',
  'relationship:read',
  'relationship:write',
  'sensitive_access:request',
  'sensitive_access:approve',
  'audit:read',
  'audit:read_sensitive',
  'feature_flag:write',
  'support_session:start',
  // property
  'property:read',
  'property:write',
  'unit:read',
  'unit:write',
  // tenancy
  'tenant_profile:read',
  'tenant_profile:write',
  'tenant_profile:read_sensitive',
  'application:read',
  'application:write',
  'screening:order',
  'screening:read_report',
  'adverse_action:manage',
  'lease:read',
  'lease:write',
  'lease:approve',
  'lease:send',
  // documents
  'document:read',
  'document:write',
  'document:read_restricted',
  'media:read',
  'media:write',
  'template:read',
  'template:write',
  'template:approve',
  'notification:send',
  // maintenance
  'maintenance:request',
  'work_order:read',
  'work_order:write',
  'work_order:assign',
  'work_order:vendor_update',
  'vendor:read',
  'vendor:write',
  // finance
  'finance:read',
  'finance:write',
  'finance:post',
  'finance:approve_adjustment',
  'payment:read',
  'payment:collect',
  'bank:read',
  // compliance / governance
  'compliance:read',
  'compliance:write',
  'compliance:approve',
  'notice:draft',
  'notice:approve',
  'retention:read',
  'retention:write',
  'privacy_request:read',
  'privacy_request:write',
  'privacy_request:approve',
  'legal_hold:read',
  'legal_hold:write',
  'legal_hold:release',
  'case:read',
  'case:write',
  'agency_request:read',
  'agency_request:write',
  'agency_request:approve',
  'export:request',
  'export:approve',
  // ai
  'ai:use',
  'ai:audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS as readonly Permission[];
const readOnly = (prefixes: string[]): Permission[] =>
  ALL.filter((p) => prefixes.some((pre) => p.startsWith(pre + ':')) && p.endsWith(':read'));

/** Default role -> permission matrix. Seeded by Day 12; mirrored in seed/rbac_seed.json. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  platform_admin: ALL,
  org_admin: ALL.filter((p) => p !== 'platform:admin' && p !== 'feature_flag:write'),
  subaccount_admin: [
    'org:read', 'subaccount:read', 'subaccount:write', 'user:read', 'user:invite', 'user:write',
    'role:read', 'role:assign', 'relationship:read', 'relationship:write', 'audit:read',
    'sensitive_access:request', 'sensitive_access:approve',
    'property:read', 'property:write', 'unit:read', 'unit:write',
    'tenant_profile:read', 'tenant_profile:write', 'application:read', 'application:write',
    'lease:read', 'lease:write', 'lease:approve', 'lease:send',
    'document:read', 'document:write', 'media:read', 'media:write', 'template:read', 'template:write',
    'notification:send', 'work_order:read', 'work_order:write', 'work_order:assign', 'vendor:read', 'vendor:write',
    'finance:read', 'payment:read', 'compliance:read', 'compliance:write', 'notice:draft',
    'retention:read', 'privacy_request:read', 'legal_hold:read', 'case:read', 'export:request', 'ai:use',
  ],
  landlord: [
    'org:read', 'property:read', 'unit:read', 'tenant_profile:read', 'lease:read', 'lease:approve',
    'document:read', 'media:read', 'work_order:read', 'vendor:read', 'finance:read', 'payment:read',
    'compliance:read', 'sensitive_access:request', 'ai:use',
  ],
  property_manager: [
    'org:read', 'subaccount:read', 'user:read', 'user:invite', 'relationship:read', 'relationship:write',
    'sensitive_access:request',
    'property:read', 'property:write', 'unit:read', 'unit:write',
    'tenant_profile:read', 'tenant_profile:write', 'application:read', 'application:write', 'screening:order',
    'adverse_action:manage', 'lease:read', 'lease:write', 'lease:send',
    'document:read', 'document:write', 'media:read', 'media:write', 'template:read', 'template:write', 'notification:send',
    'maintenance:request', 'work_order:read', 'work_order:write', 'work_order:assign', 'vendor:read', 'vendor:write',
    'finance:read', 'payment:read', 'compliance:read', 'compliance:write', 'notice:draft',
    'retention:read', 'privacy_request:read', 'privacy_request:write', 'legal_hold:read', 'case:read', 'ai:use',
  ],
  tenant: ['lease:read', 'document:read', 'media:read', 'media:write', 'maintenance:request', 'work_order:read', 'payment:read', 'payment:collect', 'finance:read', 'privacy_request:write', 'ai:use'],
  corp_admin: ['org:read', 'tenant_profile:read', 'tenant_profile:write', 'lease:read', 'document:read', 'finance:read', 'payment:read', 'compliance:read', 'user:invite', 'ai:use'],
  occupant: ['lease:read', 'document:read', 'maintenance:request', 'work_order:read', 'ai:use'],
  bookkeeper: ['org:read', 'property:read', 'unit:read', 'lease:read', 'finance:read', 'finance:write', 'finance:post', 'payment:read', 'bank:read', 'document:read', 'export:request', 'audit:read', 'ai:use'],
  lawyer: ['org:read', 'property:read', 'lease:read', 'tenant_profile:read', 'document:read', 'document:read_restricted', 'compliance:read', 'compliance:approve', 'notice:approve', 'template:approve',
    'retention:read', 'privacy_request:read', 'privacy_request:approve', 'legal_hold:read', 'legal_hold:write', 'legal_hold:release',
    'case:read', 'case:write', 'agency_request:read', 'agency_request:write', 'agency_request:approve', 'export:request', 'export:approve', 'audit:read', 'audit:read_sensitive', 'sensitive_access:request', 'sensitive_access:approve', 'ai:use'],
  vendor: ['work_order:read', 'work_order:vendor_update', 'media:read', 'media:write', 'document:read'],
  government: ['agency_request:read', 'agency_request:write', 'export:request'],
  compliance_officer: [
    'org:read', 'property:read', 'unit:read', 'lease:read', 'tenant_profile:read', 'application:read', 'document:read',
    'compliance:read', 'compliance:write', 'compliance:approve', 'notice:draft', 'notice:approve', 'template:approve',
    'retention:read', 'retention:write', 'privacy_request:read', 'privacy_request:write', 'legal_hold:read',
    'audit:read', 'export:request', 'sensitive_access:request', 'sensitive_access:approve', 'ai:use', 'ai:audit',
  ],
  support_agent: [...readOnly(['org', 'subaccount', 'user', 'property', 'unit', 'lease', 'work_order']), 'support_session:start', 'audit:read'],
};

/** Which scope types a role may be assigned in. */
export const ROLE_SCOPES: Record<Role, readonly ScopeType[]> = {
  platform_admin: ['platform'],
  org_admin: ['org'],
  subaccount_admin: ['subaccount'],
  landlord: ['org', 'subaccount', 'property'],
  property_manager: ['org', 'subaccount', 'property'],
  tenant: ['org'],
  corp_admin: ['org', 'subaccount'],
  occupant: ['org'],
  bookkeeper: ['org', 'subaccount'],
  lawyer: ['org', 'case'],
  vendor: ['org'],
  government: ['org'],
  compliance_officer: ['org', 'subaccount'],
  support_agent: ['platform'],
};

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  return set;
}

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}
export function isPermission(v: string): v is Permission {
  return (ALL as readonly string[]).includes(v);
}
