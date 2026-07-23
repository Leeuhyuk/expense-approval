-- CreateEnum
CREATE TYPE "BudgetAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "budget_adjustments" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "status" "BudgetAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_adjustments_budgetId_createdAt_idx" ON "budget_adjustments"("budgetId", "createdAt");

-- CreateIndex
CREATE INDEX "budget_adjustments_requestedBy_status_idx" ON "budget_adjustments"("requestedBy", "status");

-- AddForeignKey
ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
