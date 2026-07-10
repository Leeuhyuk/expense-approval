CREATE TYPE "DataQualityRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "data_quality_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "DataQualityRunStatus" NOT NULL DEFAULT 'RUNNING',
    "source" TEXT NOT NULL,
    "scheduleKey" TEXT,
    "requestedBy" UUID,
    "requestId" TEXT NOT NULL,
    "summary" JSONB,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_quality_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_quality_runs_scheduleKey_key" ON "data_quality_runs"("scheduleKey");
CREATE INDEX "data_quality_runs_status_startedAt_idx" ON "data_quality_runs"("status", "startedAt");
CREATE INDEX "data_quality_runs_requestedBy_startedAt_idx" ON "data_quality_runs"("requestedBy", "startedAt");

ALTER TABLE "data_quality_runs"
ADD CONSTRAINT "data_quality_runs_requestedBy_fkey"
FOREIGN KEY ("requestedBy") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;