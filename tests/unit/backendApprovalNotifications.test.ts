import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function approvalPatchRouteBlock() {
  const source = readFileSync(resolve("backend/src/routes/approvals.ts"), "utf8");
  const start = source.indexOf('app.patch("/approvals/:requestCode"');
  assert.notEqual(start, -1, "approval patch route not found");
  const nextRoute = source.indexOf("\n  app.", start + 1);
  return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

describe("backend approval notifications and workflow lock", () => {
  it("writes approval outcome notifications in the same transaction as approval status changes", () => {
    const block = approvalPatchRouteBlock();
    const transactionIndex = block.indexOf("prisma.$transaction");
    const notificationIndex = block.indexOf("tx.notification.createMany");
    const auditIndex = block.indexOf("tx.auditLog.create");

    assert.notEqual(transactionIndex, -1, "approval action must use a Prisma transaction");
    assert.notEqual(notificationIndex, -1, "approval action must create notifications through the transaction client");
    assert.notEqual(auditIndex, -1, "approval action must create audit logs through the transaction client");
    assert.ok(transactionIndex < notificationIndex, "approval notifications must be created inside the transaction");
    assert.match(block, /NotificationType\.APPROVAL_REJECTED/, "approval rejection must notify the requester");
    assert.match(block, /NotificationType\.APPROVAL_HELD/, "approval hold must notify the requester");
    assert.match(block, /NotificationType\.APPROVAL_COMPLETED/, "final approval must notify the requester");
    assert.match(block, /NotificationType\.APPROVAL_REQUESTED/, "intermediate approval must notify the next approver");
  });

  it("prevents terminal approval requests from being processed again", () => {
    const source = readFileSync(resolve("backend/src/routes/approvals.ts"), "utf8");
    const block = approvalPatchRouteBlock();

    assert.match(source, /function currentPendingApprovalStep/, "approval processing must target only a pending step");
    assert.match(source, /function isOpenApprovalStatus/, "approval processing must define open workflow statuses");
    assert.match(block, /WORKFLOW_LOCKED/, "terminal approval requests must be rejected before mutation");
    assert.match(block, /nextStepStatus === ApprovalStatus\.PENDING/, "approval processing must not move a step back to pending");
  });

  it("guards approval mutations with rowVersion and idempotency keys", () => {
    const block = approvalPatchRouteBlock();

    assert.match(block, /readApprovalIdempotencyKey\(request\.body\)/, "approval actions must read idempotency keys");
    assert.match(block, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "duplicate approval actions must be detected from audit logs");
    assert.match(block, /tx\.approvalStep\.updateMany\(/, "approval step updates must use conditional updateMany");
    assert.match(block, /expectedStepRowVersion !== currentStep\.rowVersion/, "client approval step rowVersion must be checked before mutation");
    assert.match(block, /rowVersion: currentStep\.rowVersion/, "approval step updates must guard on the current step rowVersion");
    assert.match(block, /tx\.paymentRequest\.updateMany\(/, "payment request updates must use conditional updateMany");
    assert.match(block, /expectedRequestRowVersion !== before\.rowVersion/, "client payment request rowVersion must be checked before mutation");
    assert.match(block, /rowVersion: before\.rowVersion/, "payment request updates must guard on the request rowVersion");
    assert.match(block, /idempotencyKey,/, "approval audit logs must persist the idempotency key");
  });

  it("applies budget usage only when an approval reaches final approved state", () => {
    const source = readFileSync(resolve("backend/src/routes/approvals.ts"), "utf8");
    const block = approvalPatchRouteBlock();

    assert.match(source, /function budgetStatusFor/, "approval route must derive budget status from allocated and used amounts");
    assert.match(source, /async function applyBudgetUsageOnFinalApproval/, "final approval must have a budget usage applicator");
    assert.match(source, /nextPaymentStatus !== PaymentRequestStatus\.APPROVED/, "budget usage must only apply on final approval");
    assert.match(source, /tx\.budgetItem\.update\(/, "final approval must increment the budget item used amount");
    assert.match(source, /tx\.budget\.update\(/, "final approval must increment the parent budget used amount");
    assert.match(block, /applyBudgetUsageOnFinalApproval\(tx, before, nextPaymentStatus\)/, "budget usage must run inside the approval transaction");
    assert.match(block, /action: "approval_budget_usage"/, "budget usage must leave an audit trace");
  });
});
