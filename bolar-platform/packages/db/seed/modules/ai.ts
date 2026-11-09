/**
 * AI assistant demo seed (Days 61-74): a monthly budget for the demo org and one example thread in which the manager asked
 * for a lease summary (user message, cited assistant answer, one `ok` tool call with input/output hashes). Idempotent.
 * Wired by the integrator: `await seedAiDemo(org.id)` after seedDemo().
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../src/client.js';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export async function seedAiDemo(orgId: string): Promise<void> {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  await prisma.aiBudget.upsert({ where: { tenantOrgId: orgId }, update: {}, create: { tenantOrgId: orgId, monthlyLimitCents: 5000, period } });

  const manager = await prisma.userProfile.findFirst({ where: { tenantOrgId: orgId, email: 'manager@demo.bolar.test' } });
  const lease = await prisma.lease.findFirst({ where: { tenantOrgId: orgId, status: 'active' }, include: { unit: { include: { property: true } }, parties: { include: { tenantProfile: { select: { displayName: true } } } } }, orderBy: { createdAt: 'asc' } });
  if (!manager || !lease) return;
  const title = 'Demo: lease summary';
  if (await prisma.aiThread.findFirst({ where: { tenantOrgId: orgId, title } })) return;

  const thread = await prisma.aiThread.create({ data: { tenantOrgId: orgId, createdBy: manager.id, title, contextType: 'lease', contextId: lease.id } });
  await prisma.aiMessage.create({ data: { tenantOrgId: orgId, threadId: thread.id, role: 'user', content: 'Summarize this lease' } });
  const label = `Lease ${lease.unit.property.name} · Unit ${lease.unit.unitNumber}`;
  const sources = [{ type: 'lease', id: lease.id, label }, { type: 'property', id: lease.unit.property.id, label: lease.unit.property.name }];
  const facts = { property: lease.unit.property.name, unit: lease.unit.unitNumber, status: lease.status, startDate: lease.startDate.toISOString().slice(0, 10), endDate: lease.endDate.toISOString().slice(0, 10), monthlyRent: `$${(lease.rentCents / 100).toFixed(2)}`, deposit: `$${(lease.depositCents / 100).toFixed(2)}`, parties: lease.parties.map((p) => ({ label: p.tenantProfile.displayName, role: p.role, signed: Boolean(p.signedAt) })) };
  const content = [
    '**Lease summary**',
    ...Object.entries(facts).map(([k, v]) => `- ${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${Array.isArray(v) ? v.map((x) => `${x.label} (role ${x.role}, signed ${x.signed})`).join('; ') : String(v)}`),
    '',
    'Confidence: facts above are read directly from BOLAR records; interpretation is advisory and needs human judgement.',
    '',
    `Sources: ${sources.map((s) => `[${s.label}](${s.type}:${s.id})`).join(', ')}`,
  ].join('\n');
  const assistant = await prisma.aiMessage.create({ data: { tenantOrgId: orgId, threadId: thread.id, role: 'assistant', content, sources, model: 'claude-fable-5-1', inputTokens: 800, outputTokens: 240, costCents: 1, redactionCount: 0 } });
  await prisma.aiToolCall.create({ data: { tenantOrgId: orgId, threadId: thread.id, messageId: assistant.id, tool: 'summarize_lease', status: 'ok', inputHash: sha({ leaseId: lease.id }), outputHash: sha({ facts, sources, untrusted: [] }), inputSummary: { leaseId: lease.id }, sources, durationMs: 42 } });
}
