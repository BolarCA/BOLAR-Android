-- CreateTable
CREATE TABLE "TenantOrg" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pilot',
    "status" TEXT NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'property_management',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subaccount" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subaccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "passwordHash" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLink" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'org',
    "scopeId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipEdge" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveAccessRequest" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "subaccountId" TEXT,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "county" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "propertyType" TEXT NOT NULL DEFAULT 'residential',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT,
    "floors" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitNumber" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(3,1),
    "squareFeet" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'vacant',
    "targetRentCents" INTEGER NOT NULL DEFAULT 0,
    "availableFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitStatusHistory" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantProfile" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "ssnLast4" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'confidential',
    "kind" TEXT NOT NULL DEFAULT 'individual',
    "businessAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prospect',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMethod" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ContactMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occupant" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Occupant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" TEXT,
    "templateKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseVersion" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "termsJson" JSONB NOT NULL,
    "documentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseParty" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),

    CONSTRAINT "LeaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringCharge" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'monthly',
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "accountCode" TEXT,

    CONSTRAINT "RecurringCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningOrder" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_consent',
    "consentAt" TIMESTAMP(3),
    "consentDocId" TEXT,
    "externalId" TEXT,
    "orderedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResult" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'restricted',
    "storageKey" TEXT,
    "summaryJson" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdverseAction" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'pre_adverse',
    "noticeId" TEXT,
    "reasonCodes" JSONB NOT NULL DEFAULT '[]',
    "waitingPeriodEndsAt" TIMESTAMP(3),
    "disputeOpenedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdverseAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "requesterId" TEXT NOT NULL,
    "requesterKind" TEXT NOT NULL DEFAULT 'tenant',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignedVendorId" TEXT,
    "assignedUserId" TEXT,
    "entryPermission" TEXT NOT NULL DEFAULT 'ask',
    "availabilityJson" JSONB NOT NULL DEFAULT '[]',
    "slaDueAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfId" TEXT,
    "estimateCents" INTEGER,
    "actualCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderEvent" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorProfile" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trades" JSONB NOT NULL DEFAULT '[]',
    "email" TEXT,
    "phone" TEXT,
    "insuranceExpiresAt" TIMESTAMP(3),
    "licenseNumber" TEXT,
    "coverageJson" JSONB NOT NULL DEFAULT '{}',
    "budgetLimitCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorContract" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'msa',
    "storageKey" TEXT NOT NULL,
    "documentId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "propertyId" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantProfileId" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "chargeId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'ach',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amountCents" INTEGER NOT NULL,
    "externalId" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "memo" TEXT,
    "idempotencyKey" TEXT,
    "reversalOfId" TEXT,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "category" TEXT NOT NULL DEFAULT 'general',
    "currentVersionId" TEXT,
    "retentionPolicyId" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientAddress" TEXT,
    "templateKey" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "jurisdiction" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "jurisdiction" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "action" TEXT NOT NULL DEFAULT 'warn',
    "conditions" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceUrl" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvaluation" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionOverride" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JurisdictionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "leaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bodyDraft" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "ruleEvaluationIds" JSONB NOT NULL DEFAULT '[]',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'allow',
    "requestId" TEXT NOT NULL,
    "purpose" TEXT,
    "policyVersion" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "classification" TEXT,
    "retainDays" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'review',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionAssignment" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'retained',
    "proposedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "disposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectEmail" TEXT NOT NULL,
    "subjectProfileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "identityVerifiedAt" TIMESTAMP(3),
    "identityMethod" TEXT,
    "discoveryJson" JSONB NOT NULL DEFAULT '{}',
    "exceptionsJson" JSONB NOT NULL DEFAULT '[]',
    "decision" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "confirmationDraft" TEXT,
    "manifestJson" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "approvedBy" TEXT NOT NULL,
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "leaseId" TEXT,
    "propertyId" TEXT,
    "tenantProfileId" TEXT,
    "leadLawyerId" TEXT,
    "privileged" BOOLEAN NOT NULL DEFAULT true,
    "deadlines" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyRequest" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "requesterUserId" TEXT,
    "kind" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "minimizationNotes" TEXT,
    "approvedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "exportJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "filtersJson" JSONB NOT NULL DEFAULT '{}',
    "redactionJson" JSONB NOT NULL DEFAULT '{}',
    "manifestJson" JSONB,
    "manifestSha256" TEXT,
    "storageKey" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "leaseId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantOrg_slug_key" ON "TenantOrg"("slug");

-- CreateIndex
CREATE INDEX "BusinessAccount_tenantOrgId_status_idx" ON "BusinessAccount"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "Subaccount_tenantOrgId_businessAccountId_idx" ON "Subaccount"("tenantOrgId", "businessAccountId");

-- CreateIndex
CREATE INDEX "UserProfile_email_idx" ON "UserProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_tenantOrgId_email_key" ON "UserProfile"("tenantOrgId", "email");

-- CreateIndex
CREATE INDEX "AccountLink_tenantOrgId_userId_idx" ON "AccountLink"("tenantOrgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLink_provider_providerId_key" ON "AccountLink"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_tenantOrgId_userId_idx" ON "Session"("tenantOrgId", "userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "SupportSession_tenantOrgId_agentUserId_idx" ON "SupportSession"("tenantOrgId", "agentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_tenantOrgId_email_idx" ON "Invitation"("tenantOrgId", "email");

-- CreateIndex
CREATE INDEX "RoleAssignment_tenantOrgId_userId_scopeType_scopeId_idx" ON "RoleAssignment"("tenantOrgId", "userId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "RoleAssignment_tenantOrgId_role_idx" ON "RoleAssignment"("tenantOrgId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RelationshipEdge_tenantOrgId_subjectType_subjectId_relation_idx" ON "RelationshipEdge"("tenantOrgId", "subjectType", "subjectId", "relation");

-- CreateIndex
CREATE INDEX "RelationshipEdge_tenantOrgId_objectType_objectId_relation_idx" ON "RelationshipEdge"("tenantOrgId", "objectType", "objectId", "relation");

-- CreateIndex
CREATE INDEX "SensitiveAccessRequest_tenantOrgId_actorId_resourceType_res_idx" ON "SensitiveAccessRequest"("tenantOrgId", "actorId", "resourceType", "resourceId", "status");

-- CreateIndex
CREATE INDEX "Portfolio_tenantOrgId_idx" ON "Portfolio"("tenantOrgId");

-- CreateIndex
CREATE INDEX "Property_tenantOrgId_status_city_idx" ON "Property"("tenantOrgId", "status", "city");

-- CreateIndex
CREATE INDEX "Property_tenantOrgId_portfolioId_idx" ON "Property"("tenantOrgId", "portfolioId");

-- CreateIndex
CREATE INDEX "Property_tenantOrgId_createdAt_id_idx" ON "Property"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Building_tenantOrgId_propertyId_idx" ON "Building"("tenantOrgId", "propertyId");

-- CreateIndex
CREATE INDEX "Unit_tenantOrgId_propertyId_status_idx" ON "Unit"("tenantOrgId", "propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_tenantOrgId_propertyId_unitNumber_key" ON "Unit"("tenantOrgId", "propertyId", "unitNumber");

-- CreateIndex
CREATE INDEX "UnitStatusHistory_tenantOrgId_unitId_changedAt_idx" ON "UnitStatusHistory"("tenantOrgId", "unitId", "changedAt");

-- CreateIndex
CREATE INDEX "TenantProfile_tenantOrgId_status_idx" ON "TenantProfile"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "TenantProfile_tenantOrgId_email_idx" ON "TenantProfile"("tenantOrgId", "email");

-- CreateIndex
CREATE INDEX "TenantProfile_tenantOrgId_createdAt_id_idx" ON "TenantProfile"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ContactMethod_tenantOrgId_tenantProfileId_idx" ON "ContactMethod"("tenantOrgId", "tenantProfileId");

-- CreateIndex
CREATE INDEX "EmergencyContact_tenantOrgId_tenantProfileId_idx" ON "EmergencyContact"("tenantOrgId", "tenantProfileId");

-- CreateIndex
CREATE INDEX "Occupant_tenantOrgId_tenantProfileId_idx" ON "Occupant"("tenantOrgId", "tenantProfileId");

-- CreateIndex
CREATE INDEX "Lease_tenantOrgId_unitId_status_idx" ON "Lease"("tenantOrgId", "unitId", "status");

-- CreateIndex
CREATE INDEX "Lease_tenantOrgId_propertyId_status_idx" ON "Lease"("tenantOrgId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Lease_tenantOrgId_createdAt_id_idx" ON "Lease"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LeaseVersion_tenantOrgId_leaseId_idx" ON "LeaseVersion"("tenantOrgId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseVersion_leaseId_version_key" ON "LeaseVersion"("leaseId", "version");

-- CreateIndex
CREATE INDEX "LeaseParty_tenantOrgId_tenantProfileId_idx" ON "LeaseParty"("tenantOrgId", "tenantProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseParty_leaseId_tenantProfileId_key" ON "LeaseParty"("leaseId", "tenantProfileId");

-- CreateIndex
CREATE INDEX "RecurringCharge_tenantOrgId_leaseId_idx" ON "RecurringCharge"("tenantOrgId", "leaseId");

-- CreateIndex
CREATE INDEX "Application_tenantOrgId_propertyId_status_idx" ON "Application"("tenantOrgId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "Application_tenantOrgId_applicantId_idx" ON "Application"("tenantOrgId", "applicantId");

-- CreateIndex
CREATE INDEX "ScreeningOrder_tenantOrgId_applicationId_idx" ON "ScreeningOrder"("tenantOrgId", "applicationId");

-- CreateIndex
CREATE INDEX "ScreeningResult_tenantOrgId_orderId_idx" ON "ScreeningResult"("tenantOrgId", "orderId");

-- CreateIndex
CREATE INDEX "AdverseAction_tenantOrgId_applicationId_idx" ON "AdverseAction"("tenantOrgId", "applicationId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantOrgId_status_priority_idx" ON "WorkOrder"("tenantOrgId", "status", "priority");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantOrgId_propertyId_status_idx" ON "WorkOrder"("tenantOrgId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantOrgId_assignedVendorId_idx" ON "WorkOrder"("tenantOrgId", "assignedVendorId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantOrgId_createdAt_id_idx" ON "WorkOrder"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WorkOrderEvent_tenantOrgId_workOrderId_createdAt_idx" ON "WorkOrderEvent"("tenantOrgId", "workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorProfile_tenantOrgId_status_idx" ON "VendorProfile"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "VendorContract_tenantOrgId_vendorId_idx" ON "VendorContract"("tenantOrgId", "vendorId");

-- CreateIndex
CREATE INDEX "Account_tenantOrgId_type_idx" ON "Account"("tenantOrgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantOrgId_code_key" ON "Account"("tenantOrgId", "code");

-- CreateIndex
CREATE INDEX "Invoice_tenantOrgId_leaseId_status_idx" ON "Invoice"("tenantOrgId", "leaseId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantOrgId_dueDate_status_idx" ON "Invoice"("tenantOrgId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantOrgId_createdAt_id_idx" ON "Invoice"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantOrgId_number_key" ON "Invoice"("tenantOrgId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantOrgId_invoiceId_idx" ON "InvoiceLine"("tenantOrgId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_tenantOrgId_invoiceId_status_idx" ON "Payment"("tenantOrgId", "invoiceId", "status");

-- CreateIndex
CREATE INDEX "Payment_provider_externalId_idx" ON "Payment"("provider", "externalId");

-- CreateIndex
CREATE INDEX "PaymentEvent_tenantOrgId_paymentId_idx" ON "PaymentEvent"("tenantOrgId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_externalEventId_key" ON "PaymentEvent"("provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_idempotencyKey_key" ON "JournalEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantOrgId_sourceType_sourceId_idx" ON "JournalEntry"("tenantOrgId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantOrgId_postedAt_idx" ON "JournalEntry"("tenantOrgId", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantOrgId_accountId_idx" ON "LedgerEntry"("tenantOrgId", "accountId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantOrgId_journalEntryId_idx" ON "LedgerEntry"("tenantOrgId", "journalEntryId");

-- CreateIndex
CREATE INDEX "Document_tenantOrgId_ownerType_ownerId_idx" ON "Document"("tenantOrgId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Document_tenantOrgId_classification_idx" ON "Document"("tenantOrgId", "classification");

-- CreateIndex
CREATE INDEX "Document_tenantOrgId_createdAt_id_idx" ON "Document"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantOrgId_documentId_idx" ON "DocumentVersion"("tenantOrgId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "MediaAsset_tenantOrgId_ownerType_ownerId_idx" ON "MediaAsset"("tenantOrgId", "ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_tenantOrgId_recipientId_status_idx" ON "Notification"("tenantOrgId", "recipientId", "status");

-- CreateIndex
CREATE INDEX "Notification_tenantOrgId_createdAt_id_idx" ON "Notification"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Template_tenantOrgId_key_key" ON "Template"("tenantOrgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "ComplianceRule_jurisdiction_domain_status_idx" ON "ComplianceRule"("jurisdiction", "domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRule_key_version_key" ON "ComplianceRule"("key", "version");

-- CreateIndex
CREATE INDEX "RuleEvaluation_tenantOrgId_result_createdAt_idx" ON "RuleEvaluation"("tenantOrgId", "result", "createdAt");

-- CreateIndex
CREATE INDEX "RuleEvaluation_tenantOrgId_resourceType_resourceId_idx" ON "RuleEvaluation"("tenantOrgId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionOverride_tenantOrgId_propertyId_key" ON "JurisdictionOverride"("tenantOrgId", "propertyId");

-- CreateIndex
CREATE INDEX "Notice_tenantOrgId_status_idx" ON "Notice"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "Notice_tenantOrgId_recipientId_idx" ON "Notice"("tenantOrgId", "recipientId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantOrgId_createdAt_idx" ON "AuditLog"("tenantOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantOrgId_resourceType_resourceId_idx" ON "AuditLog"("tenantOrgId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantOrgId_actorId_createdAt_idx" ON "AuditLog"("tenantOrgId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_tenantOrgId_key_key" ON "RetentionPolicy"("tenantOrgId", "key");

-- CreateIndex
CREATE INDEX "RetentionAssignment_tenantOrgId_retainUntil_state_idx" ON "RetentionAssignment"("tenantOrgId", "retainUntil", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionAssignment_tenantOrgId_resourceType_resourceId_key" ON "RetentionAssignment"("tenantOrgId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "PrivacyRequest_tenantOrgId_status_dueAt_idx" ON "PrivacyRequest"("tenantOrgId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "LegalHold_tenantOrgId_status_idx" ON "LegalHold"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "Case_tenantOrgId_status_idx" ON "Case"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "AgencyRequest_tenantOrgId_status_idx" ON "AgencyRequest"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "ExportJob_tenantOrgId_status_idx" ON "ExportJob"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_tenantOrgId_leaseId_idx" ON "SignatureEnvelope"("tenantOrgId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_provider_externalId_key" ON "SignatureEnvelope"("provider", "externalId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_tenantOrgId_key_key" ON "IdempotencyKey"("scope", "tenantOrgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_tenantOrgId_key_key" ON "FeatureFlag"("tenantOrgId", "key");

-- AddForeignKey
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subaccount" ADD CONSTRAINT "Subaccount_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subaccount" ADD CONSTRAINT "Subaccount_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "BusinessAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitStatusHistory" ADD CONSTRAINT "UnitStatusHistory_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMethod" ADD CONSTRAINT "ContactMethod_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "TenantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "TenantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occupant" ADD CONSTRAINT "Occupant_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "TenantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseVersion" ADD CONSTRAINT "LeaseVersion_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseParty" ADD CONSTRAINT "LeaseParty_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseParty" ADD CONSTRAINT "LeaseParty_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "TenantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningOrder" ADD CONSTRAINT "ScreeningOrder_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ScreeningOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseAction" ADD CONSTRAINT "AdverseAction_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assignedVendorId_fkey" FOREIGN KEY ("assignedVendorId") REFERENCES "VendorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorContract" ADD CONSTRAINT "VendorContract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantOrgId_fkey" FOREIGN KEY ("tenantOrgId") REFERENCES "TenantOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvaluation" ADD CONSTRAINT "RuleEvaluation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ComplianceRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
