import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BudgetStatus, DisbursementStatus, PaymentRequestStatus } from "../../backend/generated/prisma";
import {
  validateBudgetAdjustmentFinancialClose,
  validateDisbursementFinancialClose,
  validatePaymentSubmitFinancialClose,
} from "../../backend/src/controls/financialClose";

const openBudgetItem = {
  status: BudgetStatus.NORMAL,
  budget: { status: BudgetStatus.NORMAL },
};

const closedBudgetItem = {
  status: BudgetStatus.NORMAL,
  budget: { status: BudgetStatus.CLOSED },
};

describe("backend financial close controls", () => {
  it("blocks new payment submission in closed budget periods", () => {
    assert.equal(validatePaymentSubmitFinancialClose({ status: PaymentRequestStatus.DRAFT, budgetItem: closedBudgetItem }), "");
    assert.equal(validatePaymentSubmitFinancialClose({ status: PaymentRequestStatus.SUBMITTED, budgetItem: openBudgetItem }), "");
    assert.match(validatePaymentSubmitFinancialClose({ status: PaymentRequestStatus.SUBMITTED, budgetItem: closedBudgetItem }), /마감된 예산 기간/);
    assert.match(validatePaymentSubmitFinancialClose({ status: PaymentRequestStatus.APPROVAL_PENDING }), /예산 항목/);
  });

  it("blocks budget adjustments after budget close", () => {
    assert.equal(validateBudgetAdjustmentFinancialClose({ status: BudgetStatus.NORMAL }, { "배정 예산": "10,000,000 원" }), "");
    assert.equal(validateBudgetAdjustmentFinancialClose({ status: BudgetStatus.NORMAL }, { 상태: "마감" }), "");
    assert.match(validateBudgetAdjustmentFinancialClose({ status: BudgetStatus.CLOSED }, { "사용 금액": "1,000,000 원" }), /마감된 예산 기간/);
    assert.match(validateBudgetAdjustmentFinancialClose({ status: BudgetStatus.CLOSED }, { 상태: "정상" }), /재오픈/);
  });

  it("blocks reschedule and error recovery in closed budget periods", () => {
    const closedDisbursement = {
      status: DisbursementStatus.ERROR,
      paymentRequest: {
        budgetItem: closedBudgetItem,
      },
    };
    const openDisbursement = {
      status: DisbursementStatus.ERROR,
      paymentRequest: {
        budgetItem: openBudgetItem,
      },
    };
    assert.equal(validateDisbursementFinancialClose(openDisbursement, "retry"), "");
    assert.equal(validateDisbursementFinancialClose(closedDisbursement, "hold"), "");
    assert.match(validateDisbursementFinancialClose(closedDisbursement, "retry"), /오류 복구/);
    assert.match(validateDisbursementFinancialClose(closedDisbursement, "verify"), /오류 복구/);
    assert.match(validateDisbursementFinancialClose(closedDisbursement, "reschedule"), /지급 예정일/);
  });
});
