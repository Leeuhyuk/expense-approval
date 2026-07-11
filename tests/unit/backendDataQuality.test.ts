import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const dataQualitySource = readFileSync(resolve("backend/src/operations/dataQuality.ts"), "utf8");
const operationsRouteSource = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");

describe("backend data quality readiness checks", () => {
  it("checks migrated users, roles, vendors, budgets, requests, disbursements, and attachments", () => {
    const requiredChecks = [
      "active_users_without_roles",
      "active_users_in_inactive_departments",
      "active_roles_without_permissions",
      "active_vendors_missing_bank_data",
      "active_vendors_unverified",
      "active_vendors_missing_tax_email",
      "duplicate_active_vendor_names",
      "budgets_over_allocated",
      "budget_items_over_allocated",
      "open_requests_missing_budget",
      "open_requests_inactive_references",
      "open_requests_without_approval_steps",
      "submitted_requests_without_clean_attachment",
      "approved_requests_with_pending_steps",
      "pending_steps_with_inactive_approver",
      "open_disbursements_inactive_vendor",
      "orphan_payment_attachments",
      "orphan_vendor_attachments",
      "production_test_data_markers",
    ];

    for (const checkId of requiredChecks) {
      assert.match(dataQualitySource, new RegExp(`id: "${checkId}"`), `${checkId} must remain part of the data quality gate`);
    }
  });

  it("summarizes migration reconciliation totals without exposing raw account data", () => {
    assert.match(dataQualitySource, /paymentAmountsByStatus/, "payment amount totals by status must be included");
    assert.match(dataQualitySource, /disbursementAmountsByStatus/, "disbursement amount totals by status must be included");
    assert.match(dataQualitySource, /totalBudgetAllocated/, "budget allocated totals must be included");
    assert.match(dataQualitySource, /totalBudgetRemaining/, "budget remaining totals must be included");
    assert.match(dataQualitySource, /bankAccountEncrypted\.startsWith\("v1:"\)/, "vendor account checks must require encrypted bank accounts");
    assert.match(dataQualitySource, /bankAccountMasked\.includes\("\*\*\*\*"\)/, "vendor account checks must require masked bank accounts");
    assert.doesNotMatch(dataQualitySource, /decryptBankAccount|bankAccountDecrypted|rawAccount/, "data quality summaries must not expose raw or decrypted bank account values");
  });

  it("exposes a protected data quality endpoint for release and migration gates", () => {
    assert.match(operationsRouteSource, /app\.get\("\/operations\/data-quality"/, "data quality endpoint must be registered");
    assert.match(operationsRouteSource, /requireAuth\(/, "data quality endpoint must require authentication");
    assert.match(operationsRouteSource, /hasPermission\(user, "system:manage"\)/, "data quality endpoint must require system management permission");
    assert.match(operationsRouteSource, /reply\.send\(success\(request, summary\)\)/, "data quality findings must remain readable while summary.ok stays machine-detectable");
  });
});
