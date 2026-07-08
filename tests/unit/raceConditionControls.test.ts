import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { AccountVerificationStatus, ApprovalStatus, DisbursementStatus, PaymentRequestStatus, VendorStatus } from "../../backend/generated/prisma";
import { validateDisbursementMutationControls, validateExecutionControls } from "../../backend/src/routes/disbursements";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function routeBlock(path: string, signature: string) {
  const text = source(path);
  const start = text.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found in ${path}`);
  const next = text.indexOf("\n  app.", start + signature.length);
  return text.slice(start, next === -1 ? text.length : next);
}

function disbursement(overrides: Record<string, unknown> = {}) {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    disbursementCode: "PMT-2026-0086",
    amount: 7_800_000,
    rowVersion: 3,
    status: DisbursementStatus.SCHEDULED,
    accountVerificationStatus: AccountVerificationStatus.VERIFIED,
    vendor: {
      name: "이노베이션(주)",
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      isActive: true,
      status: VendorStatus.ACTIVE,
    },
    paymentRequest: {
      requestCode: "PR-2026-0057",
      requesterId: "70000000-0000-4000-8000-000000000101",
      status: PaymentRequestStatus.APPROVED,
      approvalSteps: [{ approverId: "70000000-0000-4000-8000-000000000102", status: ApprovalStatus.APPROVED }],
    },
    ...overrides,
  } as never;
}

describe("race condition controls", () => {
  it("blocks duplicate UI clicks while table mutations are in flight", () => {
    const main = source("src/main.tsx");
    assert.match(main, /const updateSelectedRows = async[\s\S]*if \(isMutating\) return;[\s\S]*setIsMutating\(true\)/, "bulk row mutations must ignore duplicate clicks while running");
    assert.match(main, /const executeSelectedRowAction = async[\s\S]*if \(isMutating\) return;[\s\S]*setIsMutating\(true\)/, "single-row actions must ignore duplicate clicks while running");
    assert.match(main, /const createRow = async[\s\S]*if \(isMutating\) return;[\s\S]*setIsMutating\(true\)/, "create buttons must ignore duplicate clicks while running");
    assert.match(main, /className="approval-bulk-button" disabled=\{table\.isMutating \|\| !canActApproval/, "bulk approval button must disable during mutation");
    assert.match(main, /className="disbursement-bulk-button" disabled=\{table\.isMutating \|\| !canExecutePayment/, "bulk disbursement button must disable during mutation");
  });

  it("keeps approval processing guarded by idempotency and rowVersion", () => {
    const approvalBlock = routeBlock("backend/src/routes/approvals.ts", 'app.patch("/approvals/:requestCode"');
    const main = source("src/main.tsx");
    assert.match(main, /idempotencyKey: `approval-\$\{action\}-\$\{requestId\}-\$\{stepId\}-\$\{Date\.now\(\)\}`/, "approval UI must send unique idempotency keys");
    assert.match(approvalBlock, /readApprovalIdempotencyKey\(request\.body\)/, "approval route must read idempotency keys");
    assert.match(approvalBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "approval route must replay or reject duplicate keys");
    assert.match(approvalBlock, /expectedRequestRowVersion !== before\.rowVersion/, "approval route must reject stale payment request versions");
    assert.match(approvalBlock, /expectedStepRowVersion !== currentStep\.rowVersion/, "approval route must reject stale approval step versions");
    assert.match(approvalBlock, /tx\.approvalStep\.updateMany\(\{[\s\S]*rowVersion: currentStep\.rowVersion/, "approval step write must be conditional");
    assert.match(approvalBlock, /tx\.paymentRequest\.updateMany\(\{[\s\S]*rowVersion: before\.rowVersion/, "payment request write must be conditional");
  });

  it("keeps payment request and budget saves guarded by idempotency and rowVersion", () => {
    const paymentCreateBlock = routeBlock("backend/src/routes/paymentRequests.ts", 'app.post("/payment-requests"');
    const paymentUpdateBlock = routeBlock("backend/src/routes/paymentRequests.ts", 'app.patch("/payment-requests/:requestCode"');
    const budgetCreateBlock = routeBlock("backend/src/routes/pageResources.ts", 'app.post("/budgets"');
    const budgetUpdateBlock = routeBlock("backend/src/routes/pageResources.ts", 'app.patch("/budgets/:departmentName"');
    const main = source("src/main.tsx");

    assert.match(paymentCreateBlock, /findPaymentIdempotencyReplay\(idempotencyKey, "create"\)/, "payment request create must replay duplicate idempotency keys");
    assert.match(paymentCreateBlock, /idempotencyKey,\s*[\s\S]*\.\.\.auditRequestContext\(request\)/, "payment request create audit must persist idempotency keys");
    assert.match(paymentUpdateBlock, /findPaymentIdempotencyReplay\(idempotencyKey, "update"\)/, "payment request update must replay duplicate idempotency keys");
    assert.match(paymentUpdateBlock, /readPaymentExpectedRowVersion\(request\.body, patch\)/, "payment request update must read rowVersion from the payload");
    assert.match(paymentUpdateBlock, /rowVersion: before\.rowVersion/, "payment request update must guard the DB write by current rowVersion");
    assert.match(main, /paymentRequestMutationKey\("draft"/, "payment request draft saves must send idempotency keys");
    assert.match(main, /요청RowVersion: rowVersion/, "payment request saves must send the displayed rowVersion");

    assert.match(budgetCreateBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "budget create must reject duplicate idempotency keys");
    assert.match(budgetUpdateBlock, /readOptionalIntegerValue\(record, \["rowVersion", "예산RowVersion"\]\)/, "budget update must read rowVersion from the payload");
    assert.match(budgetUpdateBlock, /tx\.budget\.updateMany\(\{ where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "budget update must use a guarded rowVersion write");
    assert.match(budgetUpdateBlock, /createAudit\(tx, request, user, "budget", before\.id, "update"[\s\S]*idempotencyKey/, "budget update audit must persist idempotency keys");
  });

  it("keeps disbursement execution and mutation guarded by idempotency, rowVersion, and second approval", () => {
    const route = source("backend/src/routes/disbursements.ts");
    const executionBlock = routeBlock("backend/src/routes/disbursements.ts", 'app.post("/disbursements/:disbursementCode/execution-approval"');
    const mutationBlock = routeBlock("backend/src/routes/disbursements.ts", 'app.patch("/disbursements/:disbursementCode"');
    assert.match(validateExecutionControls(disbursement(), { idempotencyKey: "exec-1", rowVersion: "2", 지급상태: "지급 완료", 승인번호: "PR-2026-0057", 거래처: "이노베이션(주)", 금액: "7,800,000 원" }), /이미 변경/);
    assert.match(validateDisbursementMutationControls(disbursement(), { idempotencyKey: "mut-1", rowVersion: "2", 지급상태: "보류", "지급 보류 사유": "확인" }), /이미 변경/);
    assert.match(route, /function validateExecutionApprovalRequirement/, "disbursement execution must require separated second approval");
    assert.match(executionBlock, /idempotencyKey/, "execution approval must carry an idempotency key");
    assert.match(executionBlock, /rowVersion: before\.rowVersion/, "execution approval audit snapshot must bind to the current rowVersion");
    assert.match(mutationBlock, /findIdempotencyReplay\(idempotencyKey\)/, "disbursement mutation must replay or reject duplicate keys");
    assert.match(mutationBlock, /validateDisbursementMutationControls\(before, patch/, "disbursement mutation must validate stale rowVersion before writing");
    assert.match(mutationBlock, /tx\.disbursement\.updateMany\(\{[\s\S]*rowVersion: Number\(patch\.rowVersion\)/, "disbursement writes must be conditional");
  });

  it("keeps settings role and user changes guarded by idempotency and rowVersion", () => {
    const route = source("backend/src/routes/pageResources.ts");
    const main = source("src/main.tsx");
    assert.match(route, /app\.post\("\/settings\/roles"[\s\S]*findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "role create must replay duplicate idempotency keys");
    assert.match(route, /app\.patch\("\/settings\/roles\/:roleId"[\s\S]*expectedRowVersion !== before\.rowVersion/, "role update must reject stale rowVersion");
    assert.match(route, /tx\.role\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "role update must use conditional updateMany");
    assert.match(route, /tx\.role\.deleteMany\(\{ where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "role delete must use conditional deleteMany");
    assert.match(route, /app\.patch\("\/settings\/:userName"[\s\S]*expectedRowVersion !== before\.rowVersion/, "user permission update must reject stale rowVersion");
    assert.match(route, /tx\.user\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "user permission update must use conditional updateMany");
    assert.match(main, /roleMutationKey\("permission", currentGroup\)/, "settings role UI must send idempotency keys");
    assert.match(main, /userPermissionMutationKey\(existingAssignment \? "update" : "create"/, "settings user UI must send idempotency keys");
  });
});
