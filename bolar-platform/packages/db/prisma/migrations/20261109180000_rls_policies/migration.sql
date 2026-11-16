-- Row-level security as defense in depth (ADR 0005). Generated from the Prisma schema by packages/db/src/rls.ts.
-- Application role: NOLOGIN by default. Staging/prod create a LOGIN member, e.g.
--   CREATE ROLE bolar_app_login LOGIN PASSWORD '<secret>' IN ROLE bolar_app;
-- and point DATABASE_URL at it with DB_RLS_ENFORCE=1.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolar_app') THEN CREATE ROLE bolar_app NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO bolar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bolar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bolar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bolar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bolar_app;

-- BusinessAccount
ALTER TABLE "BusinessAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BusinessAccount";
CREATE POLICY tenant_isolation ON "BusinessAccount" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "BusinessAccount";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'BusinessAccount', current_user); END $$;

-- Subaccount
ALTER TABLE "Subaccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Subaccount";
CREATE POLICY tenant_isolation ON "Subaccount" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Subaccount";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Subaccount', current_user); END $$;

-- UserProfile
ALTER TABLE "UserProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserProfile";
CREATE POLICY tenant_isolation ON "UserProfile" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "UserProfile";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'UserProfile', current_user); END $$;

-- AccountLink
ALTER TABLE "AccountLink" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AccountLink";
CREATE POLICY tenant_isolation ON "AccountLink" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "AccountLink";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'AccountLink', current_user); END $$;

-- Session
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Session";
CREATE POLICY tenant_isolation ON "Session" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Session";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Session', current_user); END $$;

-- SupportSession
ALTER TABLE "SupportSession" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupportSession";
CREATE POLICY tenant_isolation ON "SupportSession" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "SupportSession";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'SupportSession', current_user); END $$;

-- Invitation
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invitation";
CREATE POLICY tenant_isolation ON "Invitation" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Invitation";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Invitation', current_user); END $$;

-- RoleAssignment
ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RoleAssignment";
CREATE POLICY tenant_isolation ON "RoleAssignment" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "RoleAssignment";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RoleAssignment', current_user); END $$;

-- RelationshipEdge
ALTER TABLE "RelationshipEdge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RelationshipEdge";
CREATE POLICY tenant_isolation ON "RelationshipEdge" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "RelationshipEdge";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RelationshipEdge', current_user); END $$;

-- SensitiveAccessRequest
ALTER TABLE "SensitiveAccessRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SensitiveAccessRequest";
CREATE POLICY tenant_isolation ON "SensitiveAccessRequest" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "SensitiveAccessRequest";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'SensitiveAccessRequest', current_user); END $$;

-- Portfolio
ALTER TABLE "Portfolio" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Portfolio";
CREATE POLICY tenant_isolation ON "Portfolio" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Portfolio";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Portfolio', current_user); END $$;

-- Property
ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Property";
CREATE POLICY tenant_isolation ON "Property" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Property";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Property', current_user); END $$;

-- Building
ALTER TABLE "Building" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Building";
CREATE POLICY tenant_isolation ON "Building" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Building";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Building', current_user); END $$;

-- Unit
ALTER TABLE "Unit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Unit";
CREATE POLICY tenant_isolation ON "Unit" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Unit";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Unit', current_user); END $$;

-- UnitStatusHistory
ALTER TABLE "UnitStatusHistory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UnitStatusHistory";
CREATE POLICY tenant_isolation ON "UnitStatusHistory" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "UnitStatusHistory";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'UnitStatusHistory', current_user); END $$;

-- TenantProfile
ALTER TABLE "TenantProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TenantProfile";
CREATE POLICY tenant_isolation ON "TenantProfile" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "TenantProfile";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'TenantProfile', current_user); END $$;

-- ContactMethod
ALTER TABLE "ContactMethod" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ContactMethod";
CREATE POLICY tenant_isolation ON "ContactMethod" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "ContactMethod";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'ContactMethod', current_user); END $$;

-- EmergencyContact
ALTER TABLE "EmergencyContact" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmergencyContact";
CREATE POLICY tenant_isolation ON "EmergencyContact" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "EmergencyContact";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'EmergencyContact', current_user); END $$;

-- Occupant
ALTER TABLE "Occupant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Occupant";
CREATE POLICY tenant_isolation ON "Occupant" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Occupant";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Occupant', current_user); END $$;

-- Lease
ALTER TABLE "Lease" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Lease";
CREATE POLICY tenant_isolation ON "Lease" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Lease";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Lease', current_user); END $$;

-- LeaseVersion
ALTER TABLE "LeaseVersion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaseVersion";
CREATE POLICY tenant_isolation ON "LeaseVersion" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "LeaseVersion";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'LeaseVersion', current_user); END $$;

-- LeaseParty
ALTER TABLE "LeaseParty" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaseParty";
CREATE POLICY tenant_isolation ON "LeaseParty" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "LeaseParty";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'LeaseParty', current_user); END $$;

-- RecurringCharge
ALTER TABLE "RecurringCharge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RecurringCharge";
CREATE POLICY tenant_isolation ON "RecurringCharge" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "RecurringCharge";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RecurringCharge', current_user); END $$;

-- Application
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Application";
CREATE POLICY tenant_isolation ON "Application" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Application";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Application', current_user); END $$;

-- ScreeningOrder
ALTER TABLE "ScreeningOrder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ScreeningOrder";
CREATE POLICY tenant_isolation ON "ScreeningOrder" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "ScreeningOrder";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'ScreeningOrder', current_user); END $$;

-- ScreeningResult
ALTER TABLE "ScreeningResult" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ScreeningResult";
CREATE POLICY tenant_isolation ON "ScreeningResult" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "ScreeningResult";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'ScreeningResult', current_user); END $$;

-- AdverseAction
ALTER TABLE "AdverseAction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AdverseAction";
CREATE POLICY tenant_isolation ON "AdverseAction" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "AdverseAction";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'AdverseAction', current_user); END $$;

-- WorkOrder
ALTER TABLE "WorkOrder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkOrder";
CREATE POLICY tenant_isolation ON "WorkOrder" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "WorkOrder";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'WorkOrder', current_user); END $$;

-- WorkOrderEvent
ALTER TABLE "WorkOrderEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkOrderEvent";
CREATE POLICY tenant_isolation ON "WorkOrderEvent" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "WorkOrderEvent";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'WorkOrderEvent', current_user); END $$;

-- VendorProfile
ALTER TABLE "VendorProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VendorProfile";
CREATE POLICY tenant_isolation ON "VendorProfile" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "VendorProfile";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'VendorProfile', current_user); END $$;

-- VendorContract
ALTER TABLE "VendorContract" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VendorContract";
CREATE POLICY tenant_isolation ON "VendorContract" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "VendorContract";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'VendorContract', current_user); END $$;

-- Account
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Account";
CREATE POLICY tenant_isolation ON "Account" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Account";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Account', current_user); END $$;

-- Invoice
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invoice";
CREATE POLICY tenant_isolation ON "Invoice" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Invoice";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Invoice', current_user); END $$;

-- InvoiceLine
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InvoiceLine";
CREATE POLICY tenant_isolation ON "InvoiceLine" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "InvoiceLine";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'InvoiceLine', current_user); END $$;

-- Payment
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Payment";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Payment', current_user); END $$;

-- PaymentEvent
ALTER TABLE "PaymentEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentEvent";
CREATE POLICY tenant_isolation ON "PaymentEvent" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "PaymentEvent";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'PaymentEvent', current_user); END $$;

-- JournalEntry
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JournalEntry";
CREATE POLICY tenant_isolation ON "JournalEntry" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "JournalEntry";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'JournalEntry', current_user); END $$;

-- LedgerEntry
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LedgerEntry";
CREATE POLICY tenant_isolation ON "LedgerEntry" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "LedgerEntry";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'LedgerEntry', current_user); END $$;

-- Document
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Document";
CREATE POLICY tenant_isolation ON "Document" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Document";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Document', current_user); END $$;

-- DocumentVersion
ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DocumentVersion";
CREATE POLICY tenant_isolation ON "DocumentVersion" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "DocumentVersion";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'DocumentVersion', current_user); END $$;

-- MediaAsset
ALTER TABLE "MediaAsset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MediaAsset";
CREATE POLICY tenant_isolation ON "MediaAsset" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "MediaAsset";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'MediaAsset', current_user); END $$;

-- Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Notification";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Notification', current_user); END $$;

-- Template (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Template";
CREATE POLICY tenant_isolation ON "Template" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "Template";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Template', current_user); END $$;

-- TemplateVersion (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "TemplateVersion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TemplateVersion";
CREATE POLICY tenant_isolation ON "TemplateVersion" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "TemplateVersion";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'TemplateVersion', current_user); END $$;

-- RuleEvaluation
ALTER TABLE "RuleEvaluation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RuleEvaluation";
CREATE POLICY tenant_isolation ON "RuleEvaluation" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "RuleEvaluation";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RuleEvaluation', current_user); END $$;

-- JurisdictionOverride
ALTER TABLE "JurisdictionOverride" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JurisdictionOverride";
CREATE POLICY tenant_isolation ON "JurisdictionOverride" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "JurisdictionOverride";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'JurisdictionOverride', current_user); END $$;

-- Notice
ALTER TABLE "Notice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notice";
CREATE POLICY tenant_isolation ON "Notice" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Notice";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Notice', current_user); END $$;

-- AuditLog (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "AuditLog";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'AuditLog', current_user); END $$;

-- RetentionPolicy (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "RetentionPolicy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RetentionPolicy";
CREATE POLICY tenant_isolation ON "RetentionPolicy" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "RetentionPolicy";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RetentionPolicy', current_user); END $$;

-- RetentionAssignment
ALTER TABLE "RetentionAssignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RetentionAssignment";
CREATE POLICY tenant_isolation ON "RetentionAssignment" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "RetentionAssignment";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'RetentionAssignment', current_user); END $$;

-- PrivacyRequest
ALTER TABLE "PrivacyRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PrivacyRequest";
CREATE POLICY tenant_isolation ON "PrivacyRequest" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "PrivacyRequest";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'PrivacyRequest', current_user); END $$;

-- LegalHold
ALTER TABLE "LegalHold" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LegalHold";
CREATE POLICY tenant_isolation ON "LegalHold" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "LegalHold";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'LegalHold', current_user); END $$;

-- Case
ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Case";
CREATE POLICY tenant_isolation ON "Case" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "Case";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'Case', current_user); END $$;

-- AgencyRequest
ALTER TABLE "AgencyRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AgencyRequest";
CREATE POLICY tenant_isolation ON "AgencyRequest" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "AgencyRequest";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'AgencyRequest', current_user); END $$;

-- ExportJob
ALTER TABLE "ExportJob" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExportJob";
CREATE POLICY tenant_isolation ON "ExportJob" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "ExportJob";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'ExportJob', current_user); END $$;

-- SignatureEnvelope
ALTER TABLE "SignatureEnvelope" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SignatureEnvelope";
CREATE POLICY tenant_isolation ON "SignatureEnvelope" FOR ALL TO bolar_app USING ("tenantOrgId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantOrgId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS owner_bypass ON "SignatureEnvelope";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'SignatureEnvelope', current_user); END $$;

-- IdempotencyKey (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IdempotencyKey";
CREATE POLICY tenant_isolation ON "IdempotencyKey" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "IdempotencyKey";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'IdempotencyKey', current_user); END $$;

-- FeatureFlag (nullable tenantOrgId: NULL rows are global)
ALTER TABLE "FeatureFlag" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeatureFlag";
CREATE POLICY tenant_isolation ON "FeatureFlag" FOR ALL TO bolar_app USING (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true))) WITH CHECK (("tenantOrgId" IS NULL OR "tenantOrgId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS owner_bypass ON "FeatureFlag";
DO $$ BEGIN EXECUTE format('CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', 'FeatureFlag', current_user); END $$;
