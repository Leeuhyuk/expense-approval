-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" UUID;

-- AlterTable
ALTER TABLE "security_events" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "payment_requests_deletedAt_idx" ON "payment_requests"("deletedAt");
