-- Reporting materialized views (blueprint Days 75-90: "Postgres materialized views first").
-- Every view carries "tenantOrgId" as its first column with an index; the API always filters on it.
-- Each view has a unique index so REFRESH MATERIALIZED VIEW CONCURRENTLY works (readers are never blocked).
-- Definitions, formulas and reconciliation rules: docs/metrics-definitions.md.

-- Freshness stamp: refreshed last by rpt_refresh_all(), so "refreshedAt" is the time of the last full refresh.
CREATE MATERIALIZED VIEW rpt_freshness AS
SELECT 1 AS id, now() AS "refreshedAt"
WITH DATA;
CREATE UNIQUE INDEX rpt_freshness_id_key ON rpt_freshness (id);

-- Rent roll: one row per active lease.
CREATE MATERIALIZED VIEW rpt_rent_roll AS
SELECT
  l."tenantOrgId",
  l.id AS "leaseId",
  l."propertyId",
  p.name AS "propertyName",
  l."unitId",
  u."unitNumber",
  tp.id AS "tenantProfileId",
  tp."displayName" AS "tenantName",
  l.status,
  l."startDate",
  l."endDate",
  l."rentCents",
  l."depositCents",
  u."targetRentCents",
  (p.name || '|' || u."unitNumber" || '|' || l.id) AS "sortKey"
FROM "Lease" l
JOIN "Unit" u ON u.id = l."unitId"
JOIN "Property" p ON p.id = l."propertyId"
LEFT JOIN LATERAL (
  SELECT t.id, t."displayName"
  FROM "LeaseParty" lp
  JOIN "TenantProfile" t ON t.id = lp."tenantProfileId"
  WHERE lp."leaseId" = l.id
  ORDER BY CASE lp.role WHEN 'primary' THEN 0 ELSE 1 END, lp.id
  LIMIT 1
) tp ON true
WHERE l.status = 'active'
WITH DATA;
CREATE UNIQUE INDEX rpt_rent_roll_key ON rpt_rent_roll ("tenantOrgId", "leaseId");
CREATE INDEX rpt_rent_roll_tenant_idx ON rpt_rent_roll ("tenantOrgId");
CREATE INDEX rpt_rent_roll_sort_idx ON rpt_rent_roll ("tenantOrgId", "sortKey");
CREATE INDEX rpt_rent_roll_property_idx ON rpt_rent_roll ("tenantOrgId", "propertyId");

-- AR aging: one row per outstanding invoice, bucketed by days past due at refresh time.
-- Same statuses and bucket edges as modules/finance/invoice/service.ts aging().
CREATE MATERIALIZED VIEW rpt_ar_aging AS
SELECT
  i."tenantOrgId",
  i.id AS "invoiceId",
  i."leaseId",
  l."propertyId",
  p.name AS "propertyName",
  u."unitNumber",
  i."tenantProfileId",
  tp."displayName" AS "tenantName",
  i.number,
  i.status,
  i."dueDate",
  i."totalCents",
  i."paidCents",
  GREATEST(i."totalCents" - i."paidCents", 0) AS "balanceCents",
  (current_date - i."dueDate"::date) AS "daysPastDue",
  CASE
    WHEN (current_date - i."dueDate"::date) <= 0 THEN 'current'
    WHEN (current_date - i."dueDate"::date) <= 30 THEN '1_30'
    WHEN (current_date - i."dueDate"::date) <= 60 THEN '31_60'
    WHEN (current_date - i."dueDate"::date) <= 90 THEN '61_90'
    ELSE '90_plus'
  END AS bucket,
  (to_char(i."dueDate", 'YYYY-MM-DD') || '|' || i.id) AS "sortKey"
FROM "Invoice" i
JOIN "Lease" l ON l.id = i."leaseId"
JOIN "Property" p ON p.id = l."propertyId"
JOIN "Unit" u ON u.id = l."unitId"
LEFT JOIN "TenantProfile" tp ON tp.id = i."tenantProfileId"
WHERE i.status IN ('open', 'partially_paid', 'overdue')
  AND i."totalCents" - i."paidCents" > 0
WITH DATA;
CREATE UNIQUE INDEX rpt_ar_aging_key ON rpt_ar_aging ("tenantOrgId", "invoiceId");
CREATE INDEX rpt_ar_aging_tenant_idx ON rpt_ar_aging ("tenantOrgId");
CREATE INDEX rpt_ar_aging_sort_idx ON rpt_ar_aging ("tenantOrgId", "sortKey");
CREATE INDEX rpt_ar_aging_property_idx ON rpt_ar_aging ("tenantOrgId", "propertyId");

-- Occupancy: one row per property (including properties without units).
CREATE MATERIALIZED VIEW rpt_occupancy AS
SELECT
  p."tenantOrgId",
  p.id AS "propertyId",
  p.name AS "propertyName",
  p.city,
  p.state,
  p.status AS "propertyStatus",
  COUNT(u.id)::int AS "totalUnits",
  (COUNT(u.id) FILTER (WHERE u.status = 'occupied'))::int AS "occupiedUnits",
  (COUNT(u.id) FILTER (WHERE u.status = 'vacant'))::int AS "vacantUnits",
  (COUNT(u.id) FILTER (WHERE u.status = 'notice'))::int AS "noticeUnits",
  (COUNT(u.id) FILTER (WHERE u.status NOT IN ('occupied', 'vacant', 'notice')))::int AS "otherUnits",
  CASE WHEN COUNT(u.id) = 0 THEN 0::numeric(5,2)
       ELSE ROUND((COUNT(u.id) FILTER (WHERE u.status = 'occupied'))::numeric * 100 / COUNT(u.id), 2)::numeric(5,2) END AS "occupancyPct",
  COALESCE(al."activeLeases", 0)::int AS "activeLeases",
  COALESCE(al."scheduledRentCents", 0)::bigint AS "scheduledRentCents",
  COALESCE(SUM(u."targetRentCents"), 0)::bigint AS "targetRentCents",
  (p.name || '|' || p.id) AS "sortKey"
FROM "Property" p
LEFT JOIN "Unit" u ON u."propertyId" = p.id
LEFT JOIN (
  SELECT "propertyId", COUNT(*) AS "activeLeases", SUM("rentCents") AS "scheduledRentCents"
  FROM "Lease" WHERE status = 'active' GROUP BY "propertyId"
) al ON al."propertyId" = p.id
GROUP BY p."tenantOrgId", p.id, p.name, p.city, p.state, p.status, al."activeLeases", al."scheduledRentCents"
WITH DATA;
CREATE UNIQUE INDEX rpt_occupancy_key ON rpt_occupancy ("tenantOrgId", "propertyId");
CREATE INDEX rpt_occupancy_tenant_idx ON rpt_occupancy ("tenantOrgId");
CREATE INDEX rpt_occupancy_sort_idx ON rpt_occupancy ("tenantOrgId", "sortKey");

-- Maintenance SLA: one row per property x priority.
CREATE MATERIALIZED VIEW rpt_maintenance_sla AS
SELECT
  w."tenantOrgId",
  w."propertyId",
  p.name AS "propertyName",
  w.priority,
  COUNT(*)::int AS "totalOrders",
  (COUNT(*) FILTER (WHERE w.status NOT IN ('complete', 'canceled')))::int AS "openOrders",
  (COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL))::int AS "completedOrders",
  (COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL AND w."slaDueAt" IS NOT NULL))::int AS "measuredOrders",
  (COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL AND (w."slaDueAt" IS NULL OR w."completedAt" <= w."slaDueAt")))::int AS "completedWithinSla",
  (COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL AND w."slaDueAt" IS NOT NULL AND w."completedAt" > w."slaDueAt"))::int AS "completedLate",
  (COUNT(*) FILTER (WHERE w.status NOT IN ('complete', 'canceled') AND w."slaDueAt" IS NOT NULL AND w."slaDueAt" < now()))::int AS "breachedOpen",
  CASE WHEN COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL) = 0 THEN 0::numeric(5,2)
       ELSE ROUND((COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL AND (w."slaDueAt" IS NULL OR w."completedAt" <= w."slaDueAt")))::numeric * 100
                  / (COUNT(*) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL)), 2)::numeric(5,2) END AS "slaCompliancePct",
  ROUND((AVG(GREATEST(EXTRACT(EPOCH FROM (w."completedAt" - w."createdAt")), 0) / 3600.0) FILTER (WHERE w.status = 'complete' AND w."completedAt" IS NOT NULL))::numeric, 1) AS "avgHoursToComplete",
  (p.name || '|' || w."propertyId" || '|' || CASE w.priority WHEN 'emergency' THEN '0' WHEN 'high' THEN '1' WHEN 'normal' THEN '2' ELSE '3' END || '|' || w.priority) AS "sortKey"
FROM "WorkOrder" w
JOIN "Property" p ON p.id = w."propertyId"
GROUP BY w."tenantOrgId", w."propertyId", p.name, w.priority
WITH DATA;
CREATE UNIQUE INDEX rpt_maintenance_sla_key ON rpt_maintenance_sla ("tenantOrgId", "propertyId", priority);
CREATE INDEX rpt_maintenance_sla_tenant_idx ON rpt_maintenance_sla ("tenantOrgId");
CREATE INDEX rpt_maintenance_sla_sort_idx ON rpt_maintenance_sla ("tenantOrgId", "sortKey");

-- Collections: one row per property x calendar month with succeeded payments, issued invoices or payment cash postings.
CREATE MATERIALIZED VIEW rpt_collections_monthly AS
WITH pay AS (
  SELECT pm."tenantOrgId", l."propertyId", date_trunc('month', COALESCE(pm."receivedAt", pm."createdAt"))::date AS month,
         COUNT(*) AS "paymentsCount", SUM(pm."amountCents") AS "collectedCents"
  FROM "Payment" pm
  JOIN "Invoice" i ON i.id = pm."invoiceId"
  JOIN "Lease" l ON l.id = i."leaseId"
  WHERE pm.status = 'succeeded'
  GROUP BY 1, 2, 3
), inv AS (
  SELECT i."tenantOrgId", l."propertyId", date_trunc('month', i."issuedAt")::date AS month,
         COUNT(*) AS "invoicesCount", SUM(i."totalCents") AS "invoicedCents"
  FROM "Invoice" i
  JOIN "Lease" l ON l.id = i."leaseId"
  WHERE i."issuedAt" IS NOT NULL AND i.status NOT IN ('draft', 'void')
  GROUP BY 1, 2, 3
), led AS (
  -- Cash (1000) movements from payment journals and their reversals (refunds), net.
  SELECT je."tenantOrgId", le."propertyId", date_trunc('month', je."postedAt")::date AS month,
         SUM(le."debitCents" - le."creditCents") AS "ledgerCashCents"
  FROM "JournalEntry" je
  JOIN "LedgerEntry" le ON le."journalEntryId" = je.id
  JOIN "Account" a ON a.id = le."accountId"
  WHERE je."postedAt" IS NOT NULL
    AND a.code = '1000'
    AND le."propertyId" IS NOT NULL
    AND (je."sourceType" = 'payment'
         OR (je."sourceType" = 'reversal' AND EXISTS (SELECT 1 FROM "JournalEntry" o WHERE o.id = je."reversalOfId" AND o."sourceType" = 'payment')))
  GROUP BY 1, 2, 3
), keys AS (
  SELECT "tenantOrgId", "propertyId", month FROM pay
  UNION SELECT "tenantOrgId", "propertyId", month FROM inv
  UNION SELECT "tenantOrgId", "propertyId", month FROM led
)
SELECT
  k."tenantOrgId",
  k."propertyId",
  p.name AS "propertyName",
  k.month,
  COALESCE(pay."paymentsCount", 0)::int AS "paymentsCount",
  COALESCE(pay."collectedCents", 0)::bigint AS "collectedCents",
  COALESCE(inv."invoicesCount", 0)::int AS "invoicesCount",
  COALESCE(inv."invoicedCents", 0)::bigint AS "invoicedCents",
  COALESCE(led."ledgerCashCents", 0)::bigint AS "ledgerCashCents",
  (to_char(k.month, 'YYYY-MM') || '|' || p.name || '|' || k."propertyId") AS "sortKey"
FROM keys k
JOIN "Property" p ON p.id = k."propertyId"
LEFT JOIN pay ON pay."tenantOrgId" = k."tenantOrgId" AND pay."propertyId" = k."propertyId" AND pay.month = k.month
LEFT JOIN inv ON inv."tenantOrgId" = k."tenantOrgId" AND inv."propertyId" = k."propertyId" AND inv.month = k.month
LEFT JOIN led ON led."tenantOrgId" = k."tenantOrgId" AND led."propertyId" = k."propertyId" AND led.month = k.month
WITH DATA;
CREATE UNIQUE INDEX rpt_collections_monthly_key ON rpt_collections_monthly ("tenantOrgId", "propertyId", month);
CREATE INDEX rpt_collections_monthly_tenant_idx ON rpt_collections_monthly ("tenantOrgId");
CREATE INDEX rpt_collections_monthly_month_idx ON rpt_collections_monthly ("tenantOrgId", month);

-- Compliance hits: non-allow rule evaluations by severity, result, resolution and domain.
CREATE MATERIALIZED VIEW rpt_compliance_hits AS
SELECT
  e."tenantOrgId",
  r.severity,
  e.result,
  COALESCE(e.resolution, 'open') AS resolution,
  r.domain,
  COUNT(*)::int AS hits,
  MIN(e."createdAt") AS "firstHitAt",
  MAX(e."createdAt") AS "lastHitAt",
  (CASE r.severity WHEN 'critical' THEN '0' WHEN 'high' THEN '1' WHEN 'medium' THEN '2' ELSE '3' END
    || '|' || r.severity || '|' || e.result || '|' || COALESCE(e.resolution, 'open') || '|' || r.domain) AS "sortKey"
FROM "RuleEvaluation" e
JOIN "ComplianceRule" r ON r.id = e."ruleId"
WHERE e.result <> 'allow'
GROUP BY e."tenantOrgId", r.severity, e.result, COALESCE(e.resolution, 'open'), r.domain
WITH DATA;
CREATE UNIQUE INDEX rpt_compliance_hits_key ON rpt_compliance_hits ("tenantOrgId", severity, result, resolution, domain);
CREATE INDEX rpt_compliance_hits_tenant_idx ON rpt_compliance_hits ("tenantOrgId");

-- Refresh everything without blocking readers; the freshness stamp is refreshed last.
CREATE OR REPLACE FUNCTION rpt_refresh_all() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_rent_roll;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_ar_aging;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_occupancy;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_maintenance_sla;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_collections_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_compliance_hits;
  REFRESH MATERIALIZED VIEW CONCURRENTLY rpt_freshness;
END;
$$ LANGUAGE plpgsql;
