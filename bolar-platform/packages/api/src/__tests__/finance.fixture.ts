import { twoTenantFixture, createUser, createUnit, relate, type OrgFixture } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { DEFAULT_CHART } from '../modules/finance/ledger/service.js';

/** Two orgs, each with a bookkeeper, a tenant on an active lease with a monthly rent charge, and a landlord owning the property. */
export async function financeFixture() {
  const fx = await twoTenantFixture();
  const books = { a: await createUser(fx.a, 'bookkeeper', 'books@alpha.test'), b: await createUser(fx.b, 'bookkeeper', 'books@beta.test') };
  const tenants = { a: await createUser(fx.a, 'tenant', 'tenant@alpha.test'), b: await createUser(fx.b, 'tenant', 'tenant@beta.test') };
  const strangerTenant = await createUser(fx.a, 'tenant', 'stranger@alpha.test');
  const landlord = await createUser(fx.a, 'landlord', 'owner@alpha.test');
  const vendor = await createUser(fx.a, 'vendor', 'vendor@alpha.test');
  await relate(fx.a, landlord.id, 'owner_of', 'property', fx.propA.id);
  const leaseA = await activeLease(fx.a, fx.propA.id, tenants.a.id, '101', 150000);
  const leaseB = await activeLease(fx.b, fx.propB.id, tenants.b.id, '101', 120000);
  // Org B chart is seeded directly; org A exercises POST /accounts/seed-default in the tests.
  await prisma.account.createMany({ data: DEFAULT_CHART.map((a) => ({ ...a, tenantOrgId: fx.b.id })) });
  return { ...fx, books, tenants, strangerTenant, landlord, vendor, leaseA, leaseB };
}

export function monthStart(offsetMonths: number): Date {
  const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}
export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function activeLease(org: OrgFixture, propertyId: string, tenantUserId: string, unitNumber: string, rentCents: number, status = 'active') {
  const unit = await createUnit(org, propertyId, unitNumber, rentCents);
  const start = monthStart(-6);
  const end = monthStart(6);
  const profile = await prisma.tenantProfile.create({ data: { tenantOrgId: org.id, userId: tenantUserId, displayName: `Tenant ${unitNumber} ${org.slug}`, status: 'active' } });
  const lease = await prisma.lease.create({ data: { tenantOrgId: org.id, propertyId, unitId: unit.id, status, startDate: start, endDate: end, rentCents, depositCents: rentCents, createdBy: tenantUserId } });
  await prisma.leaseParty.create({ data: { tenantOrgId: org.id, leaseId: lease.id, tenantProfileId: profile.id, role: 'primary', signedAt: start } });
  await prisma.recurringCharge.create({ data: { tenantOrgId: org.id, leaseId: lease.id, type: 'rent', amountCents: rentCents, cadence: 'monthly', accountCode: '4000' } });
  await relate(org, tenantUserId, 'tenant_of', 'lease', lease.id);
  return { lease, unit, profile };
}
