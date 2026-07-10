import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { buildCapacityPlanningReport, type CapacityPlanningBaseline } from "../../backend/src/operations/capacityPlanningReport";

const baseline: CapacityPlanningBaseline = {
  paymentRequests: 12_000,
  approvalSteps: 18_000,
  disbursements: 6_000,
  vendors: 300,
  notifications: 500,
  reportRuns: 250,
  dataQualityRuns: 60,
  auditLogs: 80_000,
  attachments: 24_000,
  attachmentBytes: 18 * 1024 ** 3,
};

describe("capacity planning report", () => {
  it("projects current baseline and twelve monthly growth points deterministically", () => {
    const report = buildCapacityPlanningReport(baseline, {}, new Date("2026-07-10T00:00:00.000Z"));

    assert.equal(report.baselineMonth, "2026-07");
    assert.equal(report.forecast.length, 13);
    assert.equal(report.forecast[0].month, "2026-07");
    assert.equal(report.forecast[12].month, "2027-07");
    assert.ok(report.forecast[12].businessRows > report.forecast[0].businessRows);
    assert.ok(report.forecast[12].auditLogs > report.forecast[0].auditLogs);
    assert.equal(report.summary.nextReviewMonth, "2026-08");
  });

  it("accepts zero growth for a frozen or stable operating period", () => {
    const report = buildCapacityPlanningReport(
      baseline,
      {
        CAPACITY_TRANSACTION_GROWTH_PERCENT: "0",
        CAPACITY_AUDIT_GROWTH_PERCENT: "0",
        CAPACITY_ATTACHMENT_GROWTH_PERCENT: "0",
      },
      new Date("2026-07-10T00:00:00.000Z"),
    );

    assert.equal(report.forecast[12].businessRows, report.forecast[0].businessRows);
    assert.equal(report.forecast[12].auditLogs, report.forecast[0].auditLogs);
    assert.equal(report.forecast[12].objectStorageBytes, report.forecast[0].objectStorageBytes);
  });
  it("identifies warning and critical months before storage limits are exhausted", () => {
    const report = buildCapacityPlanningReport(
      baseline,
      {
        CAPACITY_OBJECT_STORAGE_LIMIT_BYTES: String(24 * 1024 ** 3),
        CAPACITY_WARNING_PERCENT: "70",
        CAPACITY_CRITICAL_PERCENT: "90",
        CAPACITY_ATTACHMENT_GROWTH_PERCENT: "10",
      },
      new Date("2026-07-10T00:00:00.000Z"),
    );

    assert.equal(report.actionRequired, true);
    assert.equal(report.summary.firstWarningMonth, "2026-07");
    assert.ok(report.summary.firstCriticalMonth);
    assert.ok(report.recommendedActions.some((action) => action.includes("storage")));
  });

  it("wires a protected backend route to remote, mock, settings UI, docs, and release checks", () => {
    const route = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");
    const service = readFileSync(resolve("src/api/service.ts"), "utf8");
    const mock = readFileSync(resolve("src/api/mockService.ts"), "utf8");
    const main = readFileSync(resolve("src/main.tsx"), "utf8");
    const docs = readFileSync(resolve("docs/capacity-planning.md"), "utf8");

    assert.match(route, /app\.get\("\/operations\/capacity-planning"[\s\S]*hasPermission\(user, "system:manage"\)[\s\S]*getCapacityPlanningReport\(\)/);
    assert.match(service, /getCapacityPlanningReport\(\)[\s\S]*requestRemote<CapacityPlanningReport>\("\/operations\/capacity-planning"\)/);
    assert.match(mock, /buildMockCapacityPlanningReport[\s\S]*async getCapacityPlanningReport\(\)/);
    assert.match(main, /function CapacityPlanningCard[\s\S]*12개월 용량 계획/);
    assert.match(main, /capacity-planning-card/);
    assert.match(docs, /CAPACITY_DATABASE_LIMIT_BYTES[\s\S]*CAPACITY_OBJECT_STORAGE_LIMIT_BYTES[\s\S]*월별/);
  });
});
