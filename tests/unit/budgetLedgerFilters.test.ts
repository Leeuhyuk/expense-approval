import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const routeSource = readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
const mockDataSource = readFileSync(resolve("src/mockData.ts"), "utf8");
const seedSource = readFileSync(resolve("prisma/seed.ts"), "utf8");

describe("budget ledger filters", () => {
  it("exposes fiscal year and budget item fields from backend budget rows", () => {
    assert.match(routeSource, /const budgetRowInclude = \{[\s\S]*items: true/, "budget list must load BudgetItem ledger rows");
    assert.match(routeSource, /회계연도: item\.fiscalYear/, "budget rows must expose fiscal year for period filters");
    assert.match(routeSource, /기간: `\$\{item\.fiscalYear\}-01-01 ~ \$\{item\.fiscalYear\}-12-31`/, "budget rows must expose a period label");
    assert.match(routeSource, /예산항목: item\.items\.map/, "budget rows must expose budget item names for category filters");
    assert.match(routeSource, /rowsResponse\(request, items\.map\(toBudgetRow\)\)/, "budget list must filter and paginate mapped backend rows");
  });

  it("passes budget filter buttons through the budget API query", () => {
    assert.match(mainSource, /const periodOptions = \["2026-01-01 ~ 2026-12-31"/, "budget period filters must match the seeded fiscal year");
    assert.match(mainSource, /const budgetQueryFilters = useMemo/, "BudgetBody must derive API filters from UI controls");
    assert.match(mainSource, /회계연도: fiscalYearFilter/, "period selection must be sent as a fiscal year filter");
    assert.match(mainSource, /부서: departmentFilter/, "department selection must be sent as a department filter");
    assert.match(mainSource, /예산항목: categoryFilter/, "category selection must be sent as a budget item filter");
    assert.match(mainSource, /상태: statusFilter/, "status selection must be sent as a status filter");
    assert.match(mainSource, /useManagedTable\("budget", "", budgetQueryFilters\)/, "budget table must load rows from API with those filters");
  });

  it("keeps mock and seed data aligned with budget filter names", () => {
    assert.match(mockDataSource, /회계연도: "2026"/, "mock budget rows must include fiscal year");
    assert.match(mockDataSource, /예산항목: "광고\/마케팅비/, "mock budget rows must include visible category names");
    assert.match(mockDataSource, /예산항목: "SW\/IT 비용/, "mock budget rows must include IT category names");
    assert.match(seedSource, /name: "광고\/마케팅비"/, "seed BudgetItem names must match frontend category filters");
    assert.match(seedSource, /name: "SW\/IT 비용"/, "seed BudgetItem names must match frontend category filters");
  });
});
