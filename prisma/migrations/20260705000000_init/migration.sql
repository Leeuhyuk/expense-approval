-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVAL_PENDING', 'APPROVAL_IN_PROGRESS', 'APPROVED', 'REJECTED', 'HELD');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HELD', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('SCHEDULED', 'DUE_TODAY', 'COMPLETED', 'ERROR', 'HELD');

-- CreateEnum
CREATE TYPE "AccountVerificationStatus" AS ENUM ('VERIFIED', 'PENDING', 'MISMATCH', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('NORMAL', 'WARNING', 'EXCEEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_REQUESTED', 'APPROVAL_REJECTED', 'APPROVAL_HELD', 'APPROVAL_COMPLETED', 'DISBURSEMENT_SCHEDULED', 'DISBURSEMENT_COMPLETED', 'BUDGET_EXCEEDED', 'APPROVAL_DELAYED', 'SYSTEM_SETTING_CHANGED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COMPREHENSIVE', 'DISBURSEMENT', 'APPROVAL', 'BUDGET', 'VENDOR');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('READY', 'GENERATING', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "FavoriteKind" AS ENUM ('MENU', 'FILTER', 'REPORT', 'SHORTCUT');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "businessNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountEncrypted" TEXT NOT NULL,
    "bankAccountMasked" TEXT NOT NULL,
    "accountVerificationStatus" "AccountVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(18,2) NOT NULL,
    "usedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "BudgetStatus" NOT NULL DEFAULT 'NORMAL',
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(18,2) NOT NULL,
    "usedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "BudgetStatus" NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "requestCode" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "budgetItemId" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverId" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "actedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "id" UUID NOT NULL,
    "disbursementCode" TEXT NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'SCHEDULED',
    "accountVerificationStatus" "AccountVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledDate" DATE NOT NULL,
    "executedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "linkPath" TEXT,
    "readAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "definitionId" UUID,
    "createdBy" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'READY',
    "summary" TEXT,
    "artifactKey" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "recipients" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "FavoriteKind" NOT NULL,
    "pageKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetPath" TEXT,
    "filters" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favorite_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_businessNumber_key" ON "vendors"("businessNumber");

-- CreateIndex
CREATE INDEX "vendors_accountVerificationStatus_isActive_idx" ON "vendors"("accountVerificationStatus", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_departmentId_fiscalYear_key" ON "budgets"("departmentId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_requestCode_key" ON "payment_requests"("requestCode");

-- CreateIndex
CREATE INDEX "payment_requests_status_requestedAt_idx" ON "payment_requests"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "payment_requests_departmentId_requestedAt_idx" ON "payment_requests"("departmentId", "requestedAt");

-- CreateIndex
CREATE INDEX "payment_requests_vendorId_idx" ON "payment_requests"("vendorId");

-- CreateIndex
CREATE INDEX "approval_steps_approverId_status_idx" ON "approval_steps"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_paymentRequestId_stepOrder_key" ON "approval_steps"("paymentRequestId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "disbursements_disbursementCode_key" ON "disbursements"("disbursementCode");

-- CreateIndex
CREATE INDEX "disbursements_status_scheduledDate_idx" ON "disbursements"("status", "scheduledDate");

-- CreateIndex
CREATE INDEX "disbursements_vendorId_scheduledDate_idx" ON "disbursements"("vendorId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_ownerType_ownerId_idx" ON "attachments"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_idempotencyKey_key" ON "audit_logs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_type_createdAt_idx" ON "notifications"("type", "createdAt");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_revokedAt_idx" ON "auth_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "auth_sessions_idleExpiresAt_idx" ON "auth_sessions"("idleExpiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_absoluteExpiresAt_idx" ON "auth_sessions"("absoluteExpiresAt");

-- CreateIndex
CREATE INDEX "report_definitions_ownerId_type_idx" ON "report_definitions"("ownerId", "type");

-- CreateIndex
CREATE INDEX "report_runs_createdBy_createdAt_idx" ON "report_runs"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "report_runs_type_createdAt_idx" ON "report_runs"("type", "createdAt");

-- CreateIndex
CREATE INDEX "report_schedules_userId_isActive_idx" ON "report_schedules"("userId", "isActive");

-- CreateIndex
CREATE INDEX "report_schedules_definitionId_isActive_idx" ON "report_schedules"("definitionId", "isActive");

-- CreateIndex
CREATE INDEX "favorite_items_userId_kind_sortOrder_idx" ON "favorite_items"("userId", "kind", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_items_userId_kind_label_key" ON "favorite_items"("userId", "kind", "label");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "budget_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_items" ADD CONSTRAINT "favorite_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
