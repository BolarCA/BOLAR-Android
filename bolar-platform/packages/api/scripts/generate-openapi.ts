import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z, errorBodySchema } from '@bolar/contracts';
import '../src/modules/index.js';
import { routeRegistry } from '../src/shared/route.js';

const TAG_DESCRIPTIONS: Record<string, string> = {
  audit: 'Append-only audit log queries',
  auth: 'Sessions, MFA and the current actor',
  health: 'Liveness and dependency checks',
  iam: 'Users, invitations, scoped roles, relationships and access checks',
  'sensitive-access': 'Time-boxed approvals for confidential and restricted data',
  tenant: 'Tenant orgs, business accounts and subaccounts',
  property: 'Portfolios, properties, buildings and units',
  'tenant-profile': 'Resident and applicant profiles with classified fields',
  lease: 'Lease drafts, versions, parties, charges and lifecycle',
  signature: 'E-signature envelopes linked to leases',
  document: 'Classified documents and versions with signed URLs',
  media: 'Photos and videos attached to operations',
  notification: 'Email, SMS and in-app notifications',
  template: 'Approved templates for notices, emails and SMS',
  storage: 'Signed object storage access for the local driver',
  maintenance: 'Maintenance requests and work orders',
  vendor: 'Vendor rolodex, contracts and assignment rules',
  finance: 'Chart of accounts, ledger, invoices, payments and bank links',
  compliance: 'Policy-as-code rules, jurisdiction resolution and the review queue',
  screening: 'Applications, consent-gated screening and adverse action',
  notice: 'Notice drafting, approval and sending',
  retention: 'Retention policies, assignments and gated disposition',
  privacy: 'Data subject requests',
  'legal-hold': 'Legal holds and hold checks',
  legal: 'Cases and agency or law-enforcement requests',
  'packet-export': 'Evidence packet and audit exports',
  integrations: 'Inbound provider webhooks',
  platform: 'Platform control plane: health, feature flags, support sessions',
  ai: 'Assistant commands, threads, tool calls, audit and budget',
  reporting: 'Governed KPIs, rent roll, aging, occupancy, SLA, collections, scheduled reports',
};
const registry = new OpenAPIRegistry();
registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
const errorRef = registry.register('ErrorBody', errorBodySchema);
const errResp = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });

for (const r of routeRegistry) {
  const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  const responses: Record<string, unknown> = {
    '400': errResp('Validation error'),
    '409': errResp('Conflict or idempotency issue'),
  };
  if (r.auth !== 'public') {
    responses['401'] = errResp('Authentication required');
    responses['403'] = errResp('Denied or review required');
    responses['404'] = errResp('Not found (also returned for denied restricted resources)');
  }
  for (const [code, schema] of Object.entries(r.responses)) {
    responses[code] = schema ? { description: 'Success response (X-Request-Id header set)', content: { 'application/json': { schema } } } : { description: 'No content' };
  }
  const headers: Record<string, z.ZodTypeAny> = {};
  if (r.auth !== 'public') headers['X-Tenant-Org'] = z.string().optional().openapi({ description: 'Target org slug/id; platform actors only. Defaults to the token org.' });
  if (r.idempotent) headers['Idempotency-Key'] = z.string().min(8).max(128).openapi({ description: 'Required. Same key + same payload replays the original response.' });
  headers['X-Access-Purpose'] = z.string().optional().openapi({ description: 'Declared purpose for sensitive data access.' });
  registry.registerPath({
    method: r.method,
    path,
    operationId: r.operationId,
    summary: r.summary,
    tags: r.tags,
    security: r.auth === 'public' ? [] : [{ bearerAuth: [] }],
    'x-bolar-auth': r.auth,
    'x-bolar-permission': r.permission ?? null,
    'x-bolar-idempotent': Boolean(r.idempotent),
    request: {
      ...(r.request?.params ? { params: r.request.params as never } : {}),
      ...(r.request?.query ? { query: r.request.query as never } : {}),
      headers: z.object(headers),
      ...(r.request?.body ? { body: { content: { 'application/json': { schema: r.request.body } } } } : {}),
    },
    responses: responses as never,
  } as never);
}

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'BOLAR Platform API', version: '0.1.0', description: 'REST-first contracts (blueprint p23). All routes return X-Request-Id; errors are {code,message,requestId,fieldErrors?}. Lists use cursor pagination.' },
  servers: [{ url: 'http://localhost:4000', description: 'local' }],
  tags: [...new Set(routeRegistry.flatMap((r) => r.tags))].sort().map((t) => ({ name: t, description: TAG_DESCRIPTIONS[t] ?? `${t} operations` })),
});
const out = resolve(new URL('../../contracts/openapi.yaml', import.meta.url).pathname);
writeFileSync(out, `# Generated by packages/api/scripts/generate-openapi.ts - do not edit by hand. Run: pnpm openapi:generate\n${stringify(doc, { lineWidth: 0 })}`);
console.info(`[openapi] wrote ${routeRegistry.length} operations to ${out}`);
