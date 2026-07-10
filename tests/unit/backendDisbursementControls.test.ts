import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountVerificationStatus, ApprovalStatus, DisbursementStatus, PaymentRequestStatus, VendorStatus } from "../../backend/generated/prisma";
import {
  buildBankTransferExportSummary,
  validateBankTransferExportCandidate,
  validateDisbursementMutationControls,
  validateExecutionApprovalRequirement,
  validateExecutionControls,
  validateExecutionSeparation,
  validateBankResultReconciliation,
} from "../../backend/src/routes/disbursements";

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

const validPatch = {
  idempotencyKey: "disbursement-execute-PMT-2026-0086-test",
  rowVersion: "3",
  지급상태: "지급 완료",
  승인번호: "PR-2026-0057",
  거래처: "이노베이션(주)",
  금액: "7,800,000 원",
};

const validMutationPatch = {
  idempotencyKey: "disbursement-mutation-PMT-2026-0086-test",
  rowVersion: "3",
};

describe("backend disbursement execution controls", () => {
  it("accepts an approved, verified, version-matched execution request", () => {
    assert.equal(validateExecutionControls(disbursement(), validPatch), "");
  });

  it("blocks duplicate, stale, unapproved, and account-mismatched execution", () => {
    assert.match(validateExecutionControls(disbursement({ status: DisbursementStatus.COMPLETED }), validPatch), /이미 지급 완료/);
    assert.match(validateExecutionControls(disbursement(), { ...validPatch, rowVersion: "2" }), /이미 변경/);
    assert.match(
      validateExecutionControls(disbursement({ paymentRequest: { requestCode: "PR-2026-0057", status: PaymentRequestStatus.APPROVAL_IN_PROGRESS, approvalSteps: [] } }), validPatch),
      /승인 완료/,
    );
    assert.match(validateExecutionControls(disbursement({ accountVerificationStatus: AccountVerificationStatus.MISMATCH }), validPatch), /계좌.*검증.*일치하지/);
    assert.match(validateExecutionControls(disbursement(), { ...validPatch, 금액: "7,700,000 원" }), /지급 금액/);
  });

  it("requires execution approval by a separated second finance user", () => {
    const item = disbursement();
    assert.equal(validateExecutionSeparation(item, "70000000-0000-4000-8000-000000000201"), "");
    assert.match(validateExecutionSeparation(item, "70000000-0000-4000-8000-000000000101"), /요청자/);
    assert.match(validateExecutionSeparation(item, "70000000-0000-4000-8000-000000000102"), /결재 승인자/);
    assert.match(validateExecutionApprovalRequirement(item, "70000000-0000-4000-8000-000000000201", null), /2인 확인/);
    assert.match(
      validateExecutionApprovalRequirement(item, "70000000-0000-4000-8000-000000000201", {
        actorId: "70000000-0000-4000-8000-000000000201",
        rowVersion: 3,
      }),
      /서로 달라야/,
    );
    assert.match(
      validateExecutionApprovalRequirement(item, "70000000-0000-4000-8000-000000000201", {
        actorId: "70000000-0000-4000-8000-000000000202",
        rowVersion: 2,
      }),
      /다시 지급 실행 확인/,
    );
    assert.equal(
      validateExecutionApprovalRequirement(item, "70000000-0000-4000-8000-000000000201", {
        actorId: "70000000-0000-4000-8000-000000000202",
        rowVersion: 3,
      }),
      "",
    );
  });

  it("validates hold, retry, account verification, and reschedule controls", () => {
    assert.equal(validateDisbursementMutationControls(disbursement(), { ...validMutationPatch, 지급상태: "보류", "지급 보류 사유": "계좌 확인 필요" }), "");
    assert.match(validateDisbursementMutationControls(disbursement(), { ...validMutationPatch, 지급상태: "보류" }), /보류 사유/);
    assert.equal(validateDisbursementMutationControls(disbursement({ status: DisbursementStatus.ERROR }), { ...validMutationPatch, 지급상태: "지급 예정" }), "");
    assert.match(
      validateDisbursementMutationControls(disbursement({ status: DisbursementStatus.ERROR, accountVerificationStatus: AccountVerificationStatus.MISMATCH }), {
        ...validMutationPatch,
        지급상태: "지급 예정",
      }),
      /계좌 재확인/,
    );
    assert.equal(
      validateDisbursementMutationControls(disbursement({ accountVerificationStatus: AccountVerificationStatus.MISMATCH }), {
        ...validMutationPatch,
        계좌확인: "확인 완료",
        지급상태: "지급 예정",
      }),
      "",
    );
    assert.match(
      validateDisbursementMutationControls(disbursement({ status: DisbursementStatus.COMPLETED }), {
        ...validMutationPatch,
        계좌확인: "확인 완료",
      }),
      /지급 완료/,
    );
    assert.equal(validateDisbursementMutationControls(disbursement(), { ...validMutationPatch, 지급예정일: "2026-07-06" }), "");
    assert.match(validateDisbursementMutationControls(disbursement(), { ...validMutationPatch, 지급예정일: "not-a-date" }), /유효한 지급 예정일/);
  });

  it("validates bank transfer export eligibility", () => {
    assert.equal(validateBankTransferExportCandidate(disbursement(), "110-555-777777"), "");
    assert.match(validateBankTransferExportCandidate(disbursement({ status: DisbursementStatus.COMPLETED }), "110-555-777777"), /지급 예정 또는 오늘 지급/);
    assert.match(validateBankTransferExportCandidate(disbursement({ accountVerificationStatus: AccountVerificationStatus.MISMATCH }), "110-555-777777"), /지급 건 계좌 확인/);
    assert.match(
      validateBankTransferExportCandidate(disbursement({ paymentRequest: { requestCode: "PR-2026-0057", status: PaymentRequestStatus.APPROVAL_IN_PROGRESS, approvalSteps: [] } }), "110-555-777777"),
      /승인 완료/,
    );
    assert.match(validateBankTransferExportCandidate(disbursement(), null), /복호화 가능한/);
  });

  it("summarizes bank transfer exports for screen and audit reconciliation", () => {
    const generatedAt = new Date("2026-07-05T08:30:00.000Z");
    const summary = buildBankTransferExportSummary(
      [
        {
          지급번호: "PMT-2026-0086",
          승인번호: "PR-2026-0057",
          지급예정일: "2026-07-06",
          거래처: "이노베이션(주)",
          사업자번호: "110-81-12345",
          은행: "가나다은행",
          계좌번호: "110-555-777777",
          금액: 7_800_000,
          요청부서: "재무팀",
          요청자: "김민수",
          지급상태: "지급 예정",
          계좌확인: "확인 완료",
          거래처계좌확인: "확인 완료",
          결재상태: "승인 완료",
          결재단계확인: "확인 완료",
        },
        {
          지급번호: "PMT-2026-0087",
          승인번호: "PR-2026-0058",
          지급예정일: "2026-07-05",
          거래처: "이노베이션(주)",
          사업자번호: "110-81-12345",
          은행: "가나다은행",
          계좌번호: "110-555-777777",
          금액: 2_200_000,
          요청부서: "IT운영팀",
          요청자: "박지훈",
          지급상태: "오늘 지급",
          계좌확인: "확인 완료",
          거래처계좌확인: "확인 완료",
          결재상태: "승인 완료",
          결재단계확인: "확인 완료",
        },
      ],
      { bank: "가나다은행", status: "전체" },
      generatedAt,
    );

    assert.equal(summary.targetCount, 2);
    assert.equal(summary.totalAmount, 10_000_000);
    assert.equal(summary.vendorCount, 1);
    assert.equal(summary.accountVerifiedCount, 2);
    assert.equal(summary.approvalVerifiedCount, 2);
    assert.equal(summary.scheduledCount, 1);
    assert.equal(summary.dueTodayCount, 1);
    assert.equal(summary.generatedAt, generatedAt.toISOString());
    assert.deepEqual(summary.disbursementCodes, ["PMT-2026-0086", "PMT-2026-0087"]);
    assert.equal(summary.reconciliationRows[0].disbursementCode, "PMT-2026-0086");
    assert.equal("계좌번호" in summary.reconciliationRows[0], false);
  });

  it("validates bank result reconciliation against ERP payment data", () => {
    const completed = disbursement({ status: DisbursementStatus.COMPLETED });
    assert.equal(
      validateBankResultReconciliation(completed, {
        disbursementCode: "PMT-2026-0086",
        approvalCode: "PR-2026-0057",
        amount: 7_800_000,
        status: "SUCCESS",
      }),
      "",
    );
    assert.match(
      validateBankResultReconciliation(disbursement(), {
        disbursementCode: "PMT-2026-0086",
        approvalCode: "PR-2026-0057",
        amount: 7_800_000,
        status: "SUCCESS",
      }),
      /지급 완료/,
    );
    assert.match(
      validateBankResultReconciliation(completed, {
        disbursementCode: "PMT-2026-0086",
        approvalCode: "PR-2026-9999",
        amount: 7_800_000,
        status: "SUCCESS",
      }),
      /승인번호/,
    );
    assert.match(
      validateBankResultReconciliation(completed, {
        disbursementCode: "PMT-2026-0086",
        approvalCode: "PR-2026-0057",
        amount: 7_700_000,
        status: "FAILED",
      }),
      /금액/,
    );
  });
});
