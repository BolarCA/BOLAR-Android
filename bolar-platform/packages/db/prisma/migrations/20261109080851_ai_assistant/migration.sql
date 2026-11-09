-- CreateTable
CREATE TABLE "AiThread" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contextType" TEXT,
    "contextId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costCents" INTEGER,
    "redactionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToolCall" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT,
    "inputSummary" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "draftRef" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBudget" (
    "id" TEXT NOT NULL,
    "tenantOrgId" TEXT NOT NULL,
    "monthlyLimitCents" INTEGER NOT NULL,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiThread_tenantOrgId_createdBy_createdAt_idx" ON "AiThread"("tenantOrgId", "createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "AiThread_tenantOrgId_createdAt_id_idx" ON "AiThread"("tenantOrgId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiMessage_tenantOrgId_threadId_createdAt_idx" ON "AiMessage"("tenantOrgId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_tenantOrgId_threadId_createdAt_idx" ON "AiToolCall"("tenantOrgId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_tenantOrgId_status_createdAt_idx" ON "AiToolCall"("tenantOrgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_tenantOrgId_tool_createdAt_idx" ON "AiToolCall"("tenantOrgId", "tool", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_tenantOrgId_key" ON "AiBudget"("tenantOrgId");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiToolCall" ADD CONSTRAINT "AiToolCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
