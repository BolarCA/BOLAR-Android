/**
 * Day 59 demo seed: realistic synthetic data across portals (org, properties, units, tenants,
 * leases, invoices, work orders, vendors, documents, rules). Idempotent; builds on seedBase.
 * Domain sections are appended as each module lands; everything here is synthetic.
 */
import 'dotenv/config';
import { prisma } from '../src/client.js';
import { seedBase, DEMO_USERS } from './index.js';
import { seedPropertyDemo } from './modules/property.js';
import { seedTenancyDemo } from './modules/tenancy.js';
import { seedDocumentsDemo } from './modules/documents.js';
import { seedMaintenanceDemo } from './modules/maintenance.js';
import { seedFinanceDemo } from './modules/finance.js';
import { seedComplianceDemo } from './modules/compliance.js';
import { seedGovernanceDemo } from './modules/governance.js';

export async function seedDemo() {
  const { org, admin } = await seedBase();
  const users = Object.fromEntries(await Promise.all(DEMO_USERS.map(async (u) => [u.role, (await prisma.userProfile.findFirstOrThrow({ where: { tenantOrgId: org.id, email: u.email } }))] as const)));
  const subaccount = await prisma.subaccount.findFirstOrThrow({ where: { tenantOrgId: org.id } });

  // Portfolio + properties
  const portfolio = (await prisma.portfolio.findFirst({ where: { tenantOrgId: org.id } })) ??
    (await prisma.portfolio.create({ data: { tenantOrgId: org.id, name: 'Austin Core Portfolio', ownerUserId: users.landlord!.id } }));
  const propertyDefs = [
    { name: 'Maple Court Apartments', addressLine1: '100 Maple St', city: 'Austin', state: 'TX', postalCode: '78701', county: 'Travis', units: ['101', '102', '103', '201', '202', '203'] },
    { name: 'Riverside Lofts', addressLine1: '45 Riverside Dr', city: 'Austin', state: 'TX', postalCode: '78704', county: 'Travis', units: ['A', 'B', 'C', 'D'] },
    { name: 'Sunset Bungalows', addressLine1: '9 Sunset Ave', city: 'Los Angeles', state: 'CA', postalCode: '90026', county: 'Los Angeles', units: ['1', '2', '3'] },
  ];
  const properties = [] as { id: string; units: { id: string; unitNumber: string }[] }[];
  for (const [i, p] of propertyDefs.entries()) {
    const { units: unitNumbers, ...data } = p;
    const prop = (await prisma.property.findFirst({ where: { tenantOrgId: org.id, name: p.name } })) ??
      (await prisma.property.create({ data: { ...data, tenantOrgId: org.id, portfolioId: portfolio.id, subaccountId: subaccount.id, ownerUserId: users.landlord!.id, status: i === 2 ? 'onboarding' : 'active' } }));
    const units = [] as { id: string; unitNumber: string }[];
    for (const [j, n] of unitNumbers.entries()) {
      const unit = await prisma.unit.upsert({
        where: { tenantOrgId_propertyId_unitNumber: { tenantOrgId: org.id, propertyId: prop.id, unitNumber: n } },
        update: {},
        create: { tenantOrgId: org.id, propertyId: prop.id, unitNumber: n, bedrooms: 1 + (j % 3), bathrooms: 1, squareFeet: 650 + j * 120, targetRentCents: 145000 + j * 15000, status: j === 0 ? 'occupied' : j === 1 ? 'notice' : 'vacant' },
      });
      units.push({ id: unit.id, unitNumber: unit.unitNumber });
    }
    properties.push({ id: prop.id, units });
  }

  // Relationships (ReBAC): owner owns portfolio & properties; manager manages properties; vendor assigned later
  const ensureEdge = async (subjectId: string, relation: string, objectType: string, objectId: string) => {
    const existing = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: org.id, subjectType: 'user', subjectId, relation, objectType, objectId } });
    if (!existing) await prisma.relationshipEdge.create({ data: { tenantOrgId: org.id, subjectType: 'user', subjectId, relation, objectType, objectId, grantedBy: admin.id } });
  };
  await ensureEdge(users.landlord!.id, 'owner_of', 'portfolio', portfolio.id);
  for (const p of properties) {
    await ensureEdge(users.landlord!.id, 'owner_of', 'property', p.id);
    await ensureEdge(users.property_manager!.id, 'manages', 'property', p.id);
    await ensureEdge(users.bookkeeper!.id, 'bookkeeper_for', 'property', p.id);
  }

  // Tenant profile for the demo tenant user + active lease on Maple Court 101
  const tenantProfile = (await prisma.tenantProfile.findFirst({ where: { tenantOrgId: org.id, userId: users.tenant!.id } })) ??
    (await prisma.tenantProfile.create({ data: { tenantOrgId: org.id, userId: users.tenant!.id, displayName: 'Theo Tenant', email: 'tenant@demo.bolar.test', phone: '+15125550100', status: 'active', ssnLast4: '0000', classification: 'confidential' } }));
  const maple = properties[0]!;
  const unit101 = maple.units[0]!;
  let lease = await prisma.lease.findFirst({ where: { tenantOrgId: org.id, unitId: unit101.id, status: 'active' } });
  if (!lease) {
    const start = new Date(); start.setMonth(start.getMonth() - 6); start.setDate(1);
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
    lease = await prisma.lease.create({ data: { tenantOrgId: org.id, propertyId: maple.id, unitId: unit101.id, status: 'active', startDate: start, endDate: end, rentCents: 145000, depositCents: 145000, createdBy: users.property_manager!.id, templateKey: 'lease.residential.tx' } });
    await prisma.leaseParty.create({ data: { tenantOrgId: org.id, leaseId: lease.id, tenantProfileId: tenantProfile.id, role: 'primary', signedAt: start } });
    await prisma.recurringCharge.create({ data: { tenantOrgId: org.id, leaseId: lease.id, type: 'rent', amountCents: 145000, cadence: 'monthly', accountCode: '4000' } });
    await prisma.leaseVersion.create({ data: { tenantOrgId: org.id, leaseId: lease.id, version: 1, termsJson: { rentCents: 145000, depositCents: 145000, term: '12 months', pets: 'none' }, createdBy: users.property_manager!.id } });
    await ensureEdge(users.tenant!.id, 'tenant_of', 'lease', lease.id);
    await ensureEdge(users.tenant!.id, 'tenant_of', 'unit', unit101.id);
  }

  // Vendor
  const vendor = (await prisma.vendorProfile.findFirst({ where: { tenantOrgId: org.id, userId: users.vendor!.id } })) ??
    (await prisma.vendorProfile.create({ data: { tenantOrgId: org.id, userId: users.vendor!.id, name: 'Vera Vendor Plumbing LLC', status: 'approved', trades: ['plumbing', 'hvac'], email: 'vendor@demo.bolar.test', insuranceExpiresAt: new Date(Date.now() + 200 * 86_400_000), coverageJson: { propertyIds: [maple.id] }, budgetLimitCents: 250000 } }));

  // Work orders across lanes
  if ((await prisma.workOrder.count({ where: { tenantOrgId: org.id } })) === 0) {
    const mk = (data: Partial<Parameters<typeof prisma.workOrder.create>[0]['data']> & { title: string; description: string; category: string }) =>
      prisma.workOrder.create({ data: { tenantOrgId: org.id, propertyId: maple.id, unitId: unit101.id, requesterId: users.tenant!.id, priority: 'normal', status: 'new', ...data } as never });
    const leak = await mk({ title: 'Kitchen sink leaking', description: 'Water pooling under the sink, worse when running the dishwasher.', category: 'plumbing', priority: 'high', status: 'assigned', assignedVendorId: vendor.id, slaDueAt: new Date(Date.now() + 2 * 86_400_000) });
    await ensureEdge(users.vendor!.id, 'assigned_to', 'work_order', leak.id);
    await mk({ title: 'No heat in bedroom', description: 'Radiator cold since Monday.', category: 'hvac', priority: 'emergency', status: 'triaged', slaDueAt: new Date(Date.now() + 86_400_000) });
    await mk({ title: 'Hallway light flickering', description: 'Second floor hallway light flickers intermittently.', category: 'electrical', status: 'new', requesterId: users.property_manager!.id, requesterKind: 'staff', unitId: null });
    await mk({ title: 'Dishwasher replaced', description: 'Unit replaced and tested.', category: 'appliance', status: 'complete', completedAt: new Date(Date.now() - 3 * 86_400_000), actualCents: 68000 });
  }

  // Chart of accounts + current invoice
  const accounts = [
    { code: '1000', name: 'Operating Cash', type: 'asset', isSystem: true }, { code: '1100', name: 'Accounts Receivable', type: 'asset', isSystem: true }, { code: '1200', name: 'Security Deposits Held (Trust)', type: 'asset', isSystem: true },
    { code: '2000', name: 'Accounts Payable', type: 'liability', isSystem: true }, { code: '2100', name: 'Tenant Deposits Liability', type: 'liability', isSystem: true }, { code: '2200', name: 'Prepaid Rent', type: 'liability', isSystem: true },
    { code: '3000', name: 'Owner Equity', type: 'equity', isSystem: true },
    { code: '4000', name: 'Rental Income', type: 'income', isSystem: true }, { code: '4100', name: 'Late Fee Income', type: 'income' }, { code: '4200', name: 'Other Income', type: 'income' },
    { code: '5000', name: 'Repairs and Maintenance', type: 'expense' }, { code: '5100', name: 'Utilities', type: 'expense' }, { code: '5200', name: 'Management Fees', type: 'expense' }, { code: '5300', name: 'Insurance', type: 'expense' }, { code: '5400', name: 'Property Taxes', type: 'expense' },
  ];
  for (const a of accounts) await prisma.account.upsert({ where: { tenantOrgId_code: { tenantOrgId: org.id, code: a.code } }, update: {}, create: { ...a, tenantOrgId: org.id } });
  if ((await prisma.invoice.count({ where: { tenantOrgId: org.id } })) === 0) {
    const due = new Date(); due.setDate(1); due.setMonth(due.getMonth() + 1);
    const periodStart = new Date(due); const periodEnd = new Date(due); periodEnd.setMonth(periodEnd.getMonth() + 1); periodEnd.setDate(0);
    const inv = await prisma.invoice.create({ data: { tenantOrgId: org.id, leaseId: lease.id, tenantProfileId: tenantProfile.id, number: 'INV-000001', status: 'open', periodStart, periodEnd, dueDate: due, totalCents: 145000, issuedAt: new Date() } });
    await prisma.invoiceLine.create({ data: { tenantOrgId: org.id, invoiceId: inv.id, description: 'Monthly rent', accountCode: '4000', amountCents: 145000 } });
    const past = new Date(); past.setDate(1); past.setMonth(past.getMonth() - 1);
    const paid = await prisma.invoice.create({ data: { tenantOrgId: org.id, leaseId: lease.id, tenantProfileId: tenantProfile.id, number: 'INV-000000', status: 'paid', dueDate: past, totalCents: 145000, paidCents: 145000, issuedAt: past } });
    await prisma.invoiceLine.create({ data: { tenantOrgId: org.id, invoiceId: paid.id, description: 'Monthly rent', accountCode: '4000', amountCents: 145000 } });
    await prisma.payment.create({ data: { tenantOrgId: org.id, invoiceId: paid.id, provider: 'mock', method: 'ach', status: 'succeeded', amountCents: 145000, externalId: 'mock_pay_000', receivedAt: past } });
  }

  // Documents (metadata only; files land through the documents module)
  if ((await prisma.document.count({ where: { tenantOrgId: org.id } })) === 0) {
    await prisma.document.create({ data: { tenantOrgId: org.id, ownerType: 'lease', ownerId: lease.id, title: 'Residential Lease Agreement (signed)', classification: 'confidential', category: 'lease', createdBy: users.property_manager!.id } });
    await prisma.document.create({ data: { tenantOrgId: org.id, ownerType: 'property', ownerId: maple.id, title: 'Property insurance certificate 2026', classification: 'internal', category: 'insurance', createdBy: users.property_manager!.id } });
  }

  // A pending sensitive access request for the approver queue
  if (!(await prisma.sensitiveAccessRequest.findFirst({ where: { tenantOrgId: org.id, actorId: users.property_manager!.id } }))) {
    await prisma.sensitiveAccessRequest.create({ data: { tenantOrgId: org.id, actorId: users.property_manager!.id, resourceType: 'tenant_profile', resourceId: tenantProfile.id, classification: 'confidential', purpose: 'lease_administration', justification: 'Verify identity details before lease renewal paperwork.' } });
  }

  // Domain module seeds (each idempotent; order matters: property -> tenancy -> documents -> maintenance -> finance -> compliance -> governance)
  await seedPropertyDemo(org.id);
  await seedTenancyDemo(org.id);
  await seedDocumentsDemo(org.id);
  await seedMaintenanceDemo(org.id);
  await seedFinanceDemo(org.id);
  await seedComplianceDemo(org.id);
  await seedGovernanceDemo(org.id);

  return { org, properties, lease, tenantProfile, vendor };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  seedDemo()
    .then((r) => { console.info(`[seed:demo] org ${r.org.slug}: ${r.properties.length} properties seeded`); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
