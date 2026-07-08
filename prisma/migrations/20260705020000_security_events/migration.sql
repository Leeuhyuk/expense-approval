CREATE TABLE "security_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "actorId" UUID,
  "targetType" TEXT,
  "targetId" TEXT,
  "requestId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "method" TEXT,
  "path" TEXT,
  "statusCode" INTEGER NOT NULL,
  "errorCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_events_eventType_createdAt_idx" ON "security_events"("eventType", "createdAt");
CREATE INDEX "security_events_errorCode_createdAt_idx" ON "security_events"("errorCode", "createdAt");
CREATE INDEX "security_events_actorId_createdAt_idx" ON "security_events"("actorId", "createdAt");

ALTER TABLE "security_events"
ADD CONSTRAINT "security_events_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
