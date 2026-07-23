import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const schema = read("prisma/schema.prisma");
const seed = read("prisma/seed.ts");
const service = read("src/api/service.ts");
const backendSources = [
  "backend/src/auth/session.ts",
  "backend/src/app.ts",
  "backend/src/routes/approvals.ts",
  "backend/src/routes/auth.ts",
  "backend/src/routes/disbursements.ts",
  "backend/src/routes/files.ts",
  "backend/src/routes/notifications.ts",
  "backend/src/routes/operations.ts",
  "backend/src/routes/pageResources.ts",
  "backend/src/routes/paymentRequests.ts",
  "backend/src/operations/businessFailureAlerts.ts",
  "backend/src/operations/dataQuality.ts",
  "backend/src/operations/operationalAlerts.ts",
  "backend/src/security/securityEvents.ts",
].map(read).join("\n");

const integrationHarnesses = [
  "tests/integration/backendDataPersistence.test.ts",
  "tests/integration/backendSettingsPersistence.test.ts",
  "tests/integration/backendPaymentRequestFlow.test.ts",
  "tests/integration/backendNotificationOperationsFlow.test.ts",
  "tests/integration/backendOperatingDataFlow.test.ts",
] as const;

const integrationSources = integrationHarnesses.map(read).join("\n");

const seededModels = [
  ["Department", "department"],
  ["User", "user"],
  ["Role", "role"],
  ["UserRole", "userRole"],
  ["Vendor", "vendor"],
  ["Budget", "budget"],
  ["BudgetAdjustment", "budgetAdjustment"],
  ["BudgetItem", "budgetItem"],
  ["PaymentRequest", "paymentRequest"],
  ["ApprovalStep", "approvalStep"],
  ["Disbursement", "disbursement"],
  ["Attachment", "attachment"],
  ["AuditLog", "auditLog"],
  ["Notification", "notification"],
  ["ReportDefinition", "reportDefinition"],
  ["ReportRun", "reportRun"],
  ["ReportSchedule", "reportSchedule"],
  ["FavoriteItem", "favoriteItem"],
] as const;

const runtimeModels = [
  ["SecurityEvent", "securityEvent"],
  ["AuthSession", "authSession"],
] as const;

describe("core Prisma model coverage", () => {
  it("keeps business models present in schema and seed data", () => {
    for (const [modelName, delegateName] of seededModels) {
      assert.match(schema, new RegExp(`model\\s+${modelName}\\s+{`), `${modelName} must remain in the Prisma schema`);
      assert.match(seed, new RegExp(`prisma\\.${delegateName}\\.upsert\\(`), `${modelName} must have deterministic seed data`);
    }
  });

  it("keeps runtime-only models wired to backend services", () => {
    for (const [modelName, delegateName] of runtimeModels) {
      assert.match(schema, new RegExp(`model\\s+${modelName}\\s+{`), `${modelName} must remain in the Prisma schema`);
      assert.match(backendSources, new RegExp(`(?:prisma|db)\\.${delegateName}\\.`), `${modelName} must be used by runtime backend code`);
      assert.doesNotMatch(seed, new RegExp(`prisma\\.${delegateName}\\.upsert\\(`), `${modelName} should not be seeded because it is operational runtime data`);
    }
  });

  it("keeps core model routes attached to Prisma delegates", () => {
    for (const [modelName, delegateName] of [...seededModels, ...runtimeModels]) {
      assert.match(
        backendSources,
        new RegExp(`(?:prisma|tx|db)\\.${delegateName}\\.`),
        `${modelName} must be connected to a backend route, auth service, or security service`,
      );
    }
  });

  it("keeps UI-facing data operations exposed by the frontend API service", () => {
    const serviceMethods = [
      "getCurrentUser",
      "login",
      "logout",
      "listNotifications",
      "markNotificationRead",
      "markAllNotificationsRead",
      "getPaymentRequestMasterData",
      "listPageRows",
      "getPageRow",
      "createPageRow",
      "updatePageRow",
      "deletePageRow",
      "executePageAction",
      "listBudgetAdjustments",
      "createBudgetAdjustment",
      "downloadReport",
      "listReportSchedules",
      "createReportSchedule",
      "updateReportSchedule",
      "deleteReportSchedule",
      "exportDisbursementBankTransfer",
      "reconcileDisbursementBankResults",
      "presignFileUpload",
      "uploadFileContent",
      "completeFileUpload",
      "listFiles",
      "getFileDownload",
      "deleteFile",
      "listRoleSettings",
      "createRoleSettings",
      "updateRoleSettings",
      "deleteRoleSettings",
      "getSystemSettings",
      "saveSystemSetting",
      "testIntegrationSetting",
    ];

    for (const method of serviceMethods) {
      assert.match(service, new RegExp(`\\b${method}\\b`), `${method} must remain part of the frontend API contract`);
    }

    const pagePaths = [
      ["payment-request", "/payment-requests"],
      ["approval", "/approvals"],
      ["disbursement", "/disbursements"],
      ["budget", "/budgets"],
      ["vendors", "/vendors"],
      ["reports", "/reports"],
      ["settings", "/settings"],
      ["favorites", "/favorites"],
    ] as const;

    for (const [page, path] of pagePaths) {
      const key = page.includes("-") ? `"${page}"` : `"?${page}"?`;
      assert.match(service, new RegExp(`${key}\\s*:\\s*"${path}"`), `${page} must remain mapped to ${path}`);
    }
  });

  it("keeps DB-backed integration harnesses attached to operational Prisma models", () => {
    const dbBackedModels = [
      ["BudgetAdjustment", "budgetAdjustment"],
      ["Disbursement", "disbursement"],
      ["ReportDefinition", "reportDefinition"],
      ["ReportRun", "reportRun"],
      ["ReportSchedule", "reportSchedule"],
      ["FavoriteItem", "favoriteItem"],
      ["AuditLog", "auditLog"],
      ["Notification", "notification"],
    ] as const;

    for (const harness of integrationHarnesses) {
      assert.equal(existsSync(resolve(harness)), true, `${harness} must remain in the DB-backed integration coverage set`);
    }

    for (const [modelName, delegateName] of dbBackedModels) {
      assert.match(
        integrationSources,
        new RegExp(`prisma\\.${delegateName}\\.`),
        `${modelName} must have DB-backed integration evidence through Prisma`,
      );
    }
  });

  it("keeps focused regression tests around high-risk operating flows", () => {
    const expectedTests = [
      "tests/unit/apiMutationSpecCoverage.test.ts",
      "tests/unit/backendBudgetAdjustments.test.ts",
      "tests/unit/backendBusinessFailureAlerts.test.ts",
      "tests/unit/backendDataQuality.test.ts",
      "tests/unit/backendFileSecurity.test.ts",
      "tests/unit/backendOperationalAlerts.test.ts",
      "tests/unit/backendOperationalHealth.test.ts",
      "tests/unit/backendRoutePermissionGuards.test.ts",
      "tests/unit/backendSecurityEvents.test.ts",
      "tests/unit/ciReleaseGates.test.ts",
      "tests/unit/dbTestEvidenceGate.test.ts",
      "tests/unit/failureCorrelation.test.ts",
      "tests/unit/frontendAuthFlow.test.ts",
      "tests/unit/goLiveReadiness.test.ts",
      "tests/unit/migrationReview.test.ts",
      "tests/unit/mutationSafetyGate.test.ts",
      "tests/unit/mutationSafetyMatrix.test.ts",
      "tests/unit/frontendFavoritesRemote.test.ts",
      "tests/unit/frontendReportSchedules.test.ts",
      "tests/unit/notificationLifecycle.test.ts",
      "tests/unit/raceConditionControls.test.ts",
      "tests/unit/reportFavoriteConcurrencyFlow.test.ts",
      "tests/unit/releaseManifest.test.ts",
      "tests/unit/releaseManifestVerify.test.ts",
      "tests/unit/settingsConfigSnapshotConcurrency.test.ts",
      "tests/unit/settingsConcurrencyFlow.test.ts",
      "tests/unit/vendorPersistenceFlow.test.ts",
    ];

    for (const testFile of expectedTests) {
      assert.equal(existsSync(resolve(testFile)), true, `${testFile} must remain in the unit coverage set`);
    }
  });
});
