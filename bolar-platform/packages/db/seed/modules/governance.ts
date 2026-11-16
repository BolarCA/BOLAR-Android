/**
 * Governance demo seed (Days 46-50): one privileged eviction case on the seeded lease with the demo lawyer as
 * lead (represents relationship), an active legal hold on that case, an agency records request in legal review,
 * retention assignments for the seeded documents and one privacy access request in discovery.
 * Idempotent: every block looks up before it creates. Synthetic data only.
 */
import 'dotenv/config';
import { prisma } from '../../src/client.js';

export async function seedGovernanceDemo(orgId: string): Promise<void> {
  const lawyer = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'legal@demo.bolar.test' } });
  const gov = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'gov@demo.bolar.test' } });
  const manager = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } });
  if (!lawyer || !gov || !manager) return; // base seed not run yet
  const lease = await prisma.lease.findFirst({ where: { tenantOrgId: orgId, status: 'active' }, orderBy: { createdAt: 'asc' } });
  const party = lease ? await prisma.leaseParty.findFirst({ where: { tenantOrgId: orgId, leaseId: lease.id, role: 'primary' } }) : null;

  // Case (eviction) linked to the seeded lease; lead lawyer represents it.
  let legalCase = await prisma.case.findFirst({ where: { tenantOrgId: orgId, title: 'Maple Court 101 - non-payment (demo)' } });
  if (!legalCase) {
    const inTen = new Date(Date.now() + 10 * 86_400_000);
    const inThirty = new Date(Date.now() + 30 * 86_400_000);
    legalCase = await prisma.case.create({
      data: {
        tenantOrgId: orgId, title: 'Maple Court 101 - non-payment (demo)', kind: 'eviction', status: 'open', leaseId: lease?.id ?? null, propertyId: lease?.propertyId ?? null,
        tenantProfileId: party?.tenantProfileId ?? null, leadLawyerId: lawyer.id, privileged: true, createdBy: lawyer.id,
        deadlines: [
          { id: 'dl-demo-notice', title: 'Serve notice to cure or quit', dueAt: inTen.toISOString(), done: false },
          { id: 'dl-demo-filing', title: 'File petition if uncured', dueAt: inThirty.toISOString(), done: false },
        ],
      },
    });
  }
  const edge = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: orgId, subjectType: 'user', subjectId: lawyer.id, relation: 'represents', objectType: 'case', objectId: legalCase.id } });
  if (!edge) await prisma.relationshipEdge.create({ data: { tenantOrgId: orgId, subjectType: 'user', subjectId: lawyer.id, relation: 'represents', objectType: 'case', objectId: legalCase.id, grantedBy: lawyer.id } });

  // Active legal hold scoped to the case and its lease/property/tenant profile.
  const holdName = 'Hold: Maple Court 101 eviction (demo)';
  if (!(await prisma.legalHold.findFirst({ where: { tenantOrgId: orgId, name: holdName } }))) {
    const scope = { caseIds: [legalCase.id], ...(lease ? { leaseIds: [lease.id], propertyIds: [lease.propertyId] } : {}), ...(party ? { tenantProfileIds: [party.tenantProfileId] } : {}) };
    await prisma.legalHold.create({ data: { tenantOrgId: orgId, name: holdName, reason: 'Anticipated litigation: preserve lease file, ledger and communications for the eviction matter.', scopeJson: scope, status: 'active', approvedBy: lawyer.id, createdBy: lawyer.id } });
    if (lease) await prisma.document.updateMany({ where: { tenantOrgId: orgId, OR: [{ ownerType: 'lease', ownerId: lease.id }, { ownerType: 'case', ownerId: legalCase.id }] }, data: { legalHold: true } });
  }

  // Agency records request in legal review (submitted by the government persona).
  if (!(await prisma.agencyRequest.findFirst({ where: { tenantOrgId: orgId, agencyName: 'City Housing Authority (demo)' } }))) {
    await prisma.agencyRequest.create({
      data: {
        tenantOrgId: orgId, agencyName: 'City Housing Authority (demo)', requesterUserId: gov.id, kind: 'records', legalBasis: 'Municipal code 12.4 housing inspection records request; annual compliance review.',
        scopeJson: { propertyIds: lease ? [lease.propertyId] : [], description: 'Inspection history and current occupancy for the 2026 review period', dateFrom: '2026-01-01', dateTo: '2026-12-31' },
        status: 'legal_review', minimizationNotes: 'Limit to inspection records and unit occupancy counts; exclude tenant identities, payment history and screening data.', dueAt: new Date(Date.now() + 21 * 86_400_000),
      },
    });
  }

  // Retention assignments for the seeded documents.
  const docPolicy = await prisma.retentionPolicy.findFirst({ where: { tenantOrgId: null, key: 'documents.general' } });
  if (docPolicy) {
    const docs = await prisma.document.findMany({ where: { tenantOrgId: orgId, deletedAt: null }, select: { id: true, createdAt: true } });
    for (const d of docs) {
      await prisma.retentionAssignment.upsert({
        where: { tenantOrgId_resourceType_resourceId: { tenantOrgId: orgId, resourceType: 'document', resourceId: d.id } },
        update: {},
        create: { tenantOrgId: orgId, policyId: docPolicy.id, resourceType: 'document', resourceId: d.id, retainUntil: new Date(d.createdAt.getTime() + docPolicy.retainDays * 86_400_000), state: 'retained' },
      });
    }
  }
  const leasePolicy = await prisma.retentionPolicy.findFirst({ where: { tenantOrgId: null, key: 'lease.records' } });
  if (lease && leasePolicy) {
    await prisma.retentionAssignment.upsert({
      where: { tenantOrgId_resourceType_resourceId: { tenantOrgId: orgId, resourceType: 'lease', resourceId: lease.id } },
      update: {},
      create: { tenantOrgId: orgId, policyId: leasePolicy.id, resourceType: 'lease', resourceId: lease.id, retainUntil: new Date(lease.endDate.getTime() + leasePolicy.retainDays * 86_400_000), state: 'retained' },
    });
  }

  // Privacy access request already identity-verified and in discovery for the demo tenant.
  const subjectEmail = 'tenant@demo.bolar.test';
  if (!(await prisma.privacyRequest.findFirst({ where: { tenantOrgId: orgId, subjectEmail, kind: 'access' } }))) {
    const profile = await prisma.tenantProfile.findFirst({ where: { tenantOrgId: orgId, email: subjectEmail } });
    await prisma.privacyRequest.create({
      data: {
        tenantOrgId: orgId, kind: 'access', subjectEmail, subjectProfileId: profile?.id ?? null, status: 'discovery', identityVerifiedAt: new Date(Date.now() - 86_400_000), identityMethod: 'idme-mock',
        dueAt: new Date(Date.now() + 25 * 86_400_000),
        discoveryJson: {
          identity: { provider: 'idme', mode: 'mock', externalId: 'idme_mock_demo_seed', status: 'verified' },
          subjects: { userIds: [], tenantProfileIds: profile ? [profile.id] : [] },
          ids: { leaseIds: lease ? [lease.id] : [], documentIds: [], notificationIds: [] },
          counts: { tenantProfiles: profile ? 1 : 0, leases: lease ? 1 : 0, documents: 0, notifications: 0, auditLogs: 0 },
          discoveredAt: new Date().toISOString(),
        },
      },
    });
  }
}

// Standalone run (e2e and local dev): `pnpm --filter @bolar/db exec dotenv -e ../../.env -- tsx seed/modules/governance.ts`
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  prisma.tenantOrg.findFirst({ where: { slug: process.env.SEED_ORG_SLUG ?? 'demo-pm' } })
    .then(async (org) => {
      if (!org) throw new Error('demo org not found; run db:seed first');
      await seedGovernanceDemo(org.id);
      console.info(`[seed:governance] demo governance data seeded for ${org.slug}`);
      return prisma.$disconnect();
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
