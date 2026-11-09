/**
 * Property module demo seed (Days 16-20). Builds on the properties/units created by seedDemo:
 * one building per property with every unit attached, plus unit status history for non-vacant units.
 * Idempotent; synthetic data only. Wired by the integrator: `await seedPropertyDemo(org.id)`.
 */
import { prisma } from '../../src/client.js';

export async function seedPropertyDemo(orgId: string): Promise<void> {
  const manager = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' }, select: { id: true } });
  const admin = manager ?? (await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId }, select: { id: true } }));
  if (!admin) return;

  const properties = await prisma.property.findMany({ where: { tenantOrgId: orgId }, include: { units: true } });
  for (const p of properties) {
    const building = (await prisma.building.findFirst({ where: { tenantOrgId: orgId, propertyId: p.id } })) ??
      (await prisma.building.create({ data: { tenantOrgId: orgId, propertyId: p.id, name: p.units.length > 4 ? 'Main building' : 'Building A', floors: p.units.length > 4 ? 2 : 1 } }));
    const unassigned = p.units.filter((u) => !u.buildingId).map((u) => u.id);
    if (unassigned.length) await prisma.unit.updateMany({ where: { tenantOrgId: orgId, id: { in: unassigned } }, data: { buildingId: building.id } });

    for (const u of p.units) {
      const hasHistory = await prisma.unitStatusHistory.findFirst({ where: { tenantOrgId: orgId, unitId: u.id }, select: { id: true } });
      if (hasHistory) continue;
      const created = new Date(u.createdAt);
      await prisma.unitStatusHistory.create({ data: { tenantOrgId: orgId, unitId: u.id, fromStatus: null, toStatus: 'vacant', changedBy: admin.id, reason: 'Unit onboarded', changedAt: created } });
      if (u.status === 'occupied') {
        await prisma.unitStatusHistory.create({ data: { tenantOrgId: orgId, unitId: u.id, fromStatus: 'vacant', toStatus: 'occupied', changedBy: admin.id, reason: 'Lease activated', changedAt: new Date(created.getTime() + 60_000) } });
      } else if (u.status === 'notice') {
        await prisma.unitStatusHistory.create({ data: { tenantOrgId: orgId, unitId: u.id, fromStatus: 'vacant', toStatus: 'occupied', changedBy: admin.id, reason: 'Lease activated', changedAt: new Date(created.getTime() + 60_000) } });
        await prisma.unitStatusHistory.create({ data: { tenantOrgId: orgId, unitId: u.id, fromStatus: 'occupied', toStatus: 'notice', changedBy: admin.id, reason: 'Tenant gave 30-day notice', changedAt: new Date(created.getTime() + 120_000) } });
      } else if (u.status !== 'vacant') {
        await prisma.unitStatusHistory.create({ data: { tenantOrgId: orgId, unitId: u.id, fromStatus: 'vacant', toStatus: u.status, changedBy: admin.id, reason: 'Seeded status', changedAt: new Date(created.getTime() + 60_000) } });
      }
    }
  }
}
