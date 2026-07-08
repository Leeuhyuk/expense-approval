import { defaultRolePolicies } from "./rolePolicy";

export type UserRole = "requester" | "approver" | "finance" | "admin" | "auditor";

export const paymentRequestTransitions = {
  "임시 저장": ["제출"],
  제출: ["승인 대기"],
  "승인 대기": ["승인 진행 중", "반려"],
  "승인 진행 중": ["승인 완료", "반려", "보류"],
  보류: ["승인 진행 중", "반려"],
  반려: ["임시 저장", "제출"],
  "승인 완료": [],
} as const;

export const approvalTransitions = {
  "승인 대기": ["승인 완료", "반려", "보류"],
  "승인 진행 중": ["승인 완료", "반려", "보류"],
  보류: ["승인 대기", "반려"],
  반려: [],
  "승인 완료": [],
} as const;

export const disbursementTransitions = {
  "지급 예정": ["지급 완료", "보류", "오류"],
  "오늘 지급": ["지급 완료", "보류", "오류"],
  보류: ["지급 예정", "지급 완료"],
  오류: ["지급 예정", "보류"],
  "지급 완료": [],
} as const;

function permissionsFor(code: (typeof defaultRolePolicies)[number]["code"]) {
  return defaultRolePolicies.find((role) => role.code === code)?.permissions ?? [];
}

export const permissionMatrix: Record<UserRole, string[]> = {
  requester: permissionsFor("REQUESTER"),
  approver: permissionsFor("APPROVER"),
  finance: permissionsFor("FINANCE"),
  admin: permissionsFor("ADMIN"),
  auditor: permissionsFor("AUDITOR"),
};

export const approvalLineRules = [
  { maxAmount: 1_000_000, steps: ["요청자", "1차 승인자"], requiredApprovers: 1 },
  { maxAmount: 5_000_000, steps: ["요청자", "1차 승인자", "부서장"], requiredApprovers: 2 },
  { maxAmount: 20_000_000, steps: ["요청자", "1차 승인자", "부서장", "재무팀"], requiredApprovers: 3 },
  { maxAmount: Number.POSITIVE_INFINITY, steps: ["요청자", "부서장", "재무팀", "최종 승인자"], requiredApprovers: 4 },
];

export const budgetOverrunRules = {
  warningUsageRate: 0.8,
  blockUsageRate: 1,
  requireExtraApprovalAmount: 5_000_000,
  extraApprovalStep: "재무팀",
};

export const concurrencyRules = [
  "목록 조회 시 rowVersion 또는 updatedAt을 함께 받는다.",
  "승인, 반려, 보류, 지급 실행은 현재 상태와 rowVersion을 함께 검증한다.",
  "이미 최종 처리된 승인 완료, 반려, 지급 완료 건은 동일 액션 재처리를 차단한다.",
  "일괄 처리 중 일부 실패는 성공 건과 실패 건을 분리해 감사 로그에 남긴다.",
  "네트워크 실패 후 재시도는 같은 idempotencyKey를 사용한다.",
];

export function canSavePaymentDraft(status = "임시 저장") {
  return status === "임시 저장" || status === "반려";
}

export function canSubmitPayment(status = "임시 저장") {
  return status === "임시 저장" || status === "반려";
}

export function canProcessApproval(status = "승인 대기") {
  return status === "승인 대기" || status === "승인 진행 중";
}

export function canExecuteDisbursement(status = "지급 예정", accountStatus = "확인 완료") {
  return accountStatus === "확인 완료" && (status === "지급 예정" || status === "오늘 지급" || status === "보류");
}

export function canHoldDisbursement(status = "지급 예정") {
  return status === "지급 예정" || status === "오늘 지급" || status === "오류";
}
