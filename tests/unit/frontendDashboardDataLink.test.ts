import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend dashboard data linkage", () => {
  it("uses dashboard API rows for KPI, urgent approvals, and recent payment requests", () => {
    const source = readFileSync(resolve("src/main.tsx"), "utf8");

    assert.match(source, /useManagedTable\("dashboard", ""\)/, "dashboard must load rows through erpApi.listPageRows");
    assert.match(source, /buildDashboardKpis\(page\.kpis, table\.rows\)/, "dashboard KPI cards must be computed from dashboard rows");
    assert.match(source, /<DashboardUrgentPayments rows=\{table\.rows\}/, "urgent approvals must use dashboard rows");
    assert.match(source, /<DashboardRecentPayments[\s\S]*rows=\{table\.rows\}/, "recent payment table must use dashboard rows");
    assert.match(source, /<DashboardRecentActivity notifications=\{notifications\}/, "recent activity must use notification-center data");
  });

  it("uses the backend current approver from the approval row when enabling approval buttons", () => {
    const source = readFileSync(resolve("src/main.tsx"), "utf8");

    assert.match(source, /const currentAssignee = lineText\.split\(" 외 "\)/, "approval UI must read the current backend assignee from 결재선");
    assert.match(source, /getCurrentApprovalStep\(row, currentUser\)\?\.name === currentUser\.name/, "approval buttons must only enable for the current assignee");
    assert.match(source, /function withApprovalMutationGuards/, "approval mutations must include a shared concurrency guard payload");
    assert.match(source, /요청RowVersion: row\.요청RowVersion/, "approval mutations must send the payment request row version");
    assert.match(source, /결재RowVersion: row\.결재RowVersion/, "approval mutations must send the approval step row version");
    assert.match(source, /idempotencyKey: `approval-\$\{action\}/, "approval mutations must include an idempotency key");
  });
});
