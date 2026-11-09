/**
 * Maintenance demo seed (Days 31-35). Builds on seedDemo's work orders and vendor: adds a timeline
 * (WorkOrderEvents) for each seeded order, an overdue normal-priority order for SLA/escalation QA, and a
 * second, suspended vendor so the rolodex and eligibility reasons have something to show. Idempotent.
 * Wired by the integrator: `await seedMaintenanceDemo(org.id)` after seedDemo().
 */
import { prisma } from '../../src/client.js';

const DAY = 86_400_000;

export async function seedMaintenanceDemo(orgId: string): Promise<void> {
  const manager = await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } });
  const tenant = await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: orgId, email: 'tenant@demo.bolar.test' } });
  const vendorUser = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'vendor@demo.bolar.test' } });
  const maple = await prisma.property.findFirstOrThrow({ where: { tenantOrgId: orgId, name: 'Maple Court Apartments' } });
  const unit102 = await prisma.unit.findFirst({ where: { tenantOrgId: orgId, propertyId: maple.id, unitNumber: '102' } });

  // Second vendor: suspended electrician with expired insurance (ineligible for several reasons).
  if (!(await prisma.vendorProfile.findFirst({ where: { tenantOrgId: orgId, name: 'Sparky Electric Co' } }))) {
    const sparky = await prisma.vendorProfile.create({ data: { tenantOrgId: orgId, name: 'Sparky Electric Co', status: 'suspended', trades: ['electrical', 'appliance'], email: 'dispatch@sparky.bolar.test', phone: '+15125550177', insuranceExpiresAt: new Date(Date.now() - 20 * DAY), coverageJson: { propertyIds: [maple.id] }, budgetLimitCents: 80_000 } });
    await prisma.vendorContract.create({ data: { tenantOrgId: orgId, vendorId: sparky.id, kind: 'insurance_certificate', storageKey: 'demo/vendors/sparky/coi-2025.pdf', startsAt: new Date(Date.now() - 385 * DAY), endsAt: new Date(Date.now() - 20 * DAY) } });
  }
  const vera = await prisma.vendorProfile.findFirst({ where: { tenantOrgId: orgId, name: 'Vera Vendor Plumbing LLC' } });
  if (vera && (await prisma.vendorContract.count({ where: { tenantOrgId: orgId, vendorId: vera.id } })) === 0) {
    await prisma.vendorContract.create({ data: { tenantOrgId: orgId, vendorId: vera.id, kind: 'msa', storageKey: 'demo/vendors/vera/msa-2026.pdf', startsAt: new Date(Date.now() - 100 * DAY), endsAt: new Date(Date.now() + 265 * DAY) } });
    await prisma.vendorContract.create({ data: { tenantOrgId: orgId, vendorId: vera.id, kind: 'insurance_certificate', storageKey: 'demo/vendors/vera/coi-2026.pdf', startsAt: new Date(Date.now() - 165 * DAY), endsAt: vera.insuranceExpiresAt ?? new Date(Date.now() + 200 * DAY) } });
  }

  // Overdue normal-priority order (SLA 7 days, created 10 days ago, still triaged) for the SLA scan / escalation fixtures.
  if (!(await prisma.workOrder.findFirst({ where: { tenantOrgId: orgId, title: 'Bathroom exhaust fan not working' } }))) {
    const createdAt = new Date(Date.now() - 10 * DAY);
    await prisma.workOrder.create({ data: { tenantOrgId: orgId, propertyId: maple.id, unitId: unit102?.id ?? null, requesterId: tenant.id, requesterKind: 'tenant', title: 'Bathroom exhaust fan not working', description: 'Fan hums but does not spin; mirror fogs badly after showers.', category: 'electrical', priority: 'normal', status: 'triaged', entryPermission: 'granted', availabilityJson: [{ start: new Date(createdAt.getTime() + DAY).toISOString(), end: new Date(createdAt.getTime() + DAY + 4 * 3_600_000).toISOString() }], slaDueAt: new Date(createdAt.getTime() + 7 * DAY), createdAt, updatedAt: createdAt } });
  }

  // Timeline events for every seeded order that has none yet.
  const orders = await prisma.workOrder.findMany({ where: { tenantOrgId: orgId }, orderBy: { createdAt: 'asc' } });
  for (const wo of orders) {
    if ((await prisma.workOrderEvent.count({ where: { tenantOrgId: orgId, workOrderId: wo.id } })) > 0) continue;
    const t0 = wo.createdAt.getTime();
    const at = (minutes: number) => new Date(t0 + minutes * 60_000);
    const ev = (eventType: string, actorId: string | null, payload: Record<string, unknown>, createdAt: Date) => prisma.workOrderEvent.create({ data: { tenantOrgId: orgId, workOrderId: wo.id, eventType, actorId, payload: payload as never, createdAt } });
    await ev('created', wo.requesterId, { priority: wo.priority, category: wo.category, requesterKind: wo.requesterKind }, at(0));
    const path: string[] = { new: [], triaged: ['triaged'], assigned: ['triaged', 'assigned'], scheduled: ['triaged', 'assigned', 'scheduled'], in_progress: ['triaged', 'assigned', 'scheduled', 'in_progress'], blocked: ['triaged', 'assigned', 'scheduled', 'in_progress', 'blocked'], review: ['triaged', 'assigned', 'scheduled', 'in_progress', 'review'], complete: ['triaged', 'assigned', 'scheduled', 'in_progress', 'review', 'complete'], reopened: ['triaged', 'assigned', 'scheduled', 'in_progress', 'review', 'complete', 'reopened'], canceled: ['canceled'] }[wo.status] ?? [];
    let from = 'new';
    for (const [i, to] of path.entries()) {
      const minutes = 30 * (i + 1);
      if (to === 'assigned') await ev('assigned', manager.id, wo.assignedVendorId ? { vendorId: wo.assignedVendorId, vendorName: vera?.name ?? 'Vendor' } : { userId: wo.assignedUserId }, at(minutes - 5));
      const actor = to === 'scheduled' || to === 'in_progress' || to === 'review' ? (vendorUser?.id ?? manager.id) : to === 'reopened' ? wo.requesterId : manager.id;
      await ev('status_changed', actor, { from, to, note: to === 'canceled' ? 'Canceled during seed' : null, scheduledFor: to === 'scheduled' ? wo.scheduledFor?.toISOString() : undefined }, at(minutes));
      from = to;
    }
    if (wo.slaDueAt && wo.slaDueAt.getTime() < Date.now() && !['complete', 'canceled'].includes(wo.status)) {
      await ev('sla_breached', null, { slaDueAt: wo.slaDueAt.toISOString(), priority: wo.priority, status: wo.status, hoursOverdue: Math.round((Date.now() - wo.slaDueAt.getTime()) / 3_600_000) }, new Date(wo.slaDueAt.getTime() + 60_000));
    }
  }
}
