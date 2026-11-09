-- Days 91-104 hardening: indexes justified by EXPLAIN ANALYZE on a ~5k-rows-per-table database
-- (scripts/explain-report.ts; before/after plans in docs/qa/hardening-qa.md).
-- Role resolution on every authenticated request:
--   WHERE "userId" = $1 AND "revokedAt" IS NULL AND ("tenantOrgId" = $2 OR "scopeType" = 'platform')
-- was a sequential scan over RoleAssignment because the existing indexes lead with tenantOrgId.
-- Rollback: DROP INDEX "RoleAssignment_userId_revokedAt_idx";
CREATE INDEX "RoleAssignment_userId_revokedAt_idx" ON "RoleAssignment"("userId", "revokedAt");
