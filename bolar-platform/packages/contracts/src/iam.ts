import { z } from './openapi-zod.js';
import { emailSchema, idSchema, pageOf, classificationSchema, purposeSchema } from './common.js';
import { ROLES, SCOPE_TYPES, RELATIONS, SUBJECT_TYPES, OBJECT_TYPES, PERMISSIONS } from '@bolar/shared';

export const userProfile = z
  .object({ id: idSchema, email: z.string(), name: z.string(), status: z.string(), mfaEnabled: z.boolean(), lastLoginAt: z.string().nullable(), createdAt: z.string(), roles: z.array(z.object({ role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES), scopeId: idSchema.nullable() })) })
  .openapi('UserProfile');
export const userPage = pageOf(userProfile, 'UserProfile');
export const updateUser = z.object({ name: z.string().min(1).max(120).optional(), status: z.enum(['active', 'suspended', 'deactivated']).optional() }).openapi('UpdateUser');

export const invitation = z
  .object({ id: idSchema, email: z.string(), role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES), scopeId: idSchema.nullable(), status: z.enum(['pending', 'accepted', 'expired', 'revoked']), expiresAt: z.string(), createdAt: z.string() })
  .openapi('Invitation');
export const invitationPage = pageOf(invitation, 'Invitation');
export const createInvitation = z
  .object({ email: emailSchema, role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES).default('org'), scopeId: idSchema.optional() })
  .openapi('CreateInvitation');
export const createInvitationResponse = invitation.extend({ acceptUrl: z.string().optional() }).openapi('CreateInvitationResponse');
export const acceptInvitation = z.object({ token: z.string().min(16), name: z.string().min(1).max(120), password: z.string().min(12).max(256) }).openapi('AcceptInvitation');

export const roleAssignment = z.object({ id: idSchema, userId: idSchema, role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES), scopeId: idSchema.nullable(), createdAt: z.string() }).openapi('RoleAssignment');
export const assignRole = z.object({ userId: idSchema, role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES), scopeId: idSchema.optional() }).openapi('AssignRole');
export const permissionCatalog = z.object({ permissions: z.array(z.enum(PERMISSIONS)), roles: z.record(z.enum(ROLES), z.array(z.enum(PERMISSIONS))) }).openapi('PermissionCatalog');

export const relationship = z
  .object({ id: idSchema, subjectType: z.enum(SUBJECT_TYPES), subjectId: idSchema, relation: z.enum(RELATIONS), objectType: z.enum(OBJECT_TYPES), objectId: idSchema, startsAt: z.string().nullable(), endsAt: z.string().nullable(), createdAt: z.string() })
  .openapi('Relationship');
export const relationshipPage = pageOf(relationship, 'Relationship');
export const createRelationship = z
  .object({ subjectType: z.enum(SUBJECT_TYPES).default('user'), subjectId: idSchema, relation: z.enum(RELATIONS), objectType: z.enum(OBJECT_TYPES), objectId: idSchema, startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional() })
  .openapi('CreateRelationship');
export const relationshipQuery = z.object({ subjectId: idSchema.optional(), objectType: z.enum(OBJECT_TYPES).optional(), objectId: idSchema.optional(), relation: z.enum(RELATIONS).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });

export const accessCheckRequest = z
  .object({ permission: z.enum(PERMISSIONS), resourceType: z.enum(OBJECT_TYPES).optional(), resourceId: idSchema.optional(), propertyId: idSchema.optional() })
  .openapi('AccessCheckRequest');
export const accessCheckResponse = z.object({ allowed: z.boolean(), reason: z.string(), via: z.enum(['role', 'relationship', 'denied']) }).openapi('AccessCheckResponse');

export const sensitiveAccessRequest = z
  .object({ id: idSchema, actorId: idSchema, resourceType: z.string(), resourceId: z.string(), classification: classificationSchema, purpose: purposeSchema, justification: z.string(), status: z.enum(['pending', 'approved', 'denied', 'expired', 'revoked']), approvedBy: idSchema.nullable(), expiresAt: z.string().nullable(), createdAt: z.string() })
  .openapi('SensitiveAccessRequest');
export const sensitiveAccessPage = pageOf(sensitiveAccessRequest, 'SensitiveAccessRequest');
export const createSensitiveAccessRequest = z
  .object({ resourceType: z.string().min(1).max(64), resourceId: z.string().min(1).max(64), classification: z.enum(['confidential', 'restricted']), purpose: purposeSchema, justification: z.string().min(10).max(2000) })
  .openapi('CreateSensitiveAccessRequest');
export const decideSensitiveAccess = z.object({ decision: z.enum(['approved', 'denied']), ttlHours: z.number().int().min(1).max(72).default(8), note: z.string().max(1000).optional() }).openapi('DecideSensitiveAccess');

export const auditLog = z
  .object({ id: idSchema, actorId: idSchema.nullable(), action: z.string(), resourceType: z.string(), resourceId: z.string().nullable(), outcome: z.string(), requestId: z.string(), purpose: z.string().nullable(), policyVersion: z.string().nullable(), before: z.unknown().nullable(), after: z.unknown().nullable(), metadata: z.unknown().nullable(), createdAt: z.string() })
  .openapi('AuditLog');
export const auditPage = pageOf(auditLog, 'AuditLog');
export const auditQuery = z.object({ actorId: idSchema.optional(), action: z.string().optional(), resourceType: z.string().optional(), resourceId: z.string().optional(), outcome: z.enum(['allow', 'deny', 'review_required', 'error']).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });
