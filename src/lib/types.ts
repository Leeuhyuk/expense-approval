// 경비 보고서 결재 도메인 모델 — README "Shared Data Model" 기반

/** 결재선 단계의 진행 상태에 따른 색상 톤 */
export type Tone = "done" | "current" | "wait";

/** 경비 분류 */
export type Category = "교통" | "숙박" | "식대" | "접대" | "기타";

/** 보고서 진행 상태 */
export type ReportStatus = "검토 대기" | "승인" | "반려" | "보류";

/** 결재 결정 */
export type Decision = "approved" | "rejected" | null;

/** 사용자 역할 (Firebase Auth Custom Claim) */
export type UserRole = "employee" | "approver" | "finance" | "admin";

export interface Person {
  name: string;
  team: string;
  role: string;
  /** 아바타에 표시할 이니셜(한 글자) */
  initial: string;
}

export interface ExpenseItem {
  id: string;
  date: string; // "06.10"
  category: Category;
  desc: string;
  amount: number;
  /** 증빙 상태: 첨부 완료 여부 */
  hasReceipt: boolean;
  /** 검토 필요 플래그 */
  flagged: boolean;
  /** 검토 필요 사유 (flagged일 때) */
  flagReason?: string;
}

export interface CategorySummary {
  category: Category;
  amount: number;
  /** 전체 대비 비율(%) */
  ratio: number;
}

export interface ApprovalStep {
  step: string; // "기안", "1차 결재" ...
  person: Person;
  state: string; // "완료", "검토 중", "대기"
  tone: Tone;
  at: string; // "06.25", "지금", "—"
  comment?: string;
  /** 이 단계를 처리할 결재자의 Firebase Auth uid (연결된 경우) */
  approverUid?: string;
}

export interface Report {
  docNo: string;
  title: string;
  status: ReportStatus;
  author: Person;
  period: string;
  submittedAt: string;
  total: number;
  limit: number;
  /** 한도 사용률(%) */
  usage: number;
  itemCount: number;
  flagCount: number;
  decision: Decision;
  items: ExpenseItem[];
  categories: CategorySummary[];
  approvalChain: ApprovalStep[];
}

/** 분류별 색상 (README "Category colors") */
export const CATEGORY_COLOR: Record<Category, string> = {
  교통: "#2B50CE",
  숙박: "#7A52CE",
  식대: "#1F8A5B",
  접대: "#C8453B",
  기타: "#6B7280",
};

/** tone → 색상 매핑 (아바타/배지/점 공통) */
export const TONE_STYLE: Record<
  Tone,
  { avatarBg: string; avatarText: string; badgeBg: string; badgeText: string; dot: string }
> = {
  done: { avatarBg: "#1F8A5B", avatarText: "#fff", badgeBg: "#E5F4ED", badgeText: "#136B43", dot: "#1F8A5B" },
  current: { avatarBg: "#2B50CE", avatarText: "#fff", badgeBg: "#EEF1FD", badgeText: "#2B50CE", dot: "#2B50CE" },
  wait: { avatarBg: "#fff", avatarText: "#B6BCC6", badgeBg: "#F1F2F5", badgeText: "#868D98", dot: "#D2D5DB" },
};
