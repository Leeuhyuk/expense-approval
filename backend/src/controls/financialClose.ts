import { BudgetStatus, DisbursementStatus, PaymentRequestStatus } from "../../generated/prisma/index.js";

type BudgetScope = {
  status: BudgetStatus;
};

type BudgetItemScope = {
  status: BudgetStatus;
  budget?: BudgetScope | null;
} | null | undefined;

type PatchLike = Record<string, string | undefined>;

export function isClosedBudgetScope(budgetItem: BudgetItemScope) {
  return budgetItem?.status === BudgetStatus.CLOSED || budgetItem?.budget?.status === BudgetStatus.CLOSED;
}

export function validatePaymentSubmitFinancialClose(item: { status: PaymentRequestStatus; budgetItem?: BudgetItemScope }) {
  const isSubmission = item.status === PaymentRequestStatus.SUBMITTED || item.status === PaymentRequestStatus.APPROVAL_PENDING;
  if (!isSubmission) return "";
  if (!item.budgetItem) return "예산 항목이 확인되지 않은 결제 요청은 제출할 수 없습니다.";
  if (isClosedBudgetScope(item.budgetItem)) return "마감된 예산 기간에는 신규 결제 요청을 제출할 수 없습니다.";
  return "";
}

export function validateBudgetAdjustmentFinancialClose(before: { status: BudgetStatus }, patch: PatchLike) {
  if (before.status !== BudgetStatus.CLOSED) return "";
  const changesAmount = Boolean(patch["배정 예산"]?.trim() || patch["사용 금액"]?.trim());
  const changesStatus = Boolean(patch.상태?.trim() && patch.상태 !== "마감");
  if (changesAmount || changesStatus) return "마감된 예산 기간은 예산 조정 또는 재오픈할 수 없습니다.";
  return "";
}

export function validateDisbursementFinancialClose(
  before: { status: DisbursementStatus; paymentRequest: { budgetItem?: BudgetItemScope } },
  action: "execute" | "hold" | "retry" | "verify" | "reschedule" | "update",
) {
  if (!isClosedBudgetScope(before.paymentRequest.budgetItem)) return "";
  if (action === "reschedule") return "마감된 예산 기간의 지급 예정일은 변경할 수 없습니다.";
  if (action === "retry" || (action === "verify" && before.status === DisbursementStatus.ERROR)) {
    return "마감된 예산 기간의 지급 오류 복구는 backend에서 차단됩니다.";
  }
  return "";
}
