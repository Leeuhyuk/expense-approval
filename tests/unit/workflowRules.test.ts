import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canExecuteDisbursement,
  canHoldDisbursement,
  canProcessApproval,
  canSavePaymentDraft,
  canSubmitPayment,
} from "../../src/domain/workflowRules";

describe("workflow rules", () => {
  it("allows draft save and submit only for editable payment request states", () => {
    assert.equal(canSavePaymentDraft("임시 저장"), true);
    assert.equal(canSavePaymentDraft("반려"), true);
    assert.equal(canSavePaymentDraft("승인 완료"), false);
    assert.equal(canSubmitPayment("임시 저장"), true);
    assert.equal(canSubmitPayment("승인 진행 중"), false);
  });

  it("allows approval actions only while approval is actionable", () => {
    assert.equal(canProcessApproval("승인 대기"), true);
    assert.equal(canProcessApproval("승인 진행 중"), true);
    assert.equal(canProcessApproval("보류"), false);
    assert.equal(canProcessApproval("반려"), false);
  });

  it("requires account verification before disbursement execution", () => {
    assert.equal(canExecuteDisbursement("지급 예정", "확인 완료"), true);
    assert.equal(canExecuteDisbursement("오늘 지급", "확인 완료"), true);
    assert.equal(canExecuteDisbursement("지급 완료", "확인 완료"), false);
    assert.equal(canExecuteDisbursement("지급 예정", "계좌 불일치"), false);
  });

  it("prevents hold after final disbursement completion", () => {
    assert.equal(canHoldDisbursement("지급 예정"), true);
    assert.equal(canHoldDisbursement("오류"), true);
    assert.equal(canHoldDisbursement("지급 완료"), false);
  });
});
