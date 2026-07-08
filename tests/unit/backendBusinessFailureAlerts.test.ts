import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { NotificationType } from "../../backend/generated/prisma/index";
import {
  businessFailureRules,
  businessFailureThreshold,
  getBusinessFailureAlertSummary,
  notifyBusinessFailureOwners,
} from "../../backend/src/operations/businessFailureAlerts";

const operationsRouteSource = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");
const notificationRouteSource = readFileSync(resolve("backend/src/routes/notifications.ts"), "utf8");
const schemaSource = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migrationSource = readFileSync(resolve("prisma/migrations/20260706010000_operational_alert_notifications/migration.sql"), "utf8");

function event(overrides: Partial<{
  id: string;
  eventType: string;
  errorCode: string;
  message: string;
  statusCode: number;
  path: string | null;
  requestId: string;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    eventType: overrides.eventType ?? "workflow_blocked",
    errorCode: overrides.errorCode ?? "WORKFLOW_LOCKED",
    message: overrides.message ?? "blocked",
    statusCode: overrides.statusCode ?? 409,
    path: overrides.path ?? "/api/approvals/PR-2026-0001",
    requestId: overrides.requestId ?? "req-test",
    createdAt: overrides.createdAt ?? new Date(),
  };
}

describe("backend business failure alerts", () => {
  it("classifies approval, disbursement, report, notification, and file failures by path", () => {
    assert.deepEqual(
      businessFailureRules.map((rule) => rule.id),
      [
        "approval_processing_failure",
        "disbursement_processing_failure",
        "report_processing_failure",
        "notification_processing_failure",
        "file_processing_failure",
      ],
    );

    const approvalRule = businessFailureRules.find((rule) => rule.id === "approval_processing_failure");
    assert.ok(approvalRule);
    assert.ok(approvalRule.eventTypes.includes("partial_failure"), "partial failures must be grouped with approval processing failures");
    assert.equal(businessFailureThreshold(approvalRule, { ALERT_APPROVAL_FAILURE_THRESHOLD: "3" } as NodeJS.ProcessEnv), 3);
    assert.equal(businessFailureThreshold(approvalRule, { ALERT_APPROVAL_FAILURE_THRESHOLD: "bad" } as NodeJS.ProcessEnv), 1);
  });

  it("summarizes triggered business failure rules from security_events", async () => {
    const db = {
      securityEvent: {
        findMany: async () => [
          event({ id: "approval-1", requestId: "req-approval-1" }),
          event({ id: "approval-2", requestId: "req-approval-2", eventType: "partial_failure", errorCode: "PARTIAL_FAILURE" }),
          event({ id: "file-1", eventType: "file_scan_unavailable", path: "/api/files/file-1/content", errorCode: "FILE_SCAN_UNAVAILABLE", statusCode: 503 }),
          event({ id: "ignored-1", path: "/api/dashboard", eventType: "workflow_blocked" }),
        ],
      },
    } as any;

    const summary = await getBusinessFailureAlertSummary(
      {
        ALERT_WINDOW_MINUTES: "30",
        ALERT_APPROVAL_FAILURE_THRESHOLD: "2",
        ALERT_FILE_PROCESSING_FAILURE_THRESHOLD: "2",
      } as NodeJS.ProcessEnv,
      db,
    );

    const approval = summary.rules.find((rule) => rule.id === "approval_processing_failure");
    const file = summary.rules.find((rule) => rule.id === "file_processing_failure");
    assert.equal(summary.ok, false);
    assert.equal(approval?.count, 2);
    assert.equal(approval?.ok, false);
    assert.equal(approval?.recentEvents[0]?.requestId, "req-approval-1");
    assert.equal(file?.count, 1);
    assert.equal(file?.ok, true);
  });

  it("notifies active system managers once per triggered domain and window", async () => {
    const createdRows: any[] = [];
    const db = {
      securityEvent: {
        findMany: async () => [
          event({
            id: "report-1",
            eventType: "server_failure",
            path: "/api/reports/monthly/download",
            errorCode: "SERVER_ERROR",
            statusCode: 500,
            requestId: "req-report-1",
          }),
        ],
      },
      user: {
        findMany: async () => [
          { id: "manager-1", roles: [{ role: { isActive: true, permissions: ["system:manage"] } }] },
          { id: "admin-1", roles: [{ role: { isActive: true, permissions: ["*"] } }] },
          { id: "viewer-1", roles: [{ role: { isActive: true, permissions: ["dashboard:read"] } }] },
          { id: "inactive-role-1", roles: [{ role: { isActive: false, permissions: ["system:manage"] } }] },
        ],
      },
      notification: {
        findMany: async () => [{ userId: "manager-1", entityId: "report_processing_failure" }],
        createMany: async ({ data }: { data: any[] }) => {
          createdRows.push(...data);
          return { count: data.length };
        },
      },
    } as any;

    const result = await notifyBusinessFailureOwners({ ALERT_REPORT_FAILURE_THRESHOLD: "1" } as NodeJS.ProcessEnv, db);

    assert.equal(result.recipientCount, 2);
    assert.equal(result.notificationsCreated, 1);
    assert.equal(createdRows[0].userId, "admin-1");
    assert.equal(createdRows[0].type, NotificationType.OPERATIONAL_ALERT);
    assert.equal(createdRows[0].entityType, "BUSINESS_FAILURE_ALERT");
    assert.equal(createdRows[0].entityId, "report_processing_failure");
    assert.equal(createdRows[0].linkPath, "#reports");
  });

  it("exposes protected business failure alert routes and notification DTO mapping", () => {
    assert.match(operationsRouteSource, /app\.get\("\/operations\/business-failure-alerts"/, "business failure summary route must be registered");
    assert.match(operationsRouteSource, /app\.post\("\/operations\/business-failure-alerts\/notify"/, "business failure notify route must be registered");
    assert.match(operationsRouteSource, /notifyBusinessFailureOwners\(\)/, "notify route must enqueue owner notifications");
    assert.match(operationsRouteSource, /hasPermission\(user, "system:manage"\)/, "business failure alert routes must require system management permission");
    assert.match(notificationRouteSource, /OPERATIONAL_ALERT: "operational_alert"/, "notification DTO must expose operational alerts");
    assert.match(schemaSource, /OPERATIONAL_ALERT/, "Prisma notification enum must include operational alerts");
    assert.match(migrationSource, /ADD VALUE 'OPERATIONAL_ALERT'/, "migration must add the operational alert enum value");
  });
});
