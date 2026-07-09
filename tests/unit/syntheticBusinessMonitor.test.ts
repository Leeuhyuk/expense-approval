import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const packageJson = read("package.json");
const monitorScript = read("scripts/run-synthetic-business-monitor.mjs");
const coreSmokeRunbook = read("docs/core-smoke-runbook.md");
const deploymentOperations = read("docs/deployment-operations.md");
const checklist = read("erp-system-checklist.md");

describe("synthetic business monitor", () => {
  it("adds a release script for scheduled synthetic monitoring", () => {
    assert.match(packageJson, /"release:synthetic-monitor": "node scripts\/run-synthetic-business-monitor\.mjs"/);
    assert.match(monitorScript, /SYNTHETIC_MONITOR_API_BASE_URL/);
    assert.match(monitorScript, /SYNTHETIC_MONITOR_REQUIRE_CONFIG/);
    assert.match(monitorScript, /SYNTHETIC_MONITOR_OUTPUT/);
  });

  it("covers login through pre-disbursement read-only business paths", () => {
    for (const path of [
      "/auth/login",
      "/auth/me",
      "/dashboard?page=1&pageSize=5",
      "/payment-requests?page=1&pageSize=5",
      "/approvals?page=1&pageSize=5",
      "/budgets?page=1&pageSize=5",
      "/vendors?page=1&pageSize=5",
      "/reports?page=1&pageSize=5",
      "/disbursements?page=1&pageSize=5",
      "/operations/mode",
    ]) {
      assert.match(monitorScript, new RegExp(path.replace(/[/?=]/g, "\\$&")));
    }
    assert.doesNotMatch(monitorScript, /disbursements\/.+(execute|run|approve)|bank-transfer|reconcile/);
  });

  it("documents operations setup and checklist completion", () => {
    assert.match(coreSmokeRunbook, /release:synthetic-monitor/);
    assert.match(coreSmokeRunbook, /SYNTHETIC_MONITOR_MAX_LATENCY_MS/);
    assert.match(deploymentOperations, /release:synthetic-monitor/);
    assert.match(deploymentOperations, /SYNTHETIC_MONITOR_OUTPUT/);
    assert.match(checklist, /\[x\] P2: synthetic monitoring/);
  });
});
