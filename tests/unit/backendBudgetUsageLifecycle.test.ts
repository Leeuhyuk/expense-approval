import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const approvalSource = readFileSync(resolve("backend/src/routes/approvals.ts"), "utf8");
const paymentRequestSource = readFileSync(resolve("backend/src/routes/paymentRequests.ts"), "utf8");
const disbursementSource = readFileSync(resolve("backend/src/routes/disbursements.ts"), "utf8");
const pageResourceSource = readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");

describe("backend budget usage lifecycle", () => {
  it("applies budget usage exactly when approval reaches final approved", () => {
    assert.match(approvalSource, /async function applyBudgetUsageOnFinalApproval/, "approval route must own final approval budget usage");
    assert.match(approvalSource, /nextPaymentStatus !== PaymentRequestStatus\.APPROVED/, "budget usage must only run for final approved transitions");
    assert.match(approvalSource, /item\.status === PaymentRequestStatus\.APPROVED/, "already approved requests must not be charged again");
    assert.match(approvalSource, /tx\.budgetItem\.update\(\{[\s\S]*usedAmount: \{ increment: amount \}/, "budget item usage must increment by request amount");
    assert.match(approvalSource, /tx\.budget\.update\(\{[\s\S]*usedAmount: \{ increment: amount \}/, "parent budget usage must increment by request amount");
    assert.match(approvalSource, /action: "approval_budget_usage"/, "budget usage application must leave a dedicated audit log");
  });

  it("keeps submission and disbursement status changes from double-counting budget usage", () => {
    assert.doesNotMatch(paymentRequestSource, /tx\.budgetItem\.update\(/, "payment request submit/draft save must not increment budget item usage");
    assert.doesNotMatch(paymentRequestSource, /tx\.budget\.update\(/, "payment request submit/draft save must not increment parent budget usage");
    assert.doesNotMatch(disbursementSource, /tx\.budgetItem\.update\(/, "disbursement execution must not increment budget item usage again");
    assert.doesNotMatch(disbursementSource, /tx\.budget\.update\(/, "disbursement execution must not increment parent budget usage again");
  });

  it("derives displayed budget balances from persisted budget amounts", () => {
    assert.match(pageResourceSource, /function toBudgetRow/, "budget rows must be mapped through a single backend formatter");
    assert.match(pageResourceSource, /const remaining = allocated - used/, "budget balance must be derived from allocated minus persisted used amount");
    assert.match(pageResourceSource, /usageRate = allocated > 0 \? Math\.round\(\(used \/ allocated\) \* 100\)/, "budget usage rate must be recalculated from persisted amounts");
  });
});
