CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX "audit_logs_requestId_idx" ON "audit_logs"("requestId");
