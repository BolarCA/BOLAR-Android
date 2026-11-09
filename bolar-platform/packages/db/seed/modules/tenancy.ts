/**
 * Tenancy demo seed (Days 21-25): a second (applicant) tenant profile with contact/emergency/occupant rows and a
 * lease awaiting approval on Maple Court 102 so the landlord approvals queue has work. Idempotent; synthetic data only.
 * Wired by the integrator from seed/demo-data.ts after the base demo seed.
 */
import { prisma } from '../../src/client.js';

export async function seedTenancyDemo(orgId: string): Promise<void> {
  const manager = await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } });
  const maple = await prisma.property.findFirst({ where: { tenantOrgId: orgId, name: 'Maple Court Apartments' } });
  if (!maple) return; // base demo seed has not run yet
  const unit102 = await prisma.unit.findFirst({ where: { tenantOrgId: orgId, propertyId: maple.id, unitNumber: '102' } });
  if (!unit102) return;

  const applicant =
    (await prisma.tenantProfile.findFirst({ where: { tenantOrgId: orgId, email: 'ava.applicant@demo.bolar.test' } })) ??
    (await prisma.tenantProfile.create({
      data: { tenantOrgId: orgId, displayName: 'Ava Applicant', email: 'ava.applicant@demo.bolar.test', phone: '+15125550142', status: 'applicant', kind: 'individual', classification: 'restricted', dateOfBirth: new Date('1991-04-12T00:00:00Z'), ssnLast4: '1234', notes: 'Relocating for work; requested a 12-month term starting next month.' },
    }));
  if ((await prisma.contactMethod.count({ where: { tenantOrgId: orgId, tenantProfileId: applicant.id } })) === 0) {
    await prisma.contactMethod.createMany({
      data: [
        { tenantOrgId: orgId, tenantProfileId: applicant.id, kind: 'email', value: 'ava.applicant@demo.bolar.test', isPrimary: true },
        { tenantOrgId: orgId, tenantProfileId: applicant.id, kind: 'phone', value: '+15125550142', isPrimary: true },
      ],
    });
  }
  if ((await prisma.emergencyContact.count({ where: { tenantOrgId: orgId, tenantProfileId: applicant.id } })) === 0) {
    await prisma.emergencyContact.create({ data: { tenantOrgId: orgId, tenantProfileId: applicant.id, name: 'Eli Applicant', relationship: 'sibling', phone: '+15125550143' } });
  }
  if ((await prisma.occupant.count({ where: { tenantOrgId: orgId, tenantProfileId: applicant.id } })) === 0) {
    await prisma.occupant.create({ data: { tenantOrgId: orgId, tenantProfileId: applicant.id, name: 'Nova Applicant', relationship: 'child', isMinor: true } });
  }

  const existing = await prisma.lease.findFirst({ where: { tenantOrgId: orgId, unitId: unit102.id, status: { in: ['draft', 'review', 'approved', 'sent', 'signed', 'active', 'renewal'] } } });
  if (existing) return;
  const start = new Date(); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() + 1); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(end.getUTCDate() - 1);
  const lease = await prisma.lease.create({ data: { tenantOrgId: orgId, propertyId: maple.id, unitId: unit102.id, status: 'review', startDate: start, endDate: end, rentCents: 160000, depositCents: 160000, createdBy: manager.id, templateKey: 'lease.residential.tx' } });
  await prisma.leaseParty.create({ data: { tenantOrgId: orgId, leaseId: lease.id, tenantProfileId: applicant.id, role: 'primary' } });
  await prisma.recurringCharge.createMany({
    data: [
      { tenantOrgId: orgId, leaseId: lease.id, type: 'rent', amountCents: 160000, cadence: 'monthly', startsOn: start, endsOn: end, accountCode: '4000' },
      { tenantOrgId: orgId, leaseId: lease.id, type: 'parking', amountCents: 7500, cadence: 'monthly', startsOn: start, endsOn: end, accountCode: '4200' },
    ],
  });
  const version = await prisma.leaseVersion.create({ data: { tenantOrgId: orgId, leaseId: lease.id, version: 1, termsJson: { rentCents: 160000, depositCents: 160000, term: '12 months', pets: 'one cat, $25/month', parking: 'one reserved space', utilities: 'tenant pays electric and internet', lateFee: '$75 after the 5th' }, createdBy: manager.id } });
  await prisma.lease.update({ where: { id: lease.id }, data: { currentVersionId: version.id } });
  await prisma.auditLog.createMany({
    data: [
      { tenantOrgId: orgId, actorId: manager.id, action: 'lease.create', resourceType: 'lease', resourceId: lease.id, outcome: 'allow', requestId: `seed_${lease.id}_create`, after: { propertyId: maple.id, unitId: unit102.id, rentCents: 160000 } },
      { tenantOrgId: orgId, actorId: manager.id, action: 'lease.transition', resourceType: 'lease', resourceId: lease.id, outcome: 'allow', requestId: `seed_${lease.id}_review`, before: { status: 'draft' }, after: { status: 'review' }, metadata: { from: 'draft', to: 'review', note: null, system: false } },
    ],
  });
}
