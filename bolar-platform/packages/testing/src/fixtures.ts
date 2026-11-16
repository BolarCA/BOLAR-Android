import { prisma, hashPassword, truncateAll } from '@bolar/db';
import type { Role } from '@bolar/shared';

export const TEST_PASSWORD = 'Test!Password2026';

export interface OrgFixture { id: string; slug: string; name: string }
export interface UserFixture { id: string; email: string; name: string; orgId: string; role: Role }

export async function resetDatabase(): Promise<void> {
  await truncateAll(prisma);
}

export async function createOrg(slug: string, name = `${slug} org`): Promise<OrgFixture> {
  const org = await prisma.tenantOrg.create({ data: { slug, name } });
  const ba = await prisma.businessAccount.create({ data: { tenantOrgId: org.id, name: `${name} LLC` } });
  await prisma.subaccount.create({ data: { tenantOrgId: org.id, businessAccountId: ba.id, name: 'Default' } });
  return { id: org.id, slug: org.slug, name: org.name };
}

let pwdCache: string | null = null;
export async function createUser(org: OrgFixture, role: Role, email?: string, opts: { scopeType?: string; scopeId?: string | null; isPlatform?: boolean; mfaEnabled?: boolean } = {}): Promise<UserFixture> {
  pwdCache ??= await hashPassword(TEST_PASSWORD);
  const e = email ?? `${role}.${Math.random().toString(36).slice(2, 8)}@${org.slug}.test`;
  const user = await prisma.userProfile.create({ data: { tenantOrgId: org.id, email: e, name: `${role} user`, passwordHash: pwdCache, isPlatform: opts.isPlatform ?? false, mfaEnabled: opts.mfaEnabled ?? false } });
  await prisma.roleAssignment.create({ data: { tenantOrgId: org.id, userId: user.id, role, scopeType: opts.scopeType ?? (role === 'platform_admin' || role === 'support_agent' ? 'platform' : 'org'), scopeId: opts.scopeId === undefined ? (role === 'platform_admin' || role === 'support_agent' ? null : org.id) : opts.scopeId } });
  return { id: user.id, email: e, name: user.name, orgId: org.id, role };
}

export async function createProperty(org: OrgFixture, overrides: Partial<{ name: string; city: string; state: string; subaccountId: string | null; ownerUserId: string | null; portfolioId: string | null }> = {}) {
  return prisma.property.create({ data: { tenantOrgId: org.id, name: overrides.name ?? 'Maple Court', addressLine1: '100 Maple St', city: overrides.city ?? 'Austin', state: overrides.state ?? 'TX', postalCode: '78701', subaccountId: overrides.subaccountId ?? null, ownerUserId: overrides.ownerUserId ?? null, portfolioId: overrides.portfolioId ?? null } });
}

export async function createUnit(org: OrgFixture, propertyId: string, unitNumber = '101', targetRentCents = 150000) {
  return prisma.unit.create({ data: { tenantOrgId: org.id, propertyId, unitNumber, targetRentCents } });
}

export async function relate(org: OrgFixture, subjectId: string, relation: string, objectType: string, objectId: string) {
  return prisma.relationshipEdge.create({ data: { tenantOrgId: org.id, subjectType: 'user', subjectId, relation, objectType, objectId } });
}

/** Two orgs with overlapping names and one user per role each (Day 10 fixture). */
export async function twoTenantFixture() {
  await resetDatabase();
  const a = await createOrg('alpha-pm', 'Northside Property Management');
  const b = await createOrg('beta-pm', 'Northside Property Management');
  const admins = { a: await createUser(a, 'org_admin', 'admin@alpha.test'), b: await createUser(b, 'org_admin', 'admin@beta.test') };
  const managers = { a: await createUser(a, 'property_manager', 'pm@alpha.test'), b: await createUser(b, 'property_manager', 'pm@beta.test') };
  const propA = await createProperty(a, { name: 'Shared Name Tower' });
  const propB = await createProperty(b, { name: 'Shared Name Tower' });
  return { a, b, admins, managers, propA, propB };
}
