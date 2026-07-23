import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
const serviceSource = readFileSync(resolve("src/api/service.ts"), "utf8");
const mockServiceSource = readFileSync(resolve("src/api/mockService.ts"), "utf8");

describe("frontend budget adjustments", () => {
  it("uses backend APIs for adjustment creation and history", () => {
    assert.match(mainSource, /erpApi\s*\.\s*listBudgetAdjustments\(selectedDepartment\)/, "BudgetBody must load adjustment history from the API");
    assert.match(mainSource, /erpApi\s*\.\s*createBudgetAdjustment\(selectedRow\.부서/, "BudgetBody must submit adjustments through the API");
    assert.match(mainSource, /예산RowVersion/, "BudgetBody must submit budget rowVersion for stale write protection");
    assert.match(mainSource, /idempotencyKey:\s*`budget-adjust-/, "BudgetBody must send an idempotency key for duplicate-click protection");
    assert.match(mainSource, /table\.refresh\(\)/, "BudgetBody must refresh the budget table after adjustment submission");
    assert.match(mainSource, /formatBudgetAdjustmentHistory/, "BudgetDetailPanel history must be formatted from API rows");
    assert.doesNotMatch(mainSource, /setAdjustments/, "BudgetBody must not keep budget changes only in local state");
    assert.doesNotMatch(mainSource, /applyBudgetAdjustment/, "BudgetBody must not synthesize budget totals only on the client");
  });

  it("keeps remote and mock services on the same budget adjustment contract", () => {
    assert.match(serviceSource, /export type BudgetAdjustmentInput/, "service must expose the adjustment input contract");
    assert.match(serviceSource, /export type BudgetAdjustmentResult/, "service must expose the adjustment result contract");
    assert.match(serviceSource, /listBudgetAdjustments\(departmentName: string\)/, "service interface must expose history loading");
    assert.match(serviceSource, /createBudgetAdjustment\(departmentName: string, input: BudgetAdjustmentInput\)/, "service interface must expose creation");
    assert.match(serviceSource, /\/budgets\/\$\{encodeURIComponent\(departmentName\)\}\/adjustments/, "remote service must call the backend adjustment resource");
    assert.match(mockServiceSource, /mockBudgetAdjustmentStore/, "mock service must persist adjustment history");
    assert.match(mockServiceSource, /updatePageRow\("budget", departmentName/, "mock immediate adjustments must update budget rows");
    assert.match(mockServiceSource, /input\.amount >= 10_000_000/, "mock approval threshold must match the backend threshold");
  });
});
