import type { Permission, Role, ScopeType } from './rbac.js';
import type { Classification, AccessPurpose } from './classification.js';

export interface Actor {
  userId: string;
  email: string;
  name: string;
  /** Platform-level actor (platform_admin / support_agent) can act across orgs with audit. */
  isPlatform: boolean;
  mfaVerified: boolean;
}

export interface ScopedRole {
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
}

/** Everything a handler needs. Built by middleware; never constructed from request body. */
export interface RequestContext {
  requestId: string;
  actor: Actor | null;
  tenantOrgId: string | null;
  roles: ScopedRole[];
  permissions: Set<Permission>;
  purpose: AccessPurpose | null;
  /** Highest classification cleared by an approved sensitive access request, cached per request. */
  clearedClassification: Classification;
  /** Support session id if a platform agent is acting on behalf of a tenant org. */
  supportSessionId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function systemContext(tenantOrgId: string | null, requestId = `sys_${Date.now()}`): RequestContext {
  return {
    requestId,
    actor: null,
    tenantOrgId,
    roles: [],
    permissions: new Set(),
    purpose: null,
    clearedClassification: 'internal',
    supportSessionId: null,
    ip: null,
    userAgent: null,
  };
}
