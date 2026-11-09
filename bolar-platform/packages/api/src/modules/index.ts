import type { Router } from 'express';
import { healthRouter } from './health/routes.js';
import { authRouter } from './auth/routes.js';
import { tenantRouter } from './tenant/routes.js';
import { iamRouter } from './iam/routes.js';
import { sensitiveAccessRouter } from './sensitive-access/routes.js';
import { auditRouter } from './audit/routes.js';
import { propertyRouter } from './property/routes.js';
import { tenantProfileRouter } from './tenant-profile/routes.js';
import { leaseRouter } from './lease/routes.js';
import { screeningRouter } from './screening/routes.js';
import { documentRouter } from './document/routes.js';
import { mediaRouter } from './media/routes.js';
import { notificationRouter } from './notification/routes.js';
import { templateRouter } from './template/routes.js';
import { maintenanceRouter } from './maintenance/routes.js';
import { vendorRouter } from './vendor/routes.js';
import { financeRouter } from './finance/routes.js';
import { complianceRouter } from './compliance/routes.js';
import { noticeRouter } from './notice/routes.js';
import { retentionRouter } from './retention/routes.js';
import { privacyRouter } from './privacy/routes.js';
import { legalHoldRouter } from './legal-hold/routes.js';
import { legalRouter } from './legal/routes.js';
import { packetExportRouter } from './packet-export/routes.js';
import { signatureRouter } from './signature/routes.js';
import { integrationsRouter } from './integrations/routes.js';
import { storageRouter } from './storage/routes.js';

/**
 * Module registry for the modular monolith (blueprint p9/p10). Each domain module exports a
 * Router built with defineRoute/mount so it is validated, access-gated, audited and
 * documented in OpenAPI automatically. Add new modules here only.
 */
export const modules: { name: string; router: Router }[] = [
  { name: 'health', router: healthRouter },
  { name: 'auth', router: authRouter },
  { name: 'tenant', router: tenantRouter },
  { name: 'iam', router: iamRouter },
  { name: 'sensitive-access', router: sensitiveAccessRouter },
  { name: 'audit', router: auditRouter },
  { name: 'property', router: propertyRouter },
  { name: 'tenant-profile', router: tenantProfileRouter },
  { name: 'lease', router: leaseRouter },
  { name: 'screening', router: screeningRouter },
  { name: 'document', router: documentRouter },
  { name: 'media', router: mediaRouter },
  { name: 'notification', router: notificationRouter },
  { name: 'template', router: templateRouter },
  { name: 'maintenance', router: maintenanceRouter },
  { name: 'vendor', router: vendorRouter },
  { name: 'finance', router: financeRouter },
  { name: 'compliance', router: complianceRouter },
  { name: 'notice', router: noticeRouter },
  { name: 'retention', router: retentionRouter },
  { name: 'privacy', router: privacyRouter },
  { name: 'legal-hold', router: legalHoldRouter },
  { name: 'legal', router: legalRouter },
  { name: 'packet-export', router: packetExportRouter },
  { name: 'signature', router: signatureRouter },
  { name: 'integrations', router: integrationsRouter },
  { name: 'storage', router: storageRouter },
];

export function registerModules(api: Router): void {
  for (const m of modules) api.use(m.router);
}
