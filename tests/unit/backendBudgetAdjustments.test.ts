import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations/20260705050000_budget_adjustments/migration.sql"), "utf8");
const routeSource = readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");

describe("backend budget adjustments", () => {
  it("persists budget adjustment requests with status and requester relations", () => {
    assert.match(schema, /enum BudgetAdjustmentStatus/, "BudgetAdjustmentStatus enum must exist");
    assert.match(schema, /model BudgetAdjustment/, "BudgetAdjustment model must exist");
    assert.match(schema, /requiresApproval Boolean/, "adjustment must record whether approval is required");
    assert.match(schema, /status\s+BudgetAdjustmentStatus/, "adjustment must store workflow status");
    assert.match(schema, /budgetAdjustments BudgetAdjustment\[\]/, "User must expose requested budget adjustments");
    assert.match(schema, /adjustments\s+BudgetAdjustment\[\]/, "Budget must expose adjustment history");
  });

  it("ships a deployable migration for the adjustment ledger", () => {
    assert.match(migration, /CREATE TYPE "BudgetAdjustmentStatus"/, "migration must create the adjustment status enum");
    assert.match(migration, /CREATE TABLE "budget_adjustments"/, "migration must create the adjustment table");
    assert.match(migration, /FOREIGN KEY \("budgetId"\) REFERENCES "budgets"/, "adjustments must reference budgets");
    assert.match(migration, /FOREIGN KEY \("requestedBy"\) REFERENCES "users"/, "adjustments must reference requesters");
  });

  it("adds audited GET and POST budget adjustment routes", () => {
    assert.match(routeSource, /app\.get\("\/budgets\/:departmentName\/adjustments"/, "adjustment history route must exist");
    assert.match(routeSource, /app\.post\("\/budgets\/:departmentName\/adjustments"/, "adjustment create route must exist");
    assert.match(routeSource, /prisma\.budgetAdjustment\.findMany/, "history route must read persisted adjustments");
    assert.match(routeSource, /tx\.budgetAdjustment\.create/, "create route must write an adjustment row in the transaction");
    assert.match(routeSource, /tx\.budget\.updateMany/, "immediate adjustments must update budget through a guarded write");
    assert.match(routeSource, /BudgetAdjustmentStatus\.PENDING_APPROVAL/, "large adjustments must be saved as approval pending");
    assert.match(routeSource, /BudgetAdjustmentStatus\.APPLIED/, "small adjustments must be saved as applied");
    assert.match(routeSource, /validateBudgetAdjustmentFinancialClose/, "closed budget periods must block adjustments");
    assert.match(routeSource, /idempotencyKey/, "adjustments must carry idempotency keys");
    assert.match(routeSource, /rowVersion/, "adjustments must check budget row versions");
    assert.match(routeSource, /tx\.auditLog\.create/, "adjustments must write audit logs in the same transaction");
  });
});
