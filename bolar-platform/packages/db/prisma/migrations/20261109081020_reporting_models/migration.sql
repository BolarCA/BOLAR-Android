-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filtersJson" JSONB NOT NULL DEFAULT '{}',
    "scopeJson" JSONB,
    "scheduleCron" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL DEFAULT 'csv',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "format" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "rowCount" INTEGER,
    "storageKey" TEXT,
    "sha256" TEXT,
    "error" TEXT,
    "requestedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDefinition_tenantOrgId_status_idx" ON "ReportDefinition"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "ReportDefinition_tenantOrgId_createdAt_id_idx" ON "ReportDefinition"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReportRun_tenantOrgId_definitionId_createdAt_idx" ON "ReportRun"("tenantOrgId", "definitionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_tenantOrgId_status_idx" ON "ReportRun"("tenantOrgId", "status");

-- CreateIndex
CREATE INDEX "ReportRun_tenantOrgId_createdAt_id_idx" ON "ReportRun"("tenantOrgId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
