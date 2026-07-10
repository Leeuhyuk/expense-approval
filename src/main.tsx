import { StrictMode, type ChangeEvent, type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Copy,
  CreditCard,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  Gauge,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  TrendingUp,
  Trash2,
  Upload,
  UserCog,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import "./styles.css";

import { featureItems, navItems, pageOrder, pages } from "./pageCatalog";
import {
  erpApi,
  type AccountLifecycleSummary,
  type AuditLogSearchResult,
  type AuditIntegrityReport,
  type BusinessFailureAlertSummary,
  type DataQualityRunList,
  type FileDto,
  type FileOwnerType,
  type FinancialControlReport,
  type FinancialReconciliationSummary,
  type ManualRecoverySummary,
  type OperationModeStatus,
  type OperationalAlertSummary,
  type PasswordPolicySummary,
  type PaymentApprovalCandidate,
  type PaymentRequestMasterData,
  type PerformancePolicyStatus,
  type PermissionReviewReport,
  type PrivacyAccessReport,
  type ReportDownloadFormat,
  type ReportJobRunResult,
  type RetentionPolicySummary,
  type ReportScheduleDto,
  type RoleSettingsDto,
  type RoleSettingsInput,
  type SystemSettingKey,
  type SystemSettingSnapshotMeta,
} from "./api/service";
import { ApiRequestError } from "./api/errors";
import { canAccessPage, canUseAction, getDefaultPage } from "./domain/accessControl";
import { canPreviewAttachment, formatFileSize, prepareAttachmentDrafts } from "./domain/fileRules";
import { encodeSort, formatCurrencyWon, parseWon, type SortDirection } from "./domain/formatters";
import {
  canExecuteDisbursement,
  canHoldDisbursement,
  canProcessApproval,
  canSavePaymentDraft,
  canSubmitPayment,
} from "./domain/workflowRules";
import { defaultRolePolicies } from "./domain/rolePolicy";
import type { AttachmentDraft, AuthRoleCode, AuthUser, KpiItem, NotificationItem, PageDefinition, PageKey, RouteKey, TableRow } from "./types";
declare global {
  interface Window {
    __paymentApprovalRoot?: Root;
  }
}

type TableController = {
  rows: TableRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  statusFilter: string;
  sortColumn: string;
  sortDirection: SortDirection;
  selectedRow: TableRow | null;
  selectedRows: TableRow[];
  selectedCount: number;
  actionMessage: string;
  errorMessage: string;
  isLoading: boolean;
  isMutating: boolean;
  visiblePages: number[];
  allVisibleSelected: boolean;
  isSelected: (row: TableRow) => boolean;
  setPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  cyclePageSize: () => void;
  cycleStatusFilter: () => void;
  setStatusFilter: (status: string) => void;
  refresh: () => void;
  sortByColumn: (column: string) => void;
  toggleRow: (row: TableRow) => void;
  toggleVisibleRows: () => void;
  setActionMessage: (message: string) => void;
  createRow: (row: TableRow, message: string) => Promise<void>;
  updateSelectedRow: (patch: TableRow, message: string, options?: UpdateSelectedRowOptions) => Promise<void>;
  updateSelectedRows: (patch: TableRow | ((row: TableRow) => TableRow), message: string, predicate?: (row: TableRow) => boolean) => Promise<void>;
  executeSelectedRowAction: (action: string, input: { reason?: string; rowVersion?: number; idempotencyKey?: string; patch?: TableRow }, message: string) => Promise<void>;
};

type UpdateSelectedRowOptions = {
  selectNextRow?: (rows: TableRow[], currentRow: TableRow, updatedRow: TableRow) => TableRow | null;
};

type TableMutationSnapshot = {
  rows: TableRow[];
  total: number;
  selectedIds: Set<string>;
  activeRowId: string;
};

type PendingCard = {
  id: string;
  title: string;
  requester: string;
  amount: string;
  type: string;
  accent?: boolean;
};

type UrgentPayment = {
  id: string;
  title: string;
  meta: string;
  amount: string;
  due: string;
};

type RecentActivity = {
  title: string;
  desc: string;
  meta: string;
  time: string;
  tone: string;
  icon: typeof Clock3;
};

const approvalRows: TableRow[] = [];
const budgetRows: TableRow[] = [];
const dashboardRecentPayments: TableRow[] = [];
const disbursementRows: TableRow[] = [];
const favoriteRows: TableRow[] = [];
const paymentRows: TableRow[] = [];
const pendingCards: PendingCard[] = [];
const recentActivities: RecentActivity[] = [];
const reportRows: TableRow[] = [];
const requestRows: string[][] = [];
const settingsRows: TableRow[] = [];
const urgentPayments: UrgentPayment[] = [];
const vendorRows: TableRow[] = [];
const emptyBudgetDetailRow: TableRow = {
  부서: "예산 데이터 없음",
  "배정 예산": "0",
  "사용 금액": "0",
  사용률: "0%",
  잔액: "0",
  상태: "정상",
};
const emptyVendorDetailRow: TableRow = {
  거래처명: "거래처 데이터 없음",
  사업자번호: "",
  담당자: "",
  은행: "",
  계좌확인: "검증 대기",
  최근지급일: "-",
  누적지급액: "0 원",
  상태: "비활성",
  "세금계산서 이메일": "",
  "세금계산서 발행": "이메일 발행",
};

const filterOptionsByPage: Partial<Record<PageKey, string[]>> = {
  "payment-request": ["전체 상태", "제출", "승인 대기", "임시 저장", "반려", "승인 완료"],
  approval: ["전체 상태", "승인 대기", "승인 진행 중", "승인 완료", "반려", "보류"],
  disbursement: ["전체", "지급 예정", "오늘 지급", "지급 완료", "오류", "보류"],
};

const statusColumnByPage: Partial<Record<PageKey, string>> = {
  "payment-request": "상태",
  approval: "결재상태",
  disbursement: "지급상태",
};

const defaultStatusOptions = ["전체"];
const emptyExtraFilters: Partial<Record<string, string>> = {};

const paymentVendorOptions = vendorRows.filter((row) => row.상태 === "활성").map((row) => row.거래처명);
const paymentDepartmentOptions = Array.from(new Set([...budgetRows.map((row) => row.부서), "IT운영팀", "외부 컨설팅팀", "장비 운영팀"]));

type PaymentRequestDraft = {
  vendor: string;
  department: string;
  amount: string;
  requestDate: string;
  reason: string;
};

type PaymentFieldErrorKey = "row" | "vendor" | "department" | "requestDate" | "budget" | "amount" | "attachments" | "reason" | "approvalLine";
type PaymentFieldErrors = Partial<Record<PaymentFieldErrorKey, string>>;

type ApprovalStepState = "done" | "active" | "waiting" | "reject" | "hold";

type ApprovalStepItem = {
  step: string;
  name: string;
  role: string;
  note: string;
  state: ApprovalStepState;
};

type ApprovalAttachmentItem = {
  fileName: string;
  sizeLabel: string;
  type: "pdf" | "image" | "sheet";
  source: string;
};

type VendorDraft = {
  originalName: string;
  name: string;
  businessNumber: string;
  manager: string;
  bankName: string;
  bankAccount: string;
  accountStatus: string;
  status: string;
  taxEmail: string;
  taxIssueType: string;
};

type VendorDocument = AttachmentDraft & {
  category: "사업자등록증" | "통장사본" | "세금계산서" | "기타";
  uploadedAt: string;
};

type VendorPaymentHistoryItem = {
  id: string;
  date: string;
  department: string;
  amount: string;
  status: string;
  source: "지급" | "요청" | "-";
};

const deferredVendorUploadMessage = "거래처 저장 후 업로드";

type ApprovalLimitRow = {
  id: string;
  min: number;
  max: number | null;
  step: string;
  requiredApprovers: number;
  status: "활성" | "비활성";
};

type ApprovalRuleSettings = {
  lineMode: string;
  allowParallel: boolean;
  allowDelegate: boolean;
  vacationFallback: boolean;
  vendorException: boolean;
  immediateEffect: string;
  existingApprovalImpact: string;
};

type DepartmentSettingDraft = {
  department: string;
  defaultRoleGroup: string;
  budgetAmount: string;
  routing: string;
  owner: string;
};

type ReportDrilldownState = {
  title: string;
  source: string;
  columns: string[];
  rows: TableRow[];
};

type PermissionColumn = "결제 요청" | "승인 관리" | "지급 관리" | "예산 관리" | "보고서" | "시스템 설정";

type RolePermissionGroup = {
  id: string;
  name: string;
  tag: string;
  userCount: number;
  permissions: Record<PermissionColumn, boolean>;
  permissionCodes: string[];
  status: "활성" | "비활성";
  rowVersion: number;
};

type RoleGroupDraft = {
  name: string;
  tag: string;
  template: "요청 중심" | "승인 중심" | "조회 중심" | "관리 중심";
};

type UserPermissionDraft = {
  groupId: string;
  user: string;
  role: string;
};

type AssignedUser = {
  id: string;
  user: string;
  department: string;
  groupName: string;
  role: string;
  status: string;
  rowVersion?: string;
};

type NotificationSetting = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
};

type IntegrationSetting = {
  id: string;
  name: string;
  target: string;
  status: "연동" | "대기" | "점검";
  lastSynced: string;
  credentialRef: string;
  testEndpoint: string;
  lastFailureReason?: string;
  lastTestedAt?: string;
};

type SettingsHistoryItem = {
  id: string;
  time: string;
  user: string;
  desc: string;
  tag: string;
};

type SettingsServerSnapshot = {
  approvalLimits: ApprovalLimitRow[];
  approvalRules: ApprovalRuleSettings;
  departmentSettings: TableRow[];
  roleGroups: RolePermissionGroup[];
  assignedUsers: AssignedUser[];
  notificationSettings: NotificationSetting[];
  integrationSettings: IntegrationSetting[];
};

type FavoriteType = "메뉴" | "필터" | "보고서";
type FavoriteIconKey = "approval" | "due" | "report" | "vendor" | "payment" | "download" | "filter" | "budget" | "settings";

type FavoriteItem = {
  id: string;
  title: string;
  type: FavoriteType;
  description: string;
  targetPage?: PageKey;
  recentUsed: string;
  owner: string;
  status: "활성" | "비활성";
  tone: string;
  iconKey: FavoriteIconKey;
  filterTags: string[];
  savedFilters?: Partial<Record<string, string>>;
  sortColumn?: string;
  sortDirection?: SortDirection;
  usageCount: number;
  shared: string;
  rowVersion: string;
};

type DetailFilterField = {
  label: string;
  value: string;
};

type ShortcutDraft = {
  title: string;
  target: PageKey;
  filters: string;
  shared: string;
};

const permissionColumns: PermissionColumn[] = ["결제 요청", "승인 관리", "지급 관리", "예산 관리", "보고서", "시스템 설정"];

const permissionCodesByColumn: Record<PermissionColumn, string[]> = {
  "결제 요청": ["payment_request:create", "payment_request:read_own", "payment_request:submit", "payment_request:update_own"],
  "승인 관리": ["approval:read_assigned", "approval:act"],
  "지급 관리": ["disbursement:read", "disbursement:execute", "disbursement:hold"],
  "예산 관리": ["budget:read"],
  "보고서": ["report:read"],
  "시스템 설정": ["system:manage"],
};

type PermissionCatalogGroup = PermissionColumn | "공통" | "거래처" | "감사";

type PermissionCatalogItem = {
  code: string;
  label: string;
  group: PermissionCatalogGroup;
  description: string;
};

const permissionCatalog: PermissionCatalogItem[] = [
  { code: "dashboard:read", label: "대시보드 조회", group: "공통", description: "메인 현황과 업무 요약을 조회합니다." },
  { code: "favorite:read", label: "즐겨찾기 조회", group: "공통", description: "개인 즐겨찾기와 공용 바로가기를 조회합니다." },
  { code: "payment_request:create", label: "결제 요청 생성", group: "결제 요청", description: "새 결제 요청 초안을 생성합니다." },
  { code: "payment_request:read_own", label: "본인 요청 조회", group: "결제 요청", description: "본인이 작성한 결제 요청을 조회합니다." },
  { code: "payment_request:read_all", label: "전체 요청 조회", group: "결제 요청", description: "부서와 담당자 제한 없이 결제 요청을 조회합니다." },
  { code: "payment_request:submit", label: "요청 제출", group: "결제 요청", description: "작성한 결제 요청을 결재선으로 상신합니다." },
  { code: "payment_request:update_own", label: "본인 요청 수정", group: "결제 요청", description: "본인이 작성한 결제 요청을 수정합니다." },
  { code: "approval:read_assigned", label: "배정 승인 조회", group: "승인 관리", description: "자신에게 배정된 승인 대상을 조회합니다." },
  { code: "approval:act", label: "승인/반려 처리", group: "승인 관리", description: "승인, 반려, 보류 처리를 수행합니다." },
  { code: "disbursement:read", label: "지급 조회", group: "지급 관리", description: "지급 예정과 지급 결과를 조회합니다." },
  { code: "disbursement:execute", label: "지급 실행", group: "지급 관리", description: "승인 완료 건의 지급 실행을 처리합니다." },
  { code: "disbursement:hold", label: "지급 보류", group: "지급 관리", description: "지급 대상 건을 보류 상태로 전환합니다." },
  { code: "budget:read", label: "예산 조회", group: "예산 관리", description: "예산 잔액과 집행 현황을 조회합니다." },
  { code: "report:read", label: "보고서 조회", group: "보고서", description: "정산, 운영, 감사 보고서를 조회합니다." },
  { code: "vendor:read", label: "거래처 조회", group: "거래처", description: "거래처 기본 정보와 첨부 문서를 조회합니다." },
  { code: "audit:read", label: "감사 로그 조회", group: "감사", description: "주요 데이터 변경 이력과 감사 로그를 조회합니다." },
  { code: "system:manage", label: "시스템 설정 관리", group: "시스템 설정", description: "권한, 결재 정책, 연동 설정을 저장합니다." },
];

const allPermissionCodes = permissionCatalog.map((permission) => permission.code);
const permissionExceptionPattern = /^exception:.+:\d{4}-\d{2}-\d{2}$/;

function isPermissionExceptionCode(permission: string) {
  return permissionExceptionPattern.test(permission.trim());
}

function normalizePermissionCodes(permissions: string[]) {
  const clean = [...new Set(permissions.map((permission) => permission.trim()).filter(Boolean))];
  const exceptionCodes = clean.filter(isPermissionExceptionCode);
  const directCodes = clean.filter((permission) => !isPermissionExceptionCode(permission));
  return directCodes.includes("*") ? ["*", ...exceptionCodes] : [...directCodes, ...exceptionCodes];
}

function expandedPermissionCodes(permissions: string[]) {
  const normalized = normalizePermissionCodes(permissions);
  const exceptionCodes = normalized.filter(isPermissionExceptionCode);
  return normalized.includes("*") ? [...allPermissionCodes, ...exceptionCodes] : normalized;
}

function rolePermissionCodesFromColumns(columns: Record<PermissionColumn, boolean>) {
  return normalizePermissionCodes(permissionColumns.flatMap((column) => (columns[column] ? permissionCodesByColumn[column] : [])));
}

function roleHasPermissionCode(group: Pick<RolePermissionGroup, "permissionCodes">, permissionCode: string) {
  return group.permissionCodes.includes("*") || group.permissionCodes.includes(permissionCode);
}

function rolePermissionCodeCount(group: Pick<RolePermissionGroup, "permissionCodes">) {
  const directCodes = normalizePermissionCodes(group.permissionCodes).filter((permission) => !isPermissionExceptionCode(permission));
  return directCodes.includes("*") ? allPermissionCodes.length : directCodes.length;
}

function rolePermissionsToColumns(permissions: string[]): Record<PermissionColumn, boolean> {
  return Object.fromEntries(
    permissionColumns.map((column) => [column, permissions.includes("*") || permissionCodesByColumn[column].some((permission) => permissions.includes(permission))]),
  ) as Record<PermissionColumn, boolean>;
}

const initialApprovalLimits: ApprovalLimitRow[] = [
  { id: "limit-1", min: 0, max: 1_000_000, step: "1단계", requiredApprovers: 1, status: "활성" },
  { id: "limit-2", min: 1_000_001, max: 5_000_000, step: "2단계", requiredApprovers: 2, status: "활성" },
  { id: "limit-3", min: 5_000_001, max: 20_000_000, step: "3단계", requiredApprovers: 2, status: "활성" },
  { id: "limit-4", min: 20_000_001, max: 50_000_000, step: "3단계", requiredApprovers: 3, status: "활성" },
  { id: "limit-5", min: 50_000_001, max: null, step: "4단계", requiredApprovers: 4, status: "활성" },
];

const initialApprovalRules: ApprovalRuleSettings = {
  lineMode: "금액 기준 결재선 사용",
  allowParallel: true,
  allowDelegate: true,
  vacationFallback: true,
  vendorException: false,
  immediateEffect: "신규 결제 요청, 신규 결재선 선택, 권한 그룹 변경은 저장 즉시 적용",
  existingApprovalImpact: "진행 중 결재 건은 생성 당시 결재선 스냅샷을 유지하고, 보류/반려 후 재상신 시 신규 정책 적용",
};

const fallbackRoleUserCounts: Record<AuthRoleCode, number> = {
  REQUESTER: 42,
  APPROVER: 12,
  FINANCE: 18,
  ADMIN: 5,
  AUDITOR: 0,
};

const initialRoleGroups: RolePermissionGroup[] = defaultRolePolicies.map((role) => ({
  id: `role-${role.code.toLowerCase()}`,
  name: role.name,
  tag: role.tag,
  userCount: fallbackRoleUserCounts[role.code],
  permissions: rolePermissionsToColumns(role.permissions),
  permissionCodes: normalizePermissionCodes(role.permissions),
  status: "활성",
  rowVersion: 1,
}));

const initialAssignedUsers: AssignedUser[] = settingsRows.map((row, index) => ({
  id: `assigned-${index}`,
  user: row.사용자,
  department: row.부서,
  groupName: row.권한그룹,
  role: row.역할,
  status: row.상태,
  rowVersion: row.사용자RowVersion ?? "1",
}));

const initialNotificationSettings: NotificationSetting[] = [
  { id: "approval-waiting", label: "승인 대기 알림", description: "승인자가 배정되면 웹 알림과 메일을 발송합니다.", enabled: true },
  { id: "payment-due", label: "지급 예정 알림", description: "지급 예정일 하루 전 담당자에게 알립니다.", enabled: true },
  { id: "policy-changed", label: "정책 변경 알림", description: "결재 정책 저장 시 관리자 그룹에 변경 요약을 보냅니다.", enabled: false },
];

const initialIntegrationSettings: IntegrationSetting[] = [
  { id: "accounting", name: "회계 시스템", target: "전표/지급 결과 동기화", status: "연동", lastSynced: "2024-06-03 09:30", credentialRef: "ERP_ACCOUNTING_TOKEN", testEndpoint: "https://accounting.example.com/health" },
  { id: "tax-invoice", name: "세금계산서 수집", target: "매입 세금계산서 PDF/메일함 연결", status: "대기", lastSynced: "-", credentialRef: "ERP_TAX_INVOICE_TOKEN", testEndpoint: "https://tax.example.com/health", lastFailureReason: "인증 정보 입력 대기" },
  { id: "bank-api", name: "은행 계좌 검증", target: "거래처 계좌 실명 검증", status: "점검", lastSynced: "2024-06-01 16:10", credentialRef: "ERP_BANK_API_TOKEN", testEndpoint: "https://bank.example.com/health", lastFailureReason: "최근 점검 실패, 재시도 필요" },
];

const initialSettingsHistory: SettingsHistoryItem[] = [
  { id: "history-1", time: "2024-06-01 14:30", user: "김민수 과장 (재무팀)", desc: "승인 한도 구간 수정 (20,000,001 원 ~ 구간)", tag: "정책 변경" },
  { id: "history-2", time: "2024-06-01 11:05", user: "이수연 대리 (마케팅팀)", desc: "사용자 권한 수정 (구매팀)", tag: "권한 변경" },
  { id: "history-3", time: "2024-05-31 16:42", user: "박정우 대리 (구매팀)", desc: "결재선 규칙 수정 (대리 결재 허용)", tag: "정책 변경" },
  { id: "history-4", time: "2024-05-31 09:18", user: "최영민 대리 (인사팀)", desc: "사용자 추가 (외부 감사)", tag: "사용자 변경" },
  { id: "history-5", time: "2024-05-29 15:22", user: "조현우 대리 (재무팀)", desc: "알림 설정 수정", tag: "알림 변경" },
  { id: "history-6", time: "2024-05-28 10:07", user: "김연구 대리 (IT운영팀)", desc: "시스템 연동 설정 수정 (회계 시스템)", tag: "연동 변경" },
];

const favoriteIconMap: Record<FavoriteIconKey, typeof LayoutDashboard> = {
  approval: ClipboardCheck,
  due: Clock3,
  report: FileText,
  vendor: Building2,
  payment: Database,
  download: Download,
  filter: Filter,
  budget: WalletCards,
  settings: Settings,
};

const favoriteTypeOptions = ["전체 유형", "메뉴", "필터", "보고서", "비활성"];

const initialFavoriteItems: FavoriteItem[] = [
  {
    id: "fav-approval",
    title: "승인 대기",
    type: "메뉴",
    description: "승인 대기 중인 결제 요청 목록",
    recentUsed: "2024-06-01 10:30",
    owner: "김민수 과장",
    status: "활성",
    tone: "teal",
    iconKey: "approval",
    filterTags: ["상태: 승인 대기", "담당: 내 결재"],
    usageCount: 45,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-due",
    title: "오늘 마감 요청",
    type: "메뉴",
    description: "오늘 마감 기한인 결제 요청 목록",
    recentUsed: "2024-06-01 09:15",
    owner: "김민수 과장",
    status: "활성",
    tone: "orange",
    iconKey: "due",
    filterTags: ["기한: 오늘", "상태: 승인 대기"],
    usageCount: 31,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-report",
    title: "월간 보고서",
    type: "보고서",
    description: "월별 결제 및 지출 보고서 조회",
    recentUsed: "2024-05-31 18:22",
    owner: "김민수 과장",
    status: "활성",
    tone: "blue",
    iconKey: "report",
    filterTags: ["기간: 이번 달", "유형: 종합"],
    usageCount: 28,
    shared: "팀",
    rowVersion: "1",
  },
  {
    id: "fav-vendor",
    title: "주요 거래처",
    type: "메뉴",
    description: "자주 거래하는 거래처 목록",
    recentUsed: "2024-05-31 14:05",
    owner: "김민수 과장",
    status: "활성",
    tone: "purple",
    iconKey: "vendor",
    filterTags: ["거래처: 상위 지급", "상태: 활성"],
    usageCount: 24,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-large-filter",
    title: "금액 500만원 이상",
    type: "필터",
    description: "요청 금액이 500만원 이상",
    recentUsed: "2024-06-30 11:40",
    owner: "김민수 과장",
    status: "활성",
    tone: "blue",
    iconKey: "filter",
    filterTags: ["금액: 5,000,000원 이상"],
    usageCount: 19,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-finance-filter",
    title: "재무팀 승인 대기",
    type: "필터",
    description: "재무팀 담당 승인 건만 필터",
    recentUsed: "2024-06-01 08:45",
    owner: "김민수 과장",
    status: "활성",
    tone: "teal",
    iconKey: "filter",
    filterTags: ["부서: 재무팀", "상태: 승인 대기"],
    usageCount: 22,
    shared: "재무팀",
    rowVersion: "1",
  },
  {
    id: "fav-week-filter",
    title: "이번 주 요청",
    type: "필터",
    description: "이번 주에 생성된 요청",
    recentUsed: "2024-05-31 17:20",
    owner: "김민수 과장",
    status: "활성",
    tone: "blue",
    iconKey: "filter",
    filterTags: ["요청일: 이번 주"],
    usageCount: 13,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-urgent-filter",
    title: "긴급 요청",
    type: "필터",
    description: "긴급으로 표시된 요청",
    recentUsed: "2024-05-31 13:10",
    owner: "김민수 과장",
    status: "활성",
    tone: "orange",
    iconKey: "filter",
    filterTags: ["긴급여부: 긴급"],
    usageCount: 9,
    shared: "개인",
    rowVersion: "1",
  },
  {
    id: "fav-payment",
    title: "지급 예정",
    type: "메뉴",
    description: "지급 예정 내역 목록 조회",
    recentUsed: "2024-05-30 16:10",
    owner: "김민수 과장",
    status: "활성",
    tone: "teal",
    iconKey: "payment",
    filterTags: ["지급상태: 지급 예정"],
    usageCount: 18,
    shared: "재무팀",
    rowVersion: "1",
  },
  {
    id: "fav-old-settings",
    title: "구 시스템 설정",
    type: "메뉴",
    description: "이전 설정 메뉴 바로가기",
    recentUsed: "2024-05-20 08:30",
    owner: "김민수 과장",
    status: "비활성",
    tone: "blue",
    iconKey: "settings",
    filterTags: ["메뉴: 비활성"],
    usageCount: 3,
    shared: "관리자",
    rowVersion: "1",
  },
];

function normalizeFavoriteType(value: string | undefined): FavoriteType {
  return value === "필터" || value === "보고서" ? value : "메뉴";
}

function favoritePageFromRow(row: TableRow): PageKey {
  const candidate = (row.대상화면 || row.설명 || "").replace(/^#/, "").trim();
  return pageOrder.includes(candidate as PageKey) ? candidate as PageKey : "dashboard";
}

function favoriteIconForPage(pageKey: PageKey, type: FavoriteType): FavoriteIconKey {
  if (type === "필터") return "filter";
  if (pageKey === "reports" || type === "보고서") return "report";
  if (pageKey === "vendors") return "vendor";
  if (pageKey === "settings") return "settings";
  if (pageKey === "approval") return "approval";
  if (pageKey === "disbursement") return "payment";
  if (pageKey === "budget") return "budget";
  return "filter";
}

function favoritePageForItem(item: FavoriteItem): PageKey {
  if (item.targetPage) return item.targetPage;
  if (item.iconKey === "report") return "reports";
  if (item.iconKey === "vendor") return "vendors";
  if (item.iconKey === "settings") return "settings";
  if (item.iconKey === "approval") return "approval";
  if (item.iconKey === "payment") return "disbursement";
  if (item.iconKey === "budget") return "budget";
  return "payment-request";
}

type FavoriteRouteState = {
  filters: Partial<Record<string, string>>;
  statusFilter?: string;
  sortColumn?: string;
  sortDirection?: SortDirection;
};

const favoriteRouteStateKey = (pageKey: PageKey) => `erp-favorite-route-state:${pageKey}`;

function splitFavoriteTags(value = "") {
  return value
    .split(/,\s*(?=[^,：:]+[:：])/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readJsonRecord(value?: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readJsonRecords(value?: string | null) {
  if (!value) return [] as Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  } catch {
    return [];
  }
}

function jsonText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const favoriteFilterFieldsByPage: Record<PageKey, Set<string>> = {
  dashboard: new Set(["검색어", "상태", "부서", "결재상태", "지급상태"]),
  "payment-request": new Set(["검색어", "상태", "부서", "거래처", "요청자", "긴급여부", "요청일"]),
  approval: new Set(["검색어", "결재상태", "부서", "요청자", "처리기한", "요청일", "긴급여부"]),
  disbursement: new Set(["검색어", "지급상태", "부서", "거래처", "은행", "계좌확인", "지급예정일"]),
  budget: new Set(["검색어", "상태", "부서", "예산항목", "회계연도", "기간", "잔액"]),
  vendors: new Set(["검색어", "상태", "계좌확인", "구분", "은행", "거래처명"]),
  reports: new Set(["검색어", "유형", "부서", "거래처", "기간", "보고서명"]),
  settings: new Set(["검색어", "상태", "유형", "권한그룹", "사용자", "부서"]),
  favorites: new Set(["검색어", "상태", "유형", "소유자"]),
};

function normalizeFavoriteFilterField(pageKey: PageKey, field: string) {
  const statusField = statusColumnByPage[pageKey] ?? "상태";
  const [rawBase, operator] = field.split("__");
  const aliases: Record<string, string> = {
    status: statusField,
    상태: statusField,
    요청상태: "상태",
    결재상태: "결재상태",
    지급상태: "지급상태",
    예산상태: "상태",
    거래처상태: "상태",
    department: "부서",
    부서: "부서",
    category: "예산항목",
    budgetCategory: "예산항목",
    예산항목: "예산항목",
    account: "계좌확인",
    계좌확인: "계좌확인",
    bank: "은행",
    은행: "은행",
    type: pageKey === "vendors" ? "구분" : "유형",
    유형: pageKey === "vendors" ? "구분" : "유형",
    urgency: "긴급여부",
    긴급여부: "긴급여부",
    period: "기간",
    기간: "기간",
    fiscalYear: "회계연도",
    회계연도: "회계연도",
    search: "검색어",
    검색어: "검색어",
  };
  const normalizedBase = aliases[rawBase.trim()] ?? rawBase.trim();
  return operator ? `${normalizedBase}__${operator}` : normalizedBase;
}

function favoriteFilterBaseField(field: string) {
  return field.split("__")[0] ?? field;
}

function isFavoriteFilterFieldSupported(pageKey: PageKey, field: string) {
  return favoriteFilterFieldsByPage[pageKey].has(favoriteFilterBaseField(field));
}

function normalizeFavoriteFilters(pageKey: PageKey, filters: Record<string, unknown>) {
  return Object.entries(filters).reduce<Partial<Record<string, string>>>((acc, [field, value]) => {
    if (typeof value === "string" && value.trim()) {
      const normalizedField = normalizeFavoriteFilterField(pageKey, field);
      if (isFavoriteFilterFieldSupported(pageKey, normalizedField)) acc[normalizedField] = value.trim();
    }
    return acc;
  }, {});
}

function favoriteFiltersFromTags(tags: string[], pageKey: PageKey) {
  return tags.reduce<Partial<Record<string, string>>>((acc, tag) => {
    const match = tag.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!match) return acc;
    const normalizedField = normalizeFavoriteFilterField(pageKey, match[1]);
    if (isFavoriteFilterFieldSupported(pageKey, normalizedField)) acc[normalizedField] = match[2].trim();
    return acc;
  }, {});
}

function parseFavoriteSortText(sortText = "") {
  const [field, direction] = sortText.split(":");
  if (!field || (direction !== "asc" && direction !== "desc")) return {};
  return { sortColumn: field, sortDirection: direction as SortDirection };
}

function favoriteStatusOptions(pageKey: PageKey) {
  if (pageKey === "budget") return ["전체 상태", "정상", "주의", "초과"];
  if (pageKey === "vendors") return ["전체 상태", "활성", "비활성"];
  return filterOptionsByPage[pageKey] ?? defaultStatusOptions;
}

function favoriteStatusFilter(pageKey: PageKey, filters: Partial<Record<string, string>>) {
  const statusField = statusColumnByPage[pageKey] ?? "상태";
  const candidate = filters[statusField] ?? filters.상태;
  const options = favoriteStatusOptions(pageKey);
  return candidate && options.includes(candidate) ? candidate : undefined;
}

function favoriteRouteStateFromRow(row: TableRow, pageKey: PageKey): FavoriteRouteState {
  const tags = splitFavoriteTags(row.필터);
  const structuredFilters = normalizeFavoriteFilters(pageKey, readJsonRecord(row.필터JSON));
  const filters = {
    ...favoriteFiltersFromTags(tags, pageKey),
    ...structuredFilters,
  };
  const sort = parseFavoriteSortText(row.정렬);
  return {
    filters,
    statusFilter: favoriteStatusFilter(pageKey, filters),
    ...sort,
  };
}

function favoriteUnsupportedFilterFields(item: FavoriteItem) {
  const pageKey = favoritePageForItem(item);
  const tagFields = item.filterTags.flatMap((tag) => {
    const match = tag.match(/^([^:：]+)[:：]\s*(.+)$/);
    return match ? [match[1]] : [];
  });
  const structuredFields = Object.keys(item.savedFilters ?? {});
  return [...new Set([...tagFields, ...structuredFields]
    .map((field) => normalizeFavoriteFilterField(pageKey, field))
    .filter((field) => !isFavoriteFilterFieldSupported(pageKey, field)))]
    .sort((left, right) => left.localeCompare(right, "ko-KR"));
}
function favoriteRouteStateFromItem(item: FavoriteItem): FavoriteRouteState {
  const pageKey = favoritePageForItem(item);
  const filters = {
    ...favoriteFiltersFromTags(item.filterTags, pageKey),
    ...normalizeFavoriteFilters(pageKey, item.savedFilters ?? {}),
  };
  return {
    filters,
    statusFilter: favoriteStatusFilter(pageKey, filters),
    sortColumn: item.sortColumn,
    sortDirection: item.sortDirection,
  };
}

function readFavoriteRouteState(pageKey: PageKey): FavoriteRouteState {
  const raw = readJsonRecord(window.localStorage.getItem(favoriteRouteStateKey(pageKey)));
  const filters = normalizeFavoriteFilters(pageKey, readJsonRecord(typeof raw.filters === "string" ? raw.filters : JSON.stringify(raw.filters ?? {})));
  return {
    filters,
    statusFilter: typeof raw.statusFilter === "string" ? raw.statusFilter : favoriteStatusFilter(pageKey, filters),
    sortColumn: typeof raw.sortColumn === "string" ? raw.sortColumn : undefined,
    sortDirection: raw.sortDirection === "asc" || raw.sortDirection === "desc" ? raw.sortDirection : undefined,
  };
}

function persistRouteState(pageKey: PageKey, routeState: FavoriteRouteState) {
  const currentTableState = readJsonRecord(window.localStorage.getItem(`erp-table-state:${pageKey}`));
  const nextTableState = {
    ...currentTableState,
    page: 1,
    ...(routeState.statusFilter ? { statusFilter: routeState.statusFilter } : {}),
    ...(routeState.sortColumn ? { sortColumn: routeState.sortColumn } : {}),
    ...(routeState.sortDirection ? { sortDirection: routeState.sortDirection } : {}),
  };
  window.localStorage.setItem(favoriteRouteStateKey(pageKey), JSON.stringify(routeState));
  window.localStorage.setItem(`erp-table-state:${pageKey}`, JSON.stringify(nextTableState));
}

function applyFavoriteRouteState(item: FavoriteItem) {
  const pageKey = favoritePageForItem(item);
  const routeState = favoriteRouteStateFromItem(item);
  persistRouteState(pageKey, routeState);
}

function dashboardKpiRouteState(label: string): { pageKey: PageKey; routeState: FavoriteRouteState; message: string } {
  if (label.includes("승인 대기")) {
    return {
      pageKey: "approval",
      routeState: { filters: { "결재상태__in": "승인 대기|승인 진행 중" }, statusFilter: "전체 상태", sortColumn: "처리기한", sortDirection: "asc" },
      message: "승인 대기 KPI 기준으로 승인 목록을 서버 필터 조회합니다.",
    };
  }
  if (label.includes("마감")) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      pageKey: "approval",
      routeState: { filters: { "결재상태__in": "승인 대기|승인 진행 중", "처리기한__lte": today }, statusFilter: "전체 상태", sortColumn: "처리기한", sortDirection: "asc" },
      message: "오늘 마감 KPI 기준으로 처리기한 도래 승인 목록을 서버 필터 조회합니다.",
    };
  }
  if (label.includes("지급")) {
    return {
      pageKey: "approval",
      routeState: { filters: { 결재상태: "승인 완료" }, statusFilter: "승인 완료", sortColumn: "요청일", sortDirection: "desc" },
      message: "이번 달 지급 KPI의 현재 산식인 승인 완료 금액 기준으로 승인 완료 목록을 서버 필터 조회합니다.",
    };
  }
  return {
    pageKey: "budget",
    routeState: { filters: { 상태: "초과" }, statusFilter: "초과", sortColumn: "잔액", sortDirection: "asc" },
    message: "예산 초과 KPI 기준으로 초과 예산 목록을 서버 필터 조회합니다.",
  };
}

function favoriteFromRow(row: TableRow, index: number, fallbackOwner: string): FavoriteItem {
  const type = normalizeFavoriteType(row.유형);
  const pageKey = favoritePageFromRow(row);
  const routeState = favoriteRouteStateFromRow(row, pageKey);
  const targetDescription = row.설명?.startsWith("#") ? `${pages[pageKey].title} 화면으로 이동하는 바로가기` : row.설명;
  const tones = ["teal", "orange", "blue", "purple"] as const;
  return {
    id: row.ID || row.항목명 || `favorite-${index}`,
    title: row.항목명 || `즐겨찾기 ${index + 1}`,
    type,
    description: targetDescription || `${pages[pageKey].title} 화면으로 이동`,
    targetPage: pageKey,
    recentUsed: row.최근사용 || "-",
    owner: row.소유자 || fallbackOwner,
    status: row.상태 === "비활성" ? "비활성" : "활성",
    tone: tones[index % tones.length],
    iconKey: favoriteIconForPage(pageKey, type),
    filterTags: splitFavoriteTags(row.필터),
    savedFilters: routeState.filters,
    sortColumn: routeState.sortColumn,
    sortDirection: routeState.sortDirection,
    usageCount: Number(row.사용횟수 || "0") || 0,
    shared: row.공유 || "개인",
    rowVersion: row.즐겨찾기RowVersion || row.rowVersion || "1",
  };
}

function favoriteToRow(item: FavoriteItem, index: number, targetPage = favoritePageForItem(item)): TableRow {
  const routeState = favoriteRouteStateFromItem(item);
  return {
    항목명: item.title,
    유형: item.type,
    설명: `#${targetPage}`,
    대상화면: targetPage,
    최근사용: item.recentUsed,
    소유자: item.owner,
    상태: item.status,
    순서: String(index + 1),
    필터: item.filterTags.join(", "),
    필터JSON: JSON.stringify(routeState.filters),
    정렬: routeState.sortColumn && routeState.sortDirection ? encodeSort(routeState.sortColumn, routeState.sortDirection) : "",
    공유: item.shared,
    사용횟수: String(item.usageCount),
    rowVersion: item.rowVersion ?? "1",
    즐겨찾기RowVersion: item.rowVersion ?? "1",
  };
}

function favoriteMutationKey(action: string, itemOrTitle: FavoriteItem | string, rowVersion?: string) {
  const title = typeof itemOrTitle === "string" ? itemOrTitle : itemOrTitle.title;
  const version = rowVersion ?? (typeof itemOrTitle === "string" ? "new" : itemOrTitle.rowVersion ?? "1");
  return `favorite-${action}-${title}-${version}-${Date.now()}`;
}

function favoriteRecentTimestamp(value: string) {
  if (!value || value === "-") return 0;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortFavoritesByRecentUse(items: FavoriteItem[]) {
  return [...items].sort((a, b) => {
    const recentDiff = favoriteRecentTimestamp(b.recentUsed) - favoriteRecentTimestamp(a.recentUsed);
    if (recentDiff !== 0) return recentDiff;
    const usageDiff = b.usageCount - a.usageCount;
    if (usageDiff !== 0) return usageDiff;
    return a.title.localeCompare(b.title);
  });
}

function favoriteRowVersion(row?: TableRow | null) {
  return row?.즐겨찾기RowVersion || row?.rowVersion || "1";
}

function reportRowVersion(row?: TableRow | null) {
  return row?.보고서RowVersion || row?.rowVersion || "1";
}

function reportMutationKey(action: string, reportName: string, row?: TableRow | null) {
  return `report-${action}-${reportName}-${reportRowVersion(row)}-${Date.now()}`;
}

function reportScheduleMutationKey(action: string, schedule?: ReportScheduleDto | null) {
  return `report-schedule-${action}-${schedule?.id ?? "new"}-${schedule?.rowVersion ?? 1}-${Date.now()}`;
}

function normalizeAmountText(value: string) {
  return value.replace(/[^\d]/g, "");
}

function getDepartmentBudgetRemaining(department: string) {
  const budgetRow = budgetRows.find((row) => row.부서 === department);
  return budgetRow ? parseWon(budgetRow.잔액) : 20_000_000;
}

function getApprovalLine(amount: number, currentUser: AuthUser, candidates: PaymentApprovalCandidate[] = []) {
  const approverCount = amount > 10_000_000 ? 3 : 2;
  if (candidates.length > 0) {
    const selectedCandidates = candidates.slice(0, approverCount);
    return [
      [currentUser.name, "요청자"],
      ...selectedCandidates.map((candidate, index) => {
        const stepLabel = index === selectedCandidates.length - 1 ? "최종 결재" : `${index + 1}차 결재`;
        return [candidate.name, `${stepLabel} · ${candidate.roleLabel}`];
      }),
    ];
  }
  if (amount > 10_000_000) {
    return [
      [currentUser.name, "요청자"],
      ["박지은 차장", "1차 결재"],
      ["이성호 부장", "2차 결재"],
      ["정재훈 이사", "최종 결재"],
    ];
  }
  if (amount > 5_000_000) {
    return [
      [currentUser.name, "요청자"],
      ["박지은 차장", "1차 결재"],
      ["이성호 부장", "최종 결재"],
    ];
  }
  return [
    [currentUser.name, "요청자"],
    ["박지은 차장", "1차 결재"],
    ["이성호 부장", "최종 결재"],
  ];
}

function getApprovalLineForMode(baseLine: string[][], mode: string, departmentName: string, candidates: PaymentApprovalCandidate[] = []) {
  if (mode === "부서장 추가") {
    const departmentApprover = candidates.find((candidate) => candidate.departmentName === departmentName && !baseLine.some(([name]) => name === candidate.name));
    const extraStep = [departmentApprover?.name ?? `${departmentName || "선택 부서"} 부서장`, "부서장 결재"];
    return [baseLine[0] ?? extraStep, extraStep, ...baseLine.slice(1)];
  }
  if (mode === "수동 편집") {
    return baseLine.map(([name, role], index) => [name, index === 0 ? role : `${role} · 수동 확인`]);
  }
  return baseLine;
}

function buildPaymentRequestPatch(draft: PaymentRequestDraft, nextStatus: string, budgetItemId = ""): TableRow {
  const amountValue = parseWon(draft.amount);
  return {
    요청일: draft.requestDate,
    거래처: draft.vendor,
    부서: draft.department,
    금액: formatCurrencyWon(amountValue),
    상태: nextStatus,
    "요청 사유": draft.reason,
    ...(budgetItemId ? { 예산항목ID: budgetItemId } : {}),
  };
}

function paymentRequestRowVersion(row?: TableRow | null) {
  return row?.요청RowVersion || row?.rowVersion || "1";
}

function paymentRequestMutationKey(action: string, requestId: string, row?: TableRow | null) {
  return `payment-request-${action}-${requestId}-${paymentRequestRowVersion(row)}-${Date.now()}`;
}

function withPaymentAttachmentIds(patch: TableRow, attachments: AttachmentDraft[]): TableRow {
  const attachmentIds = attachments
    .filter((attachment) => attachment.status === "ready" && attachment.remoteId)
    .map((attachment) => attachment.remoteId as string);
  return attachmentIds.length > 0 ? { ...patch, 첨부파일ID: attachmentIds.join(",") } : patch;
}

function paymentFieldErrorsFromMessage(message: string): PaymentFieldErrors {
  const normalized = message.toLowerCase();
  const errors: PaymentFieldErrors = {};
  if (normalized.includes("vendor") || message.includes("거래처")) errors.vendor = "활성 거래처를 선택하거나 거래처를 먼저 등록하세요.";
  if (normalized.includes("department") || message.includes("부서")) errors.department = "backend에 등록된 부서를 선택하세요.";
  if (normalized.includes("budget") || message.includes("예산")) errors.budget = "부서와 예산 항목, 잔액을 확인하세요.";
  if (normalized.includes("attachment") || message.includes("첨부") || message.includes("증빙")) errors.attachments = "업로드 완료된 증빙 파일을 1개 이상 연결하세요.";
  if (normalized.includes("date") || message.includes("요청일")) errors.requestDate = "요청일 형식을 확인하세요.";
  if (normalized.includes("amount") || message.includes("금액")) errors.amount = "금액은 1원 이상이어야 합니다.";
  if (message.includes("결재선") || message.includes("승인")) errors.approvalLine = "결재선 후보와 승인 정책을 확인하세요.";
  return errors;
}

function getApprovalAssignees(row: TableRow | null, currentUser: AuthUser) {
  const lineText = row?.결재선 ?? currentUser.name;
  const currentAssignee = lineText.split(" 외 ")[0]?.trim() || currentUser.name;
  const extraCount = Number(lineText.match(/외\s*(\d+)/)?.[1] ?? "0");
  const approverCount = Math.max(1, Math.min(4, extraCount + 1));
  const fallbackPool = ["박정우 대리", "이상훈 차장", "정재훈 이사"].filter((name) => name !== currentAssignee);
  const pool = [currentAssignee, ...fallbackPool];

  return pool.slice(0, approverCount).map((name, index, list) => ({
    name,
    role: list.length === 1 ? "최종 결재" : index === 0 ? "1차 결재" : index === list.length - 1 ? "최종 결재" : `${index + 1}차 결재`,
  }));
}

function approvalStepStateFromStatus(status: string, isCurrent: boolean): ApprovalStepState {
  if (status === "승인 완료") return "done";
  if (status === "반려") return "reject";
  if (status === "보류") return "hold";
  return isCurrent ? "active" : "waiting";
}

function approvalStepNote(status: string, actedAt: string, reason: string, isCurrent: boolean) {
  if (status === "승인 대기") return isCurrent ? "처리 대기" : "대기";
  return [status, actedAt, reason ? `사유: ${reason}` : ""].filter(Boolean).join(" · ");
}

function getStoredApprovalSteps(row: TableRow | null): ApprovalStepItem[] {
  const storedSteps = readJsonRecords(row?.결재단계JSON);
  return storedSteps.map((item, index) => {
    const status = jsonText(item.status) || "승인 대기";
    const actedAt = jsonText(item.actedAt);
    const reason = jsonText(item.reason);
    const isCurrent = item.isCurrent === true || jsonText(item.isCurrent) === "true";
    return {
      step: jsonText(item.step) || `${index + 1}차 결재`,
      name: jsonText(item.approverName) || jsonText(item.name) || "승인자",
      role: jsonText(item.role) || "승인자",
      note: approvalStepNote(status, actedAt, reason, isCurrent),
      state: approvalStepStateFromStatus(status, isCurrent),
    };
  });
}

function getApprovalSteps(row: TableRow | null, currentUser: AuthUser): ApprovalStepItem[] {
  const status = row?.결재상태 ?? "승인 대기";
  const storedApprovalSteps = getStoredApprovalSteps(row);
  if (storedApprovalSteps.length > 0) {
    return [
      {
        step: "요청",
        name: row?.요청자 ?? "요청자",
        role: row?.부서 ?? "부서",
        note: row?.요청일 ?? "요청일 미확인",
        state: "done",
      },
      ...storedApprovalSteps,
    ];
  }
  const assignees = getApprovalAssignees(row, currentUser);
  const completedCount = status === "승인 완료" ? assignees.length : status === "승인 진행 중" ? 1 : 0;
  const terminalState: ApprovalStepState | null = status === "반려" ? "reject" : status === "보류" ? "hold" : null;

  const approvalSteps = assignees.map((assignee, index) => {
    const isTerminalStep = terminalState && index === completedCount;
    const isActive = !terminalState && status !== "승인 완료" && index === completedCount;
    return {
      step: assignee.role,
      name: assignee.name,
      role: "재무팀",
      note: isTerminalStep ? status : isActive ? "처리 대기" : index < completedCount ? "승인 완료" : "대기",
      state: isTerminalStep ? terminalState : index < completedCount ? "done" : isActive ? "active" : "waiting",
    } satisfies ApprovalStepItem;
  });

  return [
    {
      step: "요청",
      name: row?.요청자 ?? "요청자",
      role: row?.부서 ?? "부서",
      note: `${row?.요청일 ?? "2024-05-31"} 09:30`,
      state: "done",
    },
    ...approvalSteps,
  ];
}

function getCurrentApprovalStep(row: TableRow | null, currentUser: AuthUser) {
  return getApprovalSteps(row, currentUser).find((step) => step.state === "active") ?? null;
}

function canCurrentUserProcessApproval(row: TableRow | null, currentUser: AuthUser) {
  if (!row || !canProcessApproval(row.결재상태)) return false;
  return getCurrentApprovalStep(row, currentUser)?.name === currentUser.name;
}

function getApprovalApprovePatch(row: TableRow, currentUser: AuthUser): TableRow {
  const assignees = getApprovalAssignees(row, currentUser);
  const activeStep = getCurrentApprovalStep(row, currentUser);
  const activeIndex = assignees.findIndex((assignee) => assignee.name === activeStep?.name);
  const nextStatus = activeIndex >= assignees.length - 1 ? "승인 완료" : "승인 진행 중";

  return {
    결재상태: nextStatus,
    "처리 사유": "",
    "처리 이력": `2024-06-03 10:30 ${currentUser.name} ${activeStep?.step ?? "결재"} 승인`,
  };
}

function withApprovalMutationGuards(row: TableRow, patch: TableRow, action: string): TableRow {
  const requestId = row.요청번호 || "approval";
  const stepId = row.결재StepID || "step";
  return {
    ...patch,
    요청RowVersion: row.요청RowVersion ?? "",
    결재StepID: stepId,
    결재RowVersion: row.결재RowVersion ?? "",
    idempotencyKey: `approval-${action}-${requestId}-${stepId}-${Date.now()}`,
  };
}

function selectNextProcessableApprovalRow(rows: TableRow[], currentRow: TableRow, currentUser: AuthUser) {
  const currentId = getRowId("approval", currentRow);
  const currentIndex = Math.max(0, rows.findIndex((row) => getRowId("approval", row) === currentId));
  const orderedRows = [...rows.slice(currentIndex + 1), ...rows.slice(0, currentIndex)];
  return orderedRows.find((row) => getRowId("approval", row) !== currentId && canCurrentUserProcessApproval(row, currentUser)) ?? null;
}

function getApprovalAttachments(row: TableRow | null): ApprovalAttachmentItem[] {
  const requestId = row?.요청번호 ?? "PR-2024-0000";
  const vendor = row?.거래처 ?? "거래처";
  const requestedAt = row?.요청일 ?? "2024-05-31";
  const amount = parseWon(row?.금액 ?? "0");
  const baseAttachments: ApprovalAttachmentItem[] = [
    {
      fileName: `세금계산서_${vendor}_${requestedAt}.pdf`,
      sizeLabel: amount > 5_000_000 ? "384 KB" : "245 KB",
      type: "pdf",
      source: requestId,
    },
    {
      fileName: `견적서_${vendor}.jpg`,
      sizeLabel: amount > 1_000_000 ? "1.2 MB" : "680 KB",
      type: "image",
      source: requestId,
    },
  ];

  if (amount >= 5_000_000) {
    baseAttachments.push({
      fileName: `계약서_${vendor}_${requestId}.pdf`,
      sizeLabel: "512 KB",
      type: "pdf",
      source: requestId,
    });
  }

  return baseAttachments;
}

function getLinkedApprovalRow(disbursementRow: TableRow | null) {
  if (!disbursementRow?.승인번호) return null;
  return approvalRows.find((row) => row.요청번호 === disbursementRow.승인번호) ?? null;
}

function getDisbursementRetryGuide(row: TableRow | null) {
  if (row?.재처리정책) return row.재처리차단코드 ? `${row.재처리정책} (${row.재처리차단코드})` : row.재처리정책;
  const status = row?.지급상태 ?? "";
  const accountStatus = row?.계좌확인 ?? "";

  if (status !== "오류") return "오류 상태가 아니므로 재처리 대상이 아닙니다.";
  if (accountStatus.includes("불일치")) return "계좌 불일치 건은 계좌 재확인 후 지급 예정 상태로 되돌려 재처리합니다.";
  if (accountStatus.includes("대기")) return "계좌 확인 대기 건은 계좌 확인 완료 후 지급 예정 상태로 되돌려 재처리합니다.";
  return "계좌 확인 완료 건은 지급 예정 상태로 되돌린 뒤 지급 실행을 재시도합니다.";
}

function canRetryDisbursementByPolicy(row: TableRow | null) {
  if (row?.재처리가능) return row.재처리가능 === "가능";
  return row?.지급상태 === "오류" && row?.계좌확인 === "확인 완료";
}

function canExecuteDisbursementByPolicy(row: TableRow | null) {
  if (!row) return false;
  if (!canExecuteDisbursement(row.지급상태, row.계좌확인)) return false;
  if (row.거래처계좌확인 && row.거래처계좌확인 !== "확인 완료") return false;
  if (row.계좌검증코드 && row.계좌검증코드 !== "BANK_ACCOUNT_VERIFIED") return false;
  return true;
}

function buildDisbursementExecutePatch(currentUser: AuthUser, row?: TableRow | null): TableRow {
  const paymentId = row?.지급번호 ?? "선택지급";
  const idempotencyKey = `disbursement-execute-${paymentId}-${Date.now()}`;
  return {
    지급상태: "지급 완료",
    계좌확인: "확인 완료",
    담당자: currentUser.name,
    rowVersion: row?.rowVersion ?? "1",
    idempotencyKey,
    승인번호: row?.승인번호 ?? "",
    금액: row?.금액 ?? "",
    거래처: row?.거래처 ?? "",
    "지급 이력": `2024-06-03 11:00 ${currentUser.name} 지급 실행`,
  };
}

function buildDisbursementMutationPatch(action: string, currentUser: AuthUser, row: TableRow | null | undefined, patch: TableRow): TableRow {
  const paymentId = row?.지급번호 ?? "선택지급";
  return {
    ...patch,
    담당자: currentUser.name,
    rowVersion: row?.rowVersion ?? "1",
    idempotencyKey: `disbursement-${action}-${paymentId}-${Date.now()}`,
  };
}

function splitVendorBank(value = "") {
  const [bankName, ...accountParts] = value.split(" ");
  return {
    bankName: bankName || "",
    bankAccount: accountParts.join(" "),
  };
}

function maskAccountForDisplay(value = "") {
  const trimmed = value.trim();
  if (!trimmed) return "****";
  if (trimmed.includes("*")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****-${digits.slice(-4)}`;
}

function makeVendorDraft(row: TableRow): VendorDraft {
  const { bankName, bankAccount } = splitVendorBank(row.은행);
  const vendorSlug = row.거래처명.replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase() || "vendor";
  return {
    originalName: row.거래처명,
    name: row.거래처명,
    businessNumber: row.사업자번호,
    manager: row.담당자,
    bankName,
    bankAccount,
    accountStatus: row.계좌확인,
    status: row.상태,
    taxEmail: row["세금계산서 이메일"] ?? `tax@${vendorSlug}.co.kr`,
    taxIssueType: row["세금계산서 발행"] ?? "이메일 발행",
  };
}

function buildVendorRow(draft: VendorDraft, previous?: TableRow): TableRow {
  return {
    거래처명: draft.name.trim(),
    사업자번호: draft.businessNumber.trim(),
    담당자: draft.manager.trim(),
    은행: `${draft.bankName.trim()} ${draft.bankAccount.trim()}`.trim(),
    계좌확인: draft.accountStatus,
    구분: getVendorBusinessType(draft.name.trim()),
    최근지급일: previous?.최근지급일 ?? "-",
    누적지급액: previous?.누적지급액 ?? "0 원",
    상태: draft.status,
    "세금계산서 이메일": draft.taxEmail.trim(),
    "세금계산서 발행": draft.taxIssueType,
    거래처RowVersion: previous?.거래처RowVersion ?? previous?.rowVersion ?? "1",
  };
}

function vendorRowVersion(row?: TableRow) {
  return row?.거래처RowVersion || row?.rowVersion || "1";
}

function vendorMutationKey(action: string, row: TableRow, rowVersion = vendorRowVersion(row)) {
  const stableId = row.사업자번호 || row.거래처명 || "vendor";
  return `vendor-${action}-${stableId}-${rowVersion}-${Date.now()}`;
}

function isValidVendorTaxEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getVendorRecentPayments(vendorName: string, sourceDisbursementRows: TableRow[], sourcePaymentRows: TableRow[]): VendorPaymentHistoryItem[] {
  const disbursementRequestIds = new Set<string>();
  const disbursementHistory = sourceDisbursementRows
    .filter((row) => row.거래처 === vendorName)
    .map((row) => {
      if (row.승인번호) disbursementRequestIds.add(row.승인번호);
      return {
        id: row.승인번호 || row.지급번호,
        date: row.지급예정일,
        department: row.부서 || row.담당자 || "-",
        amount: row.금액,
        status: row.지급상태,
        source: "지급" as const,
      };
    });
  const requestHistory = sourcePaymentRows
    .filter((row) => row.거래처 === vendorName && !disbursementRequestIds.has(row.요청번호))
    .map((row) => ({
      id: row.요청번호,
      date: row.요청일,
      department: row.부서 || row.요청자 || "-",
      amount: row.금액,
      status: row.상태,
      source: "요청" as const,
    }));
  return [...disbursementHistory, ...requestHistory].sort((a, b) => b.date.localeCompare(a.date));
}

function formatApprovalLimitRange(limit: ApprovalLimitRow) {
  const startLabel = `${formatCurrencyWon(limit.min).replace(" 원", "")} 원`;
  if (limit.min === 0) return `~ ${formatCurrencyWon(limit.max ?? 0)}`;
  if (limit.max === null) return `${startLabel} ~`;
  return `${startLabel} ~ ${formatCurrencyWon(limit.max)}`;
}

function getSettingsTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatFileTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getSettingsTimestamp();
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getVendorDocumentCategory(fileName: string): VendorDocument["category"] {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.includes("세금") || normalizedName.includes("tax") || normalizedName.includes("invoice")) return "세금계산서";
  if (normalizedName.includes("통장") || normalizedName.includes("bank") || normalizedName.includes("account")) return "통장사본";
  if (normalizedName.includes("사업자") || normalizedName.includes("business") || normalizedName.includes("license")) return "사업자등록증";
  return "기타";
}

function getVendorBusinessType(vendorName: string) {
  if (vendorName.includes("(주)") || vendorName.includes("무역")) return "법인";
  if (vendorName.includes("오피스") || vendorName.includes("콘텐츠")) return "개인/소상공";
  return "일반";
}

function roleGroupToPermissionCodes(group: Pick<RolePermissionGroup, "permissions" | "permissionCodes">) {
  const directPermissions = normalizePermissionCodes(group.permissionCodes);
  return directPermissions.length > 0 ? directPermissions : rolePermissionCodesFromColumns(group.permissions);
}

function roleDtoToGroup(role: RoleSettingsDto): RolePermissionGroup {
  return {
    id: role.id,
    name: role.name,
    tag: role.tag || role.code,
    userCount: role.userCount,
    permissions: rolePermissionsToColumns(role.permissions),
    permissionCodes: normalizePermissionCodes(role.permissions),
    status: role.status,
    rowVersion: role.rowVersion,
  };
}

function roleGroupToInput(group: RolePermissionGroup): RoleSettingsInput {
  return {
    name: group.name,
    tag: group.tag,
    permissions: roleGroupToPermissionCodes(group),
    status: group.status,
    rowVersion: group.rowVersion,
  };
}

function roleMutationKey(action: string, group: Pick<RolePermissionGroup, "id" | "rowVersion">) {
  return `settings-role-${action}-${group.id}-${group.rowVersion}-${Date.now()}`;
}

function assignedUserName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*/g, "").trim();
}

function settingRowToAssignedUser(row: TableRow, fallbackId: string | number): AssignedUser {
  return {
    id: row.사용자 || `assigned-${fallbackId}`,
    user: row.사용자,
    department: row.부서,
    groupName: row.권한그룹,
    role: row.역할,
    status: row.상태,
    rowVersion: row.사용자RowVersion ?? row.rowVersion ?? "1",
  };
}

function withRoleUserCounts(roles: RolePermissionGroup[], users: AssignedUser[]) {
  const activeCounts = users.reduce<Record<string, number>>((counts, user) => {
    if (user.status === "비활성") return counts;
    counts[user.groupName] = (counts[user.groupName] ?? 0) + 1;
    return counts;
  }, {});
  return roles.map((role) => ({ ...role, userCount: activeCounts[role.name] ?? 0 }));
}

function userPermissionMutationKey(action: string, userName: string, rowVersion?: string) {
  return `settings-user-${action}-${userName}-${rowVersion ?? "new"}-${Date.now()}`;
}

function stableJsonHash(value: unknown) {
  let text = "";
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    text = String(value);
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function systemSettingMutationKey(key: SystemSettingKey, expectedAuditLogId: string | null, value: unknown) {
  return `settings-config-${key}-${expectedAuditLogId ?? "initial"}-${stableJsonHash(value)}`;
}

function sessionRevocationNotice(meta: Record<string, string | number | boolean> | undefined) {
  const sessionsRevoked = Number(meta?.sessionsRevoked ?? 0);
  if (Number.isFinite(sessionsRevoked) && sessionsRevoked > 0) {
    return ` 대상 사용자 ${sessionsRevoked}개 세션은 재로그인이 필요합니다.`;
  }
  const policy = typeof meta?.sessionPolicy === "string" ? meta.sessionPolicy : "";
  return policy && !policy.includes("영향 없는") ? ` ${policy}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function restoreApprovalPolicySnapshot(value: unknown) {
  if (!isRecord(value)) return null;
  const limits = Array.isArray(value.approvalLimits) ? (value.approvalLimits as ApprovalLimitRow[]) : null;
  const rules = isRecord(value.approvalRules) ? (value.approvalRules as ApprovalRuleSettings) : null;
  const departmentSettings = Array.isArray(value.departmentSettings) ? (value.departmentSettings as TableRow[]) : null;
  return { limits, rules, departmentSettings };
}

function restoreNotificationSettingsSnapshot(value: unknown) {
  return Array.isArray(value) ? (value as NotificationSetting[]) : null;
}

function restoreIntegrationSettingsSnapshot(value: unknown) {
  return Array.isArray(value) ? (value as IntegrationSetting[]) : null;
}

function cloneSettingsServerSnapshot(snapshot: SettingsServerSnapshot): SettingsServerSnapshot {
  return {
    approvalLimits: snapshot.approvalLimits.map((limit) => ({ ...limit })),
    approvalRules: { ...snapshot.approvalRules },
    departmentSettings: snapshot.departmentSettings.map((department) => ({ ...department })),
    roleGroups: snapshot.roleGroups.map((role) => {
      const permissionCodes = Array.isArray((role as Partial<RolePermissionGroup>).permissionCodes)
        ? normalizePermissionCodes(role.permissionCodes)
        : rolePermissionCodesFromColumns(role.permissions);
      return { ...role, permissions: { ...role.permissions }, permissionCodes };
    }),
    assignedUsers: snapshot.assignedUsers.map((user) => ({ ...user })),
    notificationSettings: snapshot.notificationSettings.map((setting) => ({ ...setting })),
    integrationSettings: snapshot.integrationSettings.map((setting) => ({ ...setting })),
  };
}

function getRoleTemplatePermissionCodes(template: RoleGroupDraft["template"]) {
  if (template === "관리 중심") {
    return normalizePermissionCodes(["*"]);
  }
  if (template === "승인 중심") {
    return normalizePermissionCodes([
      "dashboard:read",
      "favorite:read",
      "payment_request:read_all",
      "approval:read_assigned",
      "approval:act",
      "budget:read",
      "report:read",
    ]);
  }
  if (template === "조회 중심") {
    return normalizePermissionCodes(["dashboard:read", "favorite:read", "report:read", "audit:read"]);
  }
  return normalizePermissionCodes([
    "dashboard:read",
    "favorite:read",
    "payment_request:create",
    "payment_request:read_own",
    "payment_request:submit",
    "payment_request:update_own",
  ]);
}

function getRoleTemplatePermissions(template: RoleGroupDraft["template"]): Record<PermissionColumn, boolean> {
  return rolePermissionsToColumns(getRoleTemplatePermissionCodes(template));
}

function getNextApprovalLimit(limits: ApprovalLimitRow[]): ApprovalLimitRow {
  const lastMax = Math.max(...limits.map((limit) => limit.max ?? limit.min));
  const nextMin = lastMax + 1;
  const nextMax = lastMax + 20_000_000;
  return {
    id: `limit-${limits.length + 1}-${Date.now()}`,
    min: nextMin,
    max: nextMax,
    step: "4단계",
    requiredApprovers: 4,
    status: "활성",
  };
}

function formatMillionWon(value: number) {
  return `${(value / 1_000_000).toFixed(1)}M`;
}


function getReportFilterOptions(rows: TableRow[], field: "부서" | "거래처", fallbackRows: TableRow[], fallbackField: string, allLabel: string) {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (value) values.add(value);
  }
  for (const row of fallbackRows) {
    const value = row[fallbackField];
    if (value) values.add(value);
  }
  return [allLabel, ...Array.from(values).filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"))];
}

function normalizeReportSnapshotRows(value: unknown): TableRow[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      return [Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, cell]) => [key, jsonText(cell)])) as TableRow];
    })
    : [];
}

function buildLocalReportDrilldownSnapshot(reportName: string) {
  return {
    generatedAt: new Date().toISOString(),
    source: `Local ReportRun snapshot · ${reportName}`,
    sections: {
      monthly: {
        columns: ["월", "지급번호", "승인번호", "지급예정일", "거래처", "금액", "지급상태"],
        rows: disbursementRows.slice(0, 40).map((row) => ({
          월: `${Number(row.지급예정일?.slice(5, 7) || "0")}월 지급 추이`,
          지급번호: row.지급번호,
          승인번호: row.승인번호,
          지급예정일: row.지급예정일,
          거래처: row.거래처,
          금액: row.금액,
          지급상태: row.지급상태,
        })),
      },
      department: {
        columns: ["요청번호", "요청일", "부서", "거래처", "금액", "상태"],
        rows: paymentRows.slice(0, 40).map((row) => ({
          요청번호: row.요청번호,
          요청일: row.요청일,
          부서: row.부서,
          거래처: row.거래처,
          금액: row.금액,
          상태: row.상태,
        })),
      },
      approval: {
        columns: ["요청번호", "요청일", "부서", "요청자", "금액", "결재상태"],
        rows: approvalRows.slice(0, 40).map((row) => ({
          요청번호: row.요청번호,
          요청일: row.요청일,
          부서: row.부서,
          요청자: row.요청자,
          금액: row.금액,
          결재상태: row.결재상태,
        })),
      },
    },
  };
}

function getReportSnapshotSection(row: TableRow | null | undefined, kind: "monthly" | "department" | "approval") {
  const snapshot = readJsonRecord(row?.드릴다운JSON);
  const sections = snapshot.sections && typeof snapshot.sections === "object" && !Array.isArray(snapshot.sections) ? snapshot.sections as Record<string, unknown> : {};
  const section = sections[kind];
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  const columns = Array.isArray((section as { columns?: unknown }).columns)
    ? ((section as { columns: unknown[] }).columns).map(jsonText).filter(Boolean)
    : [];
  const rows = normalizeReportSnapshotRows((section as { rows?: unknown }).rows);
  if (columns.length === 0 || rows.length === 0) return null;
  return {
    columns,
    rows,
    source: `${jsonText(snapshot.source) || "ReportRun snapshot"}${jsonText(snapshot.generatedAt) ? ` · ${jsonText(snapshot.generatedAt).slice(0, 16).replace("T", " ")}` : ""}`,
  };
}

function filterReportSnapshotRows(label: string, kind: "monthly" | "department" | "approval", rows: TableRow[]) {
  const filtered = rows.filter((row) => {
    if (kind === "monthly") {
      const monthLabel = row.월?.replace(" 지급 추이", "") ?? "";
      return Boolean(monthLabel) && (row.월 === label || label.includes(monthLabel));
    }
    if (kind === "department") return row.부서 === label || row.부서?.includes(label);
    return (row.결재상태 || row.상태 || "").includes(label);
  });
  return filtered.length > 0 ? filtered : rows;
}

function getReportDrilldown(label: string, kind: "monthly" | "department" | "approval", report?: TableRow | null): ReportDrilldownState {
  const snapshotSection = getReportSnapshotSection(report, kind);
  if (snapshotSection) {
    const titleSuffix = kind === "monthly" ? "지급 추이" : kind === "department" ? "부서 지출" : "승인 상태";
    return {
      title: `${label} ${titleSuffix} 원천 데이터`,
      source: snapshotSection.source,
      columns: snapshotSection.columns,
      rows: filterReportSnapshotRows(label, kind, snapshotSection.rows),
    };
  }
  if (kind === "department") {
    const rows = paymentRows.filter((row) => row.부서 === label || row.부서?.includes(label)).slice(0, 12);
    return {
      title: `${label} 부서 지출 원천 데이터`,
      source: "payment-request + disbursement master",
      columns: ["요청번호", "요청일", "부서", "거래처", "금액", "상태"],
      rows: rows.length > 0 ? rows : paymentRows.slice(0, 8),
    };
  }
  if (kind === "approval") {
    const rows = approvalRows.filter((row) => (row.결재상태 || row.상태 || "").includes(label)).slice(0, 12);
    return {
      title: `${label} 승인 상태 원천 데이터`,
      source: "approval workflow rows",
      columns: ["요청번호", "요청일시", "부서", "요청자", "금액", "결재상태"],
      rows: rows.length > 0 ? rows : approvalRows.slice(0, 8),
    };
  }
  return {
    title: `${label} 지급 추이 원천 데이터`,
    source: "disbursement rows",
    columns: ["지급번호", "승인번호", "지급예정일", "거래처", "금액", "지급상태"],
    rows: disbursementRows.slice(0, 12),
  };
}

function getInitialDepartmentSettings(rows: TableRow[], roles: RolePermissionGroup[]) {
  const sourceRows: TableRow[] = rows.length > 0
    ? rows
    : paymentDepartmentOptions.map((department, index) => ({
      부서: department.replace(/^전체\s*/, "") || `신규 부서 ${index + 1}`,
      "배정 예산": "0",
      사용률: "0%",
      상태: "정상",
    }));
  return sourceRows
    .filter((row) => row.부서 && !String(row.부서).startsWith("전체"))
    .map((row, index) => ({
      ...row,
      기본권한그룹: row.기본권한그룹 ?? roles[index % Math.max(roles.length, 1)]?.name ?? "일반 사용자",
      승인라우팅: row.승인라우팅 ?? "금액 기준",
      예산담당자: row.예산담당자 ?? "미지정",
      상태: row.상태 ?? "정상",
      사용률: row.사용률 ?? "0%",
      "배정 예산": row["배정 예산"] ?? "0",
    }));
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function triggerTextDownload(fileName: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerBase64Download(fileName: string, contentType: string, contentBase64: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTableCsv(fileName: string, columns: string[], rows: TableRow[]) {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column] ?? "")).join(","));
  triggerTextDownload(fileName, `\uFEFF${[header, ...body].join("\r\n")}`, "text/csv;charset=utf-8");
}

function downloadAttachmentFile(fileName: string, lines: string[]) {
  triggerTextDownload(fileName, lines.join("\n"));
}

function triggerUrlDownload(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function triggerUrlPreview(url: string) {
  const previewWindow = window.open(url, "_blank", "noopener,noreferrer");
  return Boolean(previewWindow);
}

function canDownloadDirectly(url: string) {
  return url.startsWith("/") || /^https?:\/\//i.test(url);
}

function matchAcceptedFiles(files: File[], accepted: AttachmentDraft[]) {
  const usedIndexes = new Set<number>();
  return accepted.flatMap((attachment) => {
    const fileIndex = files.findIndex((file, index) => !usedIndexes.has(index) && file.name === attachment.fileName && file.size === attachment.byteSize);
    if (fileIndex < 0) return [];
    usedIndexes.add(fileIndex);
    return [{ attachment, file: files[fileIndex] }];
  });
}

function toStoredAttachment(file: FileDto, fallbackId = file.id): AttachmentDraft {
  const isBlocked = file.scanStatus === "blocked";
  const isClean = file.scanStatus === "clean";
  return {
    id: fallbackId,
    remoteId: file.id,
    fileName: file.fileName,
    byteSize: file.byteSize,
    status: isBlocked ? "error" : isClean ? "ready" : "uploading",
    scanStatus: file.scanStatus,
    progressPercent: isClean ? 100 : 0,
    message: isBlocked ? "보안 검사 차단" : isClean ? undefined : "보안 검사 대기",
  };
}

function toStoredVendorDocument(file: FileDto): VendorDocument {
  return {
    ...toStoredAttachment(file),
    category: getVendorDocumentCategory(file.fileName),
    uploadedAt: formatFileTimestamp(file.createdAt),
  };
}

function mergeSyncedVendorDocuments(synced: VendorDocument[], current: VendorDocument[]) {
  const syncedIds = new Set(synced.map((document) => document.remoteId ?? document.id));
  const syncedFingerprints = new Set(synced.map((document) => `${document.fileName}:${document.byteSize}`));
  const transientDocuments = current.filter((document) => {
    const documentKey = document.remoteId ?? document.id;
    const fingerprint = `${document.fileName}:${document.byteSize}`;
    return !syncedIds.has(documentKey)
      && !syncedFingerprints.has(fingerprint)
      && (document.status === "uploading" || document.status === "error" || document.message === deferredVendorUploadMessage);
  });
  return [...synced, ...transientDocuments];
}

function mergeCompletedVendorUploads(uploaded: VendorDocument[], current: VendorDocument[], uploadingIds: Set<string>) {
  const uploadedRemoteIds = new Set(
    uploaded
      .map((document) => document.remoteId)
      .filter((remoteId): remoteId is string => Boolean(remoteId)),
  );
  const retainedDocuments = current.filter((document) => {
    if (uploadingIds.has(document.id)) return false;
    const remoteId = document.remoteId ?? document.id;
    return !uploadedRemoteIds.has(remoteId);
  });
  return [...uploaded, ...retainedDocuments];
}

function fileMutationKey(action: string, ownerType: FileOwnerType, ownerId: string, stableId: string, detail = "") {
  return ["file", action, ownerType, ownerId, stableId, detail]
    .filter(Boolean)
    .map((part) => String(part).trim().replace(/\s+/g, "_").slice(0, 120))
    .join(":");
}

function uploadRecoveryKey(ownerType: FileOwnerType, ownerId: string) {
  return `erp-upload-recovery:${ownerType}:${ownerId}`;
}

function recoverableAttachment(attachment: AttachmentDraft): AttachmentDraft {
  const wasUploading = attachment.status === "uploading";
  return {
    id: attachment.id,
    remoteId: attachment.remoteId,
    fileName: attachment.fileName,
    byteSize: attachment.byteSize,
    status: wasUploading ? "error" : attachment.status,
    progressPercent: wasUploading ? 0 : attachment.progressPercent,
    retryCount: attachment.retryCount,
    scanStatus: attachment.scanStatus,
    message: wasUploading
      ? "업로드 중 화면 이탈 감지. 원본 파일을 다시 선택해 재시도하세요."
      : attachment.message ?? "업로드 실패. 원본 파일을 다시 선택해 재시도하세요.",
  };
}

function readUploadRecovery(ownerType: FileOwnerType, ownerId: string): AttachmentDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(uploadRecoveryKey(ownerType, ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AttachmentDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((attachment) => attachment && attachment.id && attachment.fileName && attachment.status !== "ready")
      .map(recoverableAttachment);
  } catch {
    return [];
  }
}

function replaceUploadRecoveryItems(ownerType: FileOwnerType, ownerId: string, items: AttachmentDraft[], touchedIds: string[] = items.map((item) => item.id)) {
  if (typeof window === "undefined") return;
  try {
    const touched = new Set(touchedIds);
    const existing = readUploadRecovery(ownerType, ownerId).filter((item) => !touched.has(item.id));
    const next = [
      ...existing,
      ...items
        .filter((item) => item.status !== "ready")
        .map((item) => ({
          id: item.id,
          remoteId: item.remoteId,
          fileName: item.fileName,
          byteSize: item.byteSize,
          status: item.status,
          progressPercent: item.progressPercent,
          retryCount: item.retryCount,
          scanStatus: item.scanStatus,
          message: item.message,
        })),
    ];
    const key = uploadRecoveryKey(ownerType, ownerId);
    if (next.length > 0) {
      window.localStorage.setItem(key, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Recovery metadata is best-effort. File storage remains the source of truth.
  }
}

async function uploadAttachmentToStorage(
  ownerType: FileOwnerType,
  ownerId: string,
  file: File,
  fallbackId: string,
  options: { onProgress?: (percent: number, message: string) => void } = {},
) {
  const notifyProgress = (percent: number, message: string) => options.onProgress?.(Math.max(0, Math.min(100, percent)), message);
  const uploadKey = fileMutationKey("upload", ownerType, ownerId, fallbackId, `${file.name}:${file.size}:${file.lastModified}`);
  notifyProgress(4, "업로드 준비 중");
  const ticket = await erpApi.presignFileUpload({
    ownerType,
    ownerId,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    byteSize: file.size,
    idempotencyKey: `${uploadKey}:presign`,
  });
  notifyProgress(12, "저장소 업로드 URL 발급 완료");
  await erpApi.uploadFileContent(ticket.data.upload.url, file, (progress) => {
    notifyProgress(12 + Math.round(progress.percent * 0.76), `${progress.percent}% 전송 중`);
  });
  notifyProgress(92, "보안 검사 완료 처리 중");
  const completed = await erpApi.completeFileUpload(ticket.data.file.id, { idempotencyKey: `${uploadKey}:complete` });
  notifyProgress(100, "업로드 완료");
  return { ...toStoredAttachment(completed.data, fallbackId), progressPercent: 100 };
}

function goToPage(pageKey: PageKey) {
  window.location.hash = pageKey;
}

function getMonthlyDisbursementValues() {
  const total = disbursementRows.reduce((sum, row) => sum + parseWon(row.금액), 0);
  return [0.48, 0.54, 0.6, 0.68, 0.82, 1].map((ratio) => Math.round(total * ratio));
}

function getDepartmentSpendItems() {
  const totals = approvalRows.reduce(
    (acc, row) => {
      acc[row.부서] = (acc[row.부서] ?? 0) + parseWon(row.금액);
      return acc;
    },
    {} as Record<string, number>,
  );
  const max = Math.max(...Object.values(totals), 1);
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([department, amount]) => [department, formatMillionWon(amount), Math.max(12, Math.round((amount / max) * 100))] as [string, string, number]);
}

function getApprovalStatusItems() {
  const totals = approvalRows.reduce(
    (acc, row) => {
      acc[row.결재상태] = (acc[row.결재상태] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const total = Math.max(1, Object.values(totals).reduce((sum, value) => sum + value, 0));
  return [
    ["승인 완료", totals["승인 완료"] ?? 0, "teal"],
    ["승인 진행 중", totals["승인 진행 중"] ?? 0, "blue"],
    ["반려", totals["반려"] ?? 0, "orange"],
    ["승인 대기", totals["승인 대기"] ?? 0, "gray"],
  ].map(([label, count, color]) => [String(label), `${count} (${((Number(count) / total) * 100).toFixed(1)}%)`, String(color)] as [string, string, string]);
}

function getBudgetNumber(row: TableRow, field: "배정 예산" | "사용 금액" | "잔액") {
  return parseWon(row[field] ?? "0");
}

function getBudgetUsageRate(row: TableRow) {
  const allocated = getBudgetNumber(row, "배정 예산");
  const used = getBudgetNumber(row, "사용 금액");
  if (allocated <= 0) return 0;
  return Math.round((used / allocated) * 100);
}

function getBudgetRelatedRequests(department: string) {
  return approvalRows.filter((row) => row.부서 === department).slice(0, 5);
}

function formatBudgetAdjustmentHistory(row: TableRow) {
  return `${row.요청일시 ?? "-"} ${row.부서 ?? "-"} 예산 ${row.조정금액 ?? "-"} · ${row.상태 ?? "-"} · ${row.조정사유 ?? ""}`;
}

function getRowId(pageKey: PageKey, row: TableRow) {
  return row[pages[pageKey].tableColumns[0]] ?? "";
}

function sameSelection(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function mutationErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function SortableColumnHeader({ column, table }: { column: string; table: TableController }) {
  const active = table.sortColumn === column;
  return (
    <button className={active ? "table-sort-button active" : "table-sort-button"} onClick={() => table.sortByColumn(column)} type="button">
      {column}
      <span>{active ? (table.sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

function TableStateRow({ colSpan, table }: { colSpan: number; table: TableController }) {
  if (table.isLoading) {
    return (
      <tr className="table-state-row">
        <td colSpan={colSpan}>목록을 불러오는 중입니다.</td>
      </tr>
    );
  }
  if (table.errorMessage) {
    return (
      <tr className="table-state-row error">
        <td colSpan={colSpan}>
          {table.errorMessage}
          <button onClick={table.refresh} type="button">다시 시도</button>
        </td>
      </tr>
    );
  }
  if (table.rows.length === 0) {
    return (
      <tr className="table-state-row">
        <td colSpan={colSpan}>조건에 맞는 데이터가 없습니다.</td>
      </tr>
    );
  }
  return null;
}

function DetailFilterPanel({
  fields,
  onApply,
  onClose,
  onReset,
  title,
}: {
  fields: DetailFilterField[];
  onApply: () => void;
  onClose: () => void;
  onReset: () => void;
  title: string;
}) {
  return (
    <section className="detail-filter-panel" aria-label={`${title} 상세 필터`}>
      <header>
        <strong>{title}</strong>
        <button aria-label={`${title} 필터 닫기`} onClick={onClose} type="button">
          <X size={16} />
        </button>
      </header>
      <div>
        {fields.map((field) => (
          <span key={field.label}>
            <b>{field.label}</b>
            {field.value}
          </span>
        ))}
      </div>
      <footer>
        <button onClick={onReset} type="button">초기화</button>
        <button className="apply" onClick={onApply} type="button">적용</button>
      </footer>
    </section>
  );
}

function ClosedDetailPanel({ onOpen, title }: { onOpen: () => void; title: string }) {
  return (
    <aside className="closed-detail-panel" aria-label={`${title} 닫힘`}>
      <strong>{title}</strong>
      <span>상세 패널이 닫혔습니다.</span>
      <button onClick={onOpen} type="button">다시 열기</button>
    </aside>
  );
}

function useManagedTable(pageKey: PageKey, searchQuery: string, extraFilters: Partial<Record<string, string>> = emptyExtraFilters): TableController {
  const statusOptions = filterOptionsByPage[pageKey] ?? defaultStatusOptions;
  const statusColumn = statusColumnByPage[pageKey];
  const storedTableState = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(`erp-table-state:${pageKey}`) ?? "{}") as Partial<{
        page: number;
        pageSize: number;
        statusFilter: string;
        sortColumn: string;
        sortDirection: SortDirection;
      }>;
    } catch {
      return {};
    }
  })();
  const hasStoredTableState = Object.keys(storedTableState).length > 0;
  const extraFilterKey = JSON.stringify(extraFilters);
  const [rows, setRows] = useState<TableRow[]>(() => pages[pageKey].tableRows.slice(0, 10));
  const [total, setTotal] = useState(pages[pageKey].tableRows.length);
  const [page, setPageState] = useState(storedTableState.page ?? 1);
  const [pageSize, setPageSize] = useState(storedTableState.pageSize ?? 10);
  const [statusFilter, setStatusFilterState] = useState(storedTableState.statusFilter && statusOptions.includes(storedTableState.statusFilter) ? storedTableState.statusFilter : statusOptions[0]);
  const [sortColumn, setSortColumn] = useState(storedTableState.sortColumn ?? pages[pageKey].tableColumns[0]);
  const [sortDirection, setSortDirection] = useState<SortDirection>(storedTableState.sortDirection ?? "asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRowId, setActiveRowId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    setPageState(1);
    setStatusFilterState(storedTableState.statusFilter && statusOptions.includes(storedTableState.statusFilter) ? storedTableState.statusFilter : statusOptions[0]);
    setSelectedIds(new Set());
    setActiveRowId("");
    setActionMessage("");
    setErrorMessage("");
    setSortColumn(storedTableState.sortColumn ?? pages[pageKey].tableColumns[0]);
    setSortDirection(storedTableState.sortDirection ?? "asc");
    if (hasStoredTableState) setActionMessage("최근 실행 조건을 복원했습니다.");
  }, [pageKey, statusOptions]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        `erp-table-state:${pageKey}`,
        JSON.stringify({ page, pageSize, statusFilter, sortColumn, sortDirection }),
      );
    } catch {
      // localStorage is best-effort; table state still works in memory.
    }
  }, [pageKey, page, pageSize, statusFilter, sortColumn, sortDirection]);

  useEffect(() => {
    setPageState(1);
  }, [extraFilterKey, searchQuery, statusFilter, pageSize, sortColumn, sortDirection]);

  useEffect(() => {
    let active = true;
    const isAllFilter = statusFilter.startsWith("전체");
    const filters = {
      ...(statusColumn && !isAllFilter ? { [statusColumn]: statusFilter } : {}),
      ...Object.fromEntries(Object.entries(extraFilters).filter(([, value]) => value)),
    };
    setIsLoading(true);
    setErrorMessage("");

    erpApi.listPageRows(pageKey, {
      search: searchQuery,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      page,
      pageSize,
      sort: encodeSort(sortColumn, sortDirection),
    })
      .then((response) => {
        if (!active) return;
        setRows(response.data.rows);
        setTotal(response.data.total);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRows([]);
        setTotal(0);
        setErrorMessage(error instanceof Error ? error.message : "목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [extraFilterKey, pageKey, page, pageSize, refreshVersion, searchQuery, sortColumn, sortDirection, statusColumn, statusFilter]);

  useEffect(() => {
    const visibleIds = rows.map((row) => getRowId(pageKey, row)).filter(Boolean);
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.includes(id)));
      if (next.size === 0 && visibleIds[0]) next.add(visibleIds[0]);
      return sameSelection(current, next) ? current : next;
    });
    setActiveRowId((current) => (current && visibleIds.includes(current) ? current : visibleIds[0] ?? ""));
  }, [pageKey, rows]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => index + 1);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.has(getRowId(pageKey, row)));
  const selectedRows = rows.filter((row) => selectedIds.has(getRowId(pageKey, row)));
  const selectedRow = rows.find((row) => getRowId(pageKey, row) === activeRowId) ?? rows.find((row) => selectedIds.has(getRowId(pageKey, row))) ?? rows[0] ?? null;

  const captureMutationSnapshot = (): TableMutationSnapshot => ({
    rows,
    total,
    selectedIds: new Set(selectedIds),
    activeRowId,
  });

  const rollbackAndRequery = (snapshot: TableMutationSnapshot, message: string) => {
    setRows(snapshot.rows);
    setTotal(snapshot.total);
    setSelectedIds(new Set(snapshot.selectedIds));
    setActiveRowId(snapshot.activeRowId);
    setActionMessage(`${message} · 변경 전 화면 상태로 되돌리고 서버 원본을 다시 조회합니다.`);
    setRefreshVersion((current) => current + 1);
  };

  const setPage = (nextPage: number) => {
    setPageState(Math.min(pageCount, Math.max(1, nextPage)));
  };

  const toggleRow = (row: TableRow) => {
    const id = getRowId(pageKey, row);
    if (!id) return;
    setActiveRowId(id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleVisibleRows = () => {
    const visibleIds = rows.map((row) => getRowId(pageKey, row)).filter(Boolean);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (visibleIds.every((id) => next.has(id))) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const updateSelectedRow = async (patch: TableRow, message: string, options?: UpdateSelectedRowOptions) => {
    if (isMutating) return;
    if (!selectedRow) return;
    const rowId = getRowId(pageKey, selectedRow);
    if (!rowId) return;
    const snapshot = captureMutationSnapshot();
    setIsMutating(true);
    setErrorMessage("");
    try {
      const response = await erpApi.updatePageRow(pageKey, rowId, patch);
      const updatedRow = response.data;
      if (!updatedRow) {
        setRows(snapshot.rows);
        setTotal(snapshot.total);
        setActiveRowId(rowId);
        setSelectedIds(new Set([rowId]));
        setActionMessage(`${message} · 서버가 갱신 행을 반환하지 않아 원본 목록을 다시 조회합니다.`);
        setRefreshVersion((current) => current + 1);
        return;
      }
      const mergedRows = rows.map((currentRow) => (getRowId(pageKey, currentRow) === rowId ? updatedRow : currentRow));
      const nextRow = options?.selectNextRow?.(mergedRows, selectedRow, updatedRow);
      const nextSelectedId = nextRow ? getRowId(pageKey, nextRow) : getRowId(pageKey, updatedRow) || rowId;
      setRows(mergedRows);
      setActiveRowId(nextSelectedId);
      setSelectedIds(nextSelectedId ? new Set([nextSelectedId]) : new Set());
      setActionMessage(message);
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      rollbackAndRequery(snapshot, `작업 실패: ${mutationErrorMessage(error, "요청을 처리하지 못했습니다.")}`);
    } finally {
      setIsMutating(false);
    }
  };

  const updateSelectedRows = async (patch: TableRow | ((row: TableRow) => TableRow), message: string, predicate?: (row: TableRow) => boolean) => {
    if (isMutating) return;
    const targetRows = selectedRows.filter((targetRow) => (predicate ? predicate(targetRow) : true));
    if (targetRows.length === 0) {
      setActionMessage("처리 가능한 선택 항목이 없습니다.");
      return;
    }
    const snapshot = captureMutationSnapshot();
    setIsMutating(true);
    setErrorMessage("");
    try {
      const settledResults = await Promise.allSettled(targetRows.map(async (targetRow) => {
        const rowId = getRowId(pageKey, targetRow);
        if (!rowId) throw new Error("행 ID를 확인할 수 없습니다.");
        const nextPatch = typeof patch === "function" ? patch(targetRow) : patch;
        const response = await erpApi.updatePageRow(pageKey, rowId, nextPatch);
        if (!response.data) throw new Error("서버가 갱신 대상을 반환하지 않았습니다.");
        return { rowId, row: response.data };
      }));
      const successfulRows = settledResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failedRows = settledResults.flatMap((result, index) => result.status === "rejected" ? [{ row: targetRows[index], reason: result.reason }] : []);
      const updatedById = new Map(successfulRows.map((result) => [result.rowId, result.row]));
      setRows((currentRows) => currentRows.map((currentRow) => updatedById.get(getRowId(pageKey, currentRow)) ?? currentRow));
      const failedIds = failedRows.map((item) => getRowId(pageKey, item.row)).filter(Boolean);
      setSelectedIds(new Set(failedIds));
      setActiveRowId(failedIds[0] ?? "");
      if (failedRows.length > 0) {
        const failureSummary = failedRows.slice(0, 3).map((item) => {
          const rowId = getRowId(pageKey, item.row) || "ID 없음";
          const reason = item.reason instanceof Error ? item.reason.message : "처리 실패";
          return `${rowId}: ${reason}`;
        }).join(", ");
        const hiddenCount = Math.max(0, failedRows.length - 3);
        setActionMessage(`${message} · 성공 ${successfulRows.length}건 · 실패 ${failedRows.length}건 · 실패 항목 ${failureSummary}${hiddenCount ? ` 외 ${hiddenCount}건` : ""} · 성공 건은 반영하고 실패 건은 선택 유지`);
      } else {
        setActionMessage(message);
      }
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      rollbackAndRequery(snapshot, `작업 실패: ${mutationErrorMessage(error, "선택 항목을 처리하지 못했습니다.")}`);
    } finally {
      setIsMutating(false);
    }
  };

  const executeSelectedRowAction = async (action: string, input: { reason?: string; rowVersion?: number; idempotencyKey?: string; patch?: TableRow }, message: string) => {
    if (isMutating) return;
    if (!selectedRow) return;
    const rowId = getRowId(pageKey, selectedRow);
    if (!rowId) return;
    const snapshot = captureMutationSnapshot();
    setIsMutating(true);
    setErrorMessage("");
    try {
      await erpApi.executePageAction(pageKey, rowId, action, input);
      setActionMessage(message);
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      rollbackAndRequery(snapshot, `작업 실패: ${mutationErrorMessage(error, "요청을 처리하지 못했습니다.")}`);
    } finally {
      setIsMutating(false);
    }
  };

  const createRow = async (row: TableRow, message: string) => {
    if (isMutating) return;
    const snapshot = captureMutationSnapshot();
    setIsMutating(true);
    setErrorMessage("");
    try {
      const response = await erpApi.createPageRow(pageKey, row);
      const createdRow = response.data;
      setActionMessage(message);
      setPageState(1);
      const createdRowId = createdRow ? getRowId(pageKey, createdRow) : "";
      setActiveRowId(createdRowId);
      setSelectedIds(createdRowId ? new Set([createdRowId]) : new Set());
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      rollbackAndRequery(snapshot, `작업 실패: ${mutationErrorMessage(error, "요청을 생성하지 못했습니다.")}`);
    } finally {
      setIsMutating(false);
    }
  };

  const sortByColumn = (column: string) => {
    setSortColumn((current) => {
      if (current === column) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return column;
    });
  };

  return {
    rows,
    total,
    page,
    pageCount,
    pageSize,
    statusFilter,
    sortColumn,
    sortDirection,
    selectedRow,
    selectedRows,
    selectedCount: selectedIds.size,
    actionMessage,
    errorMessage,
    isLoading,
    isMutating,
    visiblePages,
    allVisibleSelected,
    isSelected: (row) => selectedIds.has(getRowId(pageKey, row)),
    setPage,
    nextPage: () => setPage(page + 1),
    previousPage: () => setPage(page - 1),
    cyclePageSize: () => setPageSize((current) => (current === 10 ? 20 : current === 20 ? 50 : 10)),
    cycleStatusFilter: () => {
      const currentIndex = statusOptions.indexOf(statusFilter);
      setStatusFilterState(statusOptions[(currentIndex + 1) % statusOptions.length]);
    },
    setStatusFilter: setStatusFilterState,
    refresh: () => setRefreshVersion((current) => current + 1),
    sortByColumn,
    toggleRow,
    toggleVisibleRows,
    setActionMessage,
    createRow,
    updateSelectedRow,
    updateSelectedRows,
    executeSelectedRowAction,
  };
}

function getRouteFromHash(): RouteKey {
  const hash = window.location.hash.replace("#", "");
  if (pageOrder.includes(hash as PageKey)) {
    return hash as PageKey;
  }
  return "landing";
}

function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? "logo-mark logo-mark-small" : "logo-mark"} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function App() {
  const [route, setRoute] = useState<RouteKey>(() => getRouteFromHash());

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (route === "landing") {
    return <LandingPage />;
  }

  return <ErpApplication activePage={route} />;
}

function LandingPage() {
  return (
    <main className="landing-shell">
      <TopNavigation />
      <section className="hero-stage" aria-label="결제 요청 승인 ERP 랜딩">
        <div className="office-backdrop" aria-hidden="true">
          <div className="window-line line-a" />
          <div className="window-line line-b" />
          <div className="window-line line-c" />
          <div className="soft-desk" />
          <div className="plant-blur leaf-a" />
          <div className="plant-blur leaf-b" />
          <div className="plant-blur leaf-c" />
        </div>

        <div className="hero-copy">
          <h1>결제 요청 승인 ERP</h1>
          <p>
            효율적인 결제 요청 처리와 체계적인 승인 프로세스로
            <br />
            기업의 재무 운영을 더 빠르고 투명하게
          </p>
          <div className="feature-strip" aria-label="핵심 기능">
            {featureItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div className="feature-item" key={item.label}>
                  <div className="feature-icon">
                    <Icon size={32} strokeWidth={2.1} />
                  </div>
                  <span>{item.label}</span>
                  {index < featureItems.length - 1 && <i aria-hidden="true" />}
                </div>
              );
            })}
          </div>
          <div className="hero-actions">
            <a className="primary-action" href="#dashboard">
              무료 체험 시작
            </a>
            <a className="secondary-action" href="#dashboard">
              제품 데모 보기 <span>▶</span>
            </a>
          </div>
        </div>

        <ProductShowcase />
      </section>
    </main>
  );
}

function TopNavigation() {
  const links: Array<[string, string]> = [
    ["제품", "#dashboard"],
    ["기능", "#payment-request"],
    ["솔루션", "#approval"],
    ["고객지원", "#settings"],
    ["가격", "#reports"],
    ["회사소개", "#favorites"],
  ];
  return (
    <header className="top-nav">
      <a className="brand" aria-label="홈" href="#landing">
        <LogoMark />
      </a>
      <nav className="nav-links" aria-label="주요 메뉴">
        {links.map(([label, href]) => (
          <a key={label} href={href}>
            {label}
          </a>
        ))}
      </nav>
      <div className="nav-actions">
        <a href="#dashboard" className="login-link">
          로그인
        </a>
        <a href="#dashboard" className="outline-action">
          문의하기
        </a>
        <a href="#dashboard" className="white-action">
          무료 체험
        </a>
      </div>
    </header>
  );
}

function ProductShowcase() {
  const previewMenus = [
    { icon: Home, title: "대시보드" },
    { icon: Bell, title: "알림 센터" },
    { icon: FileText, title: "결제 요청" },
    { icon: Download, title: "보고서 다운로드" },
    { icon: ShieldCheck, title: "권한 설정" },
  ];
  const [activePreview, setActivePreview] = useState(0);
  return (
    <div className="showcase-wrap" aria-label="ERP 제품 화면 미리보기">
      <div className="dashboard-frame">
        <aside className="app-sidebar">
          <LogoMark small />
          <nav>
            {previewMenus.map((item, index) => {
              const Icon = item.icon;
              return (
              <button className={index === activePreview ? "active" : ""} key={item.title} aria-label={`메뉴 ${index + 1}`} onClick={() => setActivePreview(index)} type="button">
                <Icon size={20} />
              </button>
              );
            })}
          </nav>
        </aside>

        <section className="app-content">
          <div className="app-header">
            <h2>{previewMenus[activePreview].title}</h2>
            <div className="app-tools">
              <div className="search-box">검색 (Ctrl + K)</div>
              <div className="bell-dot">
                <Bell size={20} />
                <b>8</b>
              </div>
              <div className="user-chip">
                <div className="avatar" />
                <span>
                  김민수 과장
                  <small>재무팀</small>
                </span>
              </div>
            </div>
          </div>

          <div className="approval-panel">
            <div className="panel-title-row">
              <strong>
                승인 대기 <em>5건</em>
              </strong>
              <a href="#dashboard">
                전체 보기 <ChevronRight size={14} />
              </a>
            </div>
            <div className="pending-grid">
              {pendingCards.map((card) => (
                <article className={card.accent ? "pending-card highlighted" : "pending-card"} key={card.id}>
                  <div>
                    <span>{card.id}</span>
                    <b>{card.title}</b>
                  </div>
                  <small className={card.accent ? "urgent" : ""}>{card.type}</small>
                  <dl>
                    <dt>요청자</dt>
                    <dd>{card.requester}</dd>
                    <dt>금액</dt>
                    <dd>{card.amount}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </div>

          <div className="metric-grid">
            <BudgetCard />
            <PaymentCard />
            <ApprovalCard />
          </div>

          <div className="bottom-grid">
            <RequestTable />
            <PaymentSummary />
          </div>
        </section>
      </div>
      <MobilePreview />
    </div>
  );
}

function BudgetCard() {
  return (
    <article className="dash-card budget-card">
      <header>
        <strong>예산 확인</strong>
        <a href="#budget">예산 상세 ›</a>
      </header>
      <div className="budget-body">
        <div className="donut navy-donut">
          <span>72%</span>
          <small>사용률</small>
        </div>
        <div className="budget-list">
          <span>마케팅 예산</span>
          <b>24,000,000 원</b>
          <i />
          <p>
            사용 금액 <strong>17,280,000 원</strong>
          </p>
          <p>
            잔여 예산 <strong>6,720,000 원</strong>
          </p>
        </div>
      </div>
    </article>
  );
}

function PaymentCard() {
  return (
    <article className="dash-card payment-card">
      <strong>지급 요청</strong>
      <div className="payment-totals">
        <div>
          <span>요청 건수</span>
          <b>23 건</b>
        </div>
        <div>
          <span>요청 금액</span>
          <b>38,560,000 원</b>
        </div>
      </div>
      <ul>
        <li>
          <i className="orange" /> 승인 대기 <span>5 건</span> <b>8,750,000 원</b>
        </li>
        <li>
          <i className="blue" /> 승인 진행 중 <span>7 건</span> <b>12,460,000 원</b>
        </li>
        <li>
          <i className="green" /> 승인 완료 <span>11 건</span> <b>17,350,000 원</b>
        </li>
      </ul>
      <a href="#approval">전체 내역 ›</a>
    </article>
  );
}

function ApprovalCard() {
  return (
    <article className="dash-card approval-card">
      <strong>승인 완료</strong>
      <div className="approval-body">
        <div className="donut teal-donut">
          <span>92%</span>
          <small>이번 달 승인율</small>
        </div>
        <dl>
          <dt>총 요청 건수</dt>
          <dd>125 건</dd>
          <dt>승인 완료 건수</dt>
          <dd>115 건</dd>
        </dl>
      </div>
    </article>
  );
}

function RequestTable() {
  return (
    <article className="dash-card request-card">
      <header>
        <strong>요청 내역</strong>
        <a href="#approval">전체 보기 ›</a>
      </header>
      <table>
        <thead>
          <tr>
            <th>요청 번호</th>
            <th>제목</th>
            <th>요청자</th>
            <th>금액</th>
            <th>상태</th>
            <th>요청일</th>
          </tr>
        </thead>
        <tbody>
          {requestRows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={cell + index}>{index === 4 ? <StatusPill value={cell} /> : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function PaymentSummary() {
  const periods = ["이번 달", "지난 달", "이번 분기"];
  const [periodIndex, setPeriodIndex] = useState(0);
  const totalByPeriod = ["28,560,000 원", "31,240,000 원", "82,400,000 원"];
  return (
    <article className="dash-card summary-card">
      <header>
        <strong>결제 요약</strong>
        <button onClick={() => setPeriodIndex((current) => (current + 1) % periods.length)} type="button">{periods[periodIndex]}⌄</button>
      </header>
      <span>총 지급 금액</span>
      <b>{totalByPeriod[periodIndex]}</b>
      <MiniBars compact />
      <div className="chart-legend">
        <span>
          <i /> 지급 완료
        </span>
        <span>
          <i /> 지급 예정
        </span>
      </div>
    </article>
  );
}

function MobilePreview() {
  return (
    <aside className="mobile-preview" aria-label="모바일 승인 흐름 미리보기">
      <div className="phone-top" />
      <header>
        <span>‹</span>
        <strong>승인 흐름</strong>
      </header>
      <ol className="timeline">
        {[
          ["요청 제출", "이주연 대리", "2024-06-01 09:30"],
          ["1차 승인", "박정우 차장", "2024-06-01 10:15"],
          ["2차 승인", "이상훈 부장", "2024-06-01 11:20"],
          ["최종 승인", "김민수 과장", "2024-06-01 14:05"],
        ].map((item, index) => (
          <li className={index === 3 ? "done" : ""} key={item[0]}>
            <i />
            <b>{item[0]}</b>
            <span>{item[1]}</span>
            <small>{item[2]}</small>
          </li>
        ))}
      </ol>
      <section>
        <strong>요청 정보</strong>
        <dl>
          <dt>요청 번호</dt>
          <dd>PR-2024-0058</dd>
          <dt>제목</dt>
          <dd>마케팅 콘텐츠 제작 비용</dd>
          <dt>금액</dt>
          <dd>2,450,000 원</dd>
        </dl>
      </section>
    </aside>
  );
}

function ErpApplication({ activePage }: { activePage: PageKey }) {
  const page = pages[activePage];
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authState, setAuthState] = useState<"checking" | "anonymous" | "authenticated">("checking");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [expiredPasswordMode, setExpiredPasswordMode] = useState(false);
  const [expiredNewPassword, setExpiredNewPassword] = useState("");
  const [expiredNewPasswordConfirm, setExpiredNewPasswordConfirm] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const allowedNavItems = useMemo(
    () => (currentUser ? navItems.filter((item) => canAccessPage(currentUser, item.key)) : []),
    [currentUser],
  );
  const activeNotifications = useMemo(() => notifications.filter(isNotificationActive), [notifications]);
  const unreadNotificationCount = activeNotifications.filter((notification) => !notification.readAt).length;
  const searchLabel =
    activePage === "disbursement"
      ? "지급번호, 거래처명, 승인번호 검색"
      : activePage === "vendors"
        ? "거래처명, 사업자번호, 담당자 검색"
        : "요청번호, 거래처, 요청자 검색";

  useEffect(() => {
    setSearchQuery("");
  }, [activePage]);

  useEffect(() => {
    const tooltipTimer = window.setTimeout(() => {
      document.querySelectorAll<HTMLButtonElement>("button[aria-label]").forEach((button) => {
        if (!button.title) button.title = button.getAttribute("aria-label") ?? "";
      });
      document.querySelectorAll<HTMLButtonElement>("button:disabled").forEach((button) => {
        if (!button.title) button.title = "현재 권한, 상태, 필수 입력 조건 때문에 처리할 수 없습니다.";
      });
    }, 0);
    return () => window.clearTimeout(tooltipTimer);
  }, [activePage, notificationOpen]);

  useEffect(() => {
    let active = true;
    erpApi
      .getCurrentUser()
      .then((response) => {
        if (active) {
          setCurrentUser(response.data);
          setAuthState("authenticated");
        }
      })
      .catch(() => {
        if (active) {
          setCurrentUser(null);
          setAuthState("anonymous");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setLoginMessage("이메일과 비밀번호를 입력하세요.");
      return;
    }
    setLoginSubmitting(true);
    setLoginMessage("");
    try {
      const response = await erpApi.login({ email: loginEmail.trim(), password: loginPassword });
      setCurrentUser(response.data);
      setAuthState("authenticated");
      setLoginPassword("");
      setExpiredPasswordMode(false);
      setExpiredNewPassword("");
      setExpiredNewPasswordConfirm("");
    } catch (error) {
      setCurrentUser(null);
      setAuthState("anonymous");
      if (error instanceof ApiRequestError && error.code === "PASSWORD_EXPIRED") {
        setExpiredPasswordMode(true);
        setLoginMessage("비밀번호가 만료되었습니다. 새 비밀번호를 설정한 뒤 다시 로그인하세요.");
      } else {
        setExpiredPasswordMode(false);
        setLoginMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
      }
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleExpiredPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email || !loginPassword || !expiredNewPassword || !expiredNewPasswordConfirm) {
      setLoginMessage("이메일, 현재 비밀번호, 새 비밀번호를 모두 입력하세요.");
      return;
    }
    if (expiredNewPassword !== expiredNewPasswordConfirm) {
      setLoginMessage("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoginSubmitting(true);
    try {
      const response = await erpApi.changeExpiredPassword({
        email,
        currentPassword: loginPassword,
        newPassword: expiredNewPassword,
      });
      setExpiredPasswordMode(false);
      setLoginPassword("");
      setExpiredNewPassword("");
      setExpiredNewPasswordConfirm("");
      setLoginMessage(`비밀번호가 변경되었습니다. ${response.data.expiresAt.slice(0, 10)}까지 사용할 수 있습니다. 새 비밀번호로 로그인하세요.`);
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await erpApi.logout().catch(() => undefined);
    setCurrentUser(null);
    setNotifications([]);
    setNotificationOpen(false);
    setAuthState("anonymous");
  };

  useEffect(() => {
    if (!currentUser || canAccessPage(currentUser, activePage)) return;
    window.location.hash = getDefaultPage(currentUser);
  }, [activePage, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    erpApi.listNotifications().then((response) => {
      if (active) setNotifications(response.data.filter(isNotificationActive));
    });
    return () => {
      active = false;
    };
  }, [currentUser]);

  if (authState === "checking") {
    return <AuthGateScreen message="세션 확인 중" />;
  }

  if (!currentUser) {
    return (
      <LoginScreen
        email={loginEmail}
        expiredMode={expiredPasswordMode}
        message={loginMessage}
        newPassword={expiredNewPassword}
        newPasswordConfirm={expiredNewPasswordConfirm}
        onEmailChange={(value) => {
          setLoginEmail(value);
          if (expiredPasswordMode) setLoginMessage("");
        }}
        onExpiredPasswordSubmit={handleExpiredPasswordChange}
        onNewPasswordChange={setExpiredNewPassword}
        onNewPasswordConfirmChange={setExpiredNewPasswordConfirm}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
        password={loginPassword}
        targetPage={page.title}
        submitting={loginSubmitting}
      />
    );
  }

  const markNotificationRead = async (notification: NotificationItem) => {
    const response = await erpApi.markNotificationRead(notification.id);
    if (response.data) {
      setNotifications((current) => current.map((item) => (item.id === response.data?.id ? response.data : item)));
    } else {
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
    }
    const route = notificationPageFromLink(response.data?.linkPath ?? notification.linkPath, currentUser);
    if (route) {
      goToPage(route);
      setNotificationOpen(false);
    }
  };

  const markAllNotificationsRead = async () => {
    const response = await erpApi.markAllNotificationsRead();
    setNotifications(response.data.filter(isNotificationActive));
  };

  return (
    <main className={sidebarOpen ? "erp-shell sidebar-open" : "erp-shell"}>
      <aside className="erp-sidebar">
        <a className="erp-logo" href="#landing" aria-label="랜딩으로 이동">
          <LogoMark small />
        </a>
        <nav className="erp-nav" aria-label="ERP 메뉴">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <a className={activePage === item.key ? "active" : ""} href={`#${item.key}`} key={item.key}>
                <Icon size={19} />
                <span>{item.label}</span>
                {item.key === "payment-request" && <ChevronDown size={14} />}
              </a>
            );
          })}
        </nav>
      </aside>

      <section className="erp-workspace">
        <header className="erp-topbar">
          <div className="erp-title">
            <button aria-expanded={sidebarOpen} aria-label="메뉴" onClick={() => setSidebarOpen((current) => !current)} type="button">
              <Menu size={22} />
            </button>
            <div>
              <span>{page.eyebrow}</span>
              <h1>{page.title}</h1>
            </div>
          </div>
          <div className="erp-search">
            <Search size={18} />
            <input
              aria-label={`${page.title} 검색`}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={searchLabel}
              value={searchQuery}
            />
          </div>
          <NotificationCenter
            notifications={activeNotifications}
            onMarkAllRead={markAllNotificationsRead}
            onNotificationClick={markNotificationRead}
            onToggle={() => setNotificationOpen((current) => !current)}
            open={notificationOpen}
            unreadCount={unreadNotificationCount}
          />
          <div className="erp-profile">
            <div className="avatar" />
            <span>
              {currentUser.name}
              <small>{currentUser.departmentName}</small>
            </span>
            <button aria-label="로그아웃" className="erp-logout-button" onClick={handleLogout} title="로그아웃" type="button">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <div className={`erp-content erp-content-${activePage}`}>

          <PageBody activePage={activePage} currentUser={currentUser} notifications={activeNotifications} page={page} searchQuery={searchQuery} />
        </div>
      </section>
    </main>
  );
}

function AuthGateScreen({ message }: { message: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-live="polite">
        <LogoMark small />
        <h1>{message}</h1>
        <div className="auth-progress" aria-hidden="true" />
      </section>
    </main>
  );
}

function LoginScreen({
  email,
  expiredMode,
  message,
  newPassword,
  newPasswordConfirm,
  onEmailChange,
  onExpiredPasswordSubmit,
  onNewPasswordChange,
  onNewPasswordConfirmChange,
  onPasswordChange,
  onSubmit,
  password,
  targetPage,
  submitting,
}: {
  email: string;
  expiredMode: boolean;
  message: string;
  newPassword: string;
  newPasswordConfirm: string;
  onEmailChange: (value: string) => void;
  onExpiredPasswordSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onNewPasswordChange: (value: string) => void;
  onNewPasswordConfirmChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  targetPage: string;
  submitting: boolean;
}) {
  return (
    <main className="auth-shell">
      <form className="auth-panel login-panel" onSubmit={expiredMode ? onExpiredPasswordSubmit : onSubmit}>
        <LogoMark small />
        <div>
          <span className="auth-eyebrow">{targetPage}</span>
          <h1>{expiredMode ? "비밀번호 변경" : "로그인"}</h1>
        </div>
        <label>
          이메일
          <input
            aria-label="로그인 이메일"
            autoComplete="email"
            onChange={(event) => onEmailChange(event.currentTarget.value)}
            placeholder="name@company.com"
            type="email"
            value={email}
          />
        </label>
        <label>
          {expiredMode ? "현재 비밀번호" : "비밀번호"}
          <input
            aria-label="로그인 비밀번호"
            autoComplete="current-password"
            onChange={(event) => onPasswordChange(event.currentTarget.value)}
            type="password"
            value={password}
          />
        </label>
        {expiredMode && (
          <>
            <label>
              새 비밀번호
              <input
                aria-label="새 비밀번호"
                autoComplete="new-password"
                onChange={(event) => onNewPasswordChange(event.currentTarget.value)}
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              새 비밀번호 확인
              <input
                aria-label="새 비밀번호 확인"
                autoComplete="new-password"
                onChange={(event) => onNewPasswordConfirmChange(event.currentTarget.value)}
                type="password"
                value={newPasswordConfirm}
              />
            </label>
          </>
        )}
        {message && <p className="auth-message">{message}</p>}
        <button className="auth-submit" disabled={submitting} type="submit">
          {submitting ? "확인 중" : expiredMode ? "비밀번호 변경" : "로그인"}
        </button>
        <a className="auth-return" href="#landing">
          홈으로
        </a>
      </form>
    </main>
  );
}

function getNotificationTone(type: NotificationItem["type"]) {
  if (type.includes("operational")) return "danger";
  if (type.includes("rejected") || type.includes("exceeded")) return "danger";
  if (type.includes("held") || type.includes("delayed")) return "warning";
  if (type.includes("completed")) return "success";
  if (type.includes("disbursement")) return "payment";
  return "info";
}

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isNotificationActive(notification: NotificationItem) {
  return !notification.expiresAt || new Date(notification.expiresAt).getTime() > Date.now();
}

function notificationPageFromLink(linkPath: string | undefined, currentUser: AuthUser) {
  const pageKey = (linkPath ?? "").replace(/^#/, "").trim();
  if (!pageOrder.includes(pageKey as PageKey)) return null;
  return canAccessPage(currentUser, pageKey as PageKey) ? pageKey as PageKey : null;
}

function NotificationCenter({
  notifications,
  onMarkAllRead,
  onNotificationClick,
  onToggle,
  open,
  unreadCount,
}: {
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onNotificationClick: (notification: NotificationItem) => void;
  onToggle: () => void;
  open: boolean;
  unreadCount: number;
}) {
  return (
    <div className="notification-anchor">
      <button className="icon-button" aria-expanded={open} aria-label="알림" onClick={onToggle} type="button">
        <Bell size={20} />
        {unreadCount > 0 && <i>{Math.min(unreadCount, 9)}</i>}
      </button>
      {open && (
        <section className="notification-panel" aria-label="알림 목록">
          <header>
            <div>
              <strong>알림</strong>
              <span>{unreadCount}개 미확인</span>
            </div>
            <button disabled={unreadCount === 0} onClick={onMarkAllRead} type="button">
              모두 읽음
            </button>
          </header>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <p>새 알림이 없습니다.</p>
            ) : (
              notifications.map((notification) => (
                <button
                  className={notification.readAt ? "notification-item read" : "notification-item unread"}
                  key={notification.id}
                  onClick={() => onNotificationClick(notification)}
                  type="button"
                >
                  <i className={`notification-dot ${getNotificationTone(notification.type)}`} />
                  <span>
                    <b>{notification.title}</b>
                    <small>{notification.message}</small>
                  </span>
                  <time>{formatNotificationTime(notification.createdAt)}</time>
                </button>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function PageBody({
  activePage,
  currentUser,
  notifications,
  page,
  searchQuery,
}: {
  activePage: PageKey;
  currentUser: AuthUser;
  notifications: NotificationItem[];
  page: PageDefinition;
  searchQuery: string;
}) {
  if (activePage === "dashboard") return <DashboardBody currentUser={currentUser} notifications={notifications} page={page} />;
  if (activePage === "payment-request") return <PaymentRequestBody currentUser={currentUser} page={page} searchQuery={searchQuery} />;
  if (activePage === "approval") return <ApprovalBody currentUser={currentUser} page={page} searchQuery={searchQuery} />;
  if (activePage === "disbursement") return <DisbursementBody currentUser={currentUser} page={page} searchQuery={searchQuery} />;
  if (activePage === "budget") return <BudgetBody page={page} />;
  if (activePage === "vendors") return <VendorBody page={page} />;
  if (activePage === "reports") return <ReportsBody currentUser={currentUser} page={page} />;
  if (activePage === "settings") return <SettingsBody currentUser={currentUser} page={page} />;
  return <FavoritesBody currentUser={currentUser} page={page} />;
}

function dashboardApprovalStatus(row: TableRow) {
  return row.결재상태 || row.상태 || "";
}

function dashboardDueTime(row: TableRow) {
  const due = row.처리기한 || row.요청일 || "";
  const value = due ? new Date(due).getTime() : Number.NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function buildDashboardKpis(baseKpis: KpiItem[], rows: TableRow[]): KpiItem[] {
  if (rows.length === 0) return baseKpis;
  const pendingRows = rows.filter((row) => ["승인 대기", "승인 진행 중"].includes(dashboardApprovalStatus(row)));
  const dueRows = pendingRows.filter((row) => dashboardDueTime(row) <= Date.now());
  const approvedRows = rows.filter((row) => dashboardApprovalStatus(row) === "승인 완료");
  const budgetRiskRows = rows.filter((row) => (row.예산확인 || "확인 전") !== "확인 완료");
  const approvedAmount = approvedRows.reduce((sum, row) => sum + parseWon(row.금액), 0);

  return baseKpis.map((kpi) => {
    if (kpi.label.includes("승인 대기")) {
      return { ...kpi, value: `${pendingRows.length} 건`, detail: `${formatCurrencyWon(pendingRows.reduce((sum, row) => sum + parseWon(row.금액), 0))}` };
    }
    if (kpi.label.includes("마감")) {
      return { ...kpi, value: `${dueRows.length} 건`, detail: "처리기한 도래 또는 경과" };
    }
    if (kpi.label.includes("지급")) {
      return { ...kpi, value: formatCurrencyWon(approvedAmount), detail: `${approvedRows.length}건 승인 완료 기준` };
    }
    if (kpi.label.includes("예산")) {
      return { ...kpi, value: `${budgetRiskRows.length} 건`, detail: "예산 확인 전 또는 위험" };
    }
    return kpi;
  });
}

function DashboardBody({ currentUser, notifications, page }: { currentUser: AuthUser; notifications: NotificationItem[]; page: PageDefinition }) {
  const table = useManagedTable("dashboard", "");
  const [dashboardMessage, setDashboardMessage] = useState("KPI와 상세 보기 버튼은 관련 업무 화면으로 이동합니다.");
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlertSummary | null>(null);
  const [businessFailures, setBusinessFailures] = useState<BusinessFailureAlertSummary | null>(null);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [operationalError, setOperationalError] = useState("");
  const canViewOperationalMetrics = canUseAction(currentUser, "system:manage");
  const dashboardKpis = useMemo(() => buildDashboardKpis(page.kpis, table.rows), [page.kpis, table.rows]);
  const refreshOperationalDashboard = async (showMessage = true) => {
    if (!canViewOperationalMetrics) return;
    setOperationalLoading(true);
    setOperationalError("");
    try {
      const [alertResponse, failureResponse] = await Promise.all([
        erpApi.getOperationalAlerts(),
        erpApi.getBusinessFailureAlerts(),
      ]);
      setOperationalAlerts(alertResponse.data);
      setBusinessFailures(failureResponse.data);
      if (showMessage) {
        setDashboardMessage(
          alertResponse.data.ok && failureResponse.data.ok
            ? "운영 대시보드 지표를 새로고침했습니다. 현재 임계치 초과 항목은 없습니다."
            : `운영 대시보드 지표를 새로고침했습니다. 점검 대상 ${alertResponse.data.triggered.length + failureResponse.data.triggered.length}건이 있습니다.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "운영 지표를 불러오지 못했습니다.";
      setOperationalError(message);
      if (showMessage) setDashboardMessage(`운영 지표 조회 실패: ${message}`);
    } finally {
      setOperationalLoading(false);
    }
  };

  useEffect(() => {
    void refreshOperationalDashboard(false);
  }, [canViewOperationalMetrics, currentUser.id]);

  const handleKpiClick = (label: string) => {
    const target = dashboardKpiRouteState(label);
    persistRouteState(target.pageKey, target.routeState);
    setDashboardMessage(`${label}: ${target.message}`);
    goToPage(target.pageKey);
  };

  return (
    <div className="dashboard-reference-layout">
      <section className="dashboard-main-column">
        <p className="panel-action-message dashboard-message">{dashboardMessage}</p>
        <section className="kpi-row dashboard-kpis">
          {dashboardKpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} onClick={() => handleKpiClick(kpi.label)} />
          ))}
        </section>

        {canViewOperationalMetrics && (
          <DashboardOperationalMetrics
            alerts={operationalAlerts}
            businessFailures={businessFailures}
            errorMessage={operationalError}
            loading={operationalLoading}
            onRefresh={() => void refreshOperationalDashboard()}
          />
        )}

        <section className="dashboard-chart-row">
          <DashboardTrendCard rows={table.rows} onDrilldown={(label) => setDashboardMessage(`${label} 승인 추이 세부 데이터로 이동합니다.`)} />
          <DepartmentSpendCard rows={table.rows} onDrilldown={(label) => setDashboardMessage(`${label} 지출 세부 데이터로 이동합니다.`)} />
        </section>

        <DashboardRecentPayments errorMessage={table.errorMessage} isLoading={table.isLoading} rows={table.rows} />
      </section>

      <aside className="dashboard-side-column">
        <DashboardUrgentPayments rows={table.rows} />
        <DashboardRecentActivity notifications={notifications} rows={table.rows} />
      </aside>
    </div>
  );
}

function dashboardBusinessFailureCount(summary: BusinessFailureAlertSummary | null, ruleId: string) {
  return summary?.rules.find((rule) => rule.id === ruleId)?.count ?? 0;
}

function formatDashboardLatency(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "-";
}

function DashboardOperationalMetrics({
  alerts,
  businessFailures,
  errorMessage,
  loading,
  onRefresh,
}: {
  alerts: OperationalAlertSummary | null;
  businessFailures: BusinessFailureAlertSummary | null;
  errorMessage: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const triggeredCount = (alerts?.triggered.length ?? 0) + (businessFailures?.triggered.length ?? 0);
  const metrics = [
    {
      label: "처리량",
      value: `${(businessFailures?.eventsReviewed ?? alerts?.metrics.eventsReviewed ?? 0).toLocaleString("ko-KR")}건`,
      detail: `${alerts?.windowMinutes ?? businessFailures?.windowMinutes ?? 15}분 기준`,
    },
    {
      label: "오류율",
      value: `${(alerts?.metrics.ruleFailureRatePercent ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`,
      detail: `${triggeredCount}개 임계치 초과`,
    },
    {
      label: "p95 latency",
      value: formatDashboardLatency(alerts?.metrics.p95LatencyMs),
      detail: (alerts?.metrics.latencySampleSize ?? 0) > 0 ? "slow query sample 기준" : "DB health 기준",
    },
    {
      label: "지급 실패",
      value: `${dashboardBusinessFailureCount(businessFailures, "disbursement_processing_failure")}건`,
      detail: "지급 route 보안/업무 이벤트",
    },
    {
      label: "보고서 실패",
      value: `${dashboardBusinessFailureCount(businessFailures, "report_processing_failure")}건`,
      detail: "보고서 route 보안/업무 이벤트",
    },
    {
      label: "업로드 실패",
      value: `${dashboardBusinessFailureCount(businessFailures, "file_processing_failure")}건`,
      detail: "파일 route 보안/업무 이벤트",
    },
  ];
  return (
    <section className={triggeredCount > 0 ? "erp-card dashboard-operational-card attention" : "erp-card dashboard-operational-card"}>
      <header>
        <div>
          <strong>운영 지표</strong>
          <span>{alerts ? `${alerts.since.slice(11, 16)}-${alerts.until.slice(11, 16)} · DB ${formatDashboardLatency(alerts.database.latencyMs)}` : "운영 지표 조회 대기"}</span>
        </div>
        <button disabled={loading} onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          {loading ? "조회 중" : "새로고침"}
        </button>
      </header>
      {errorMessage && <p className="dashboard-operational-error">{errorMessage}</p>}
      <div className="dashboard-operational-grid">
        {metrics.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
      {triggeredCount > 0 && (
        <div className="dashboard-operational-triggered">
          {[...(alerts?.triggered ?? []), ...(businessFailures?.triggered ?? [])].slice(0, 4).map((item) => (
            <span key={item.id}>{item.label} {item.count}/{item.threshold}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function dashboardDateKey(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dashboardDateLabel(key: string) {
  const date = new Date(`${key}T00:00:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} (${weekdays[date.getDay()]})`;
}

function dashboardNiceMax(value: number, minimum: number) {
  const safe = Math.max(value, minimum);
  if (safe <= 10) return Math.ceil(safe);
  const magnitude = 10 ** Math.max(1, Math.floor(Math.log10(safe)) - 1);
  return Math.ceil(safe / magnitude) * magnitude;
}

function dashboardCompactWon(value: number) {
  if (value >= 100_000_000) return `${(Math.round(value / 10_000_000) / 10).toLocaleString("ko-KR")}억`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}

function dashboardChartY(value: number, maxValue: number) {
  return Math.round(192 - (value / Math.max(maxValue, 1)) * 160);
}

function dashboardAxisLabels(maxValue: number, formatter: (value: number) => string) {
  return [1, 0.8, 0.6, 0.4, 0.2, 0].map((ratio) => formatter(Math.round(maxValue * ratio)));
}

function buildDashboardTrend(rows: TableRow[]) {
  const timestamps = rows
    .map((row) => new Date(row.요청일 || row.처리기한 || "").getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  const endDate = new Date(timestamps.length > 0 ? Math.max(...timestamps) : Date.now());
  endDate.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - (6 - index));
    const key = dashboardDateKey(date.toISOString());
    return { key, label: dashboardDateLabel(key), count: 0, amount: 0 };
  });
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  rows
    .filter((row) => dashboardApprovalStatus(row) === "승인 완료")
    .forEach((row) => {
      const key = dashboardDateKey(row.요청일 || row.처리기한 || "");
      const bucket = bucketMap.get(key);
      if (!bucket) return;
      bucket.count += 1;
      bucket.amount += parseWon(row.금액 ?? "0");
    });
  const maxCount = dashboardNiceMax(Math.max(...buckets.map((bucket) => bucket.count), 0), 5);
  const maxAmount = dashboardNiceMax(Math.max(...buckets.map((bucket) => bucket.amount), 0), 100_000_000);
  return { buckets, maxCount, maxAmount };
}

function DashboardTrendCard({ rows, onDrilldown }: { rows: TableRow[]; onDrilldown: (label: string) => void }) {
  const { buckets, maxCount, maxAmount } = buildDashboardTrend(rows);
  const countLine = buckets.map((bucket, index) => `${index * 72},${dashboardChartY(bucket.count, maxCount)}`).join(" ");
  const amountLine = buckets.map((bucket, index) => `${index * 72},${dashboardChartY(bucket.amount, maxAmount)}`).join(" ");

  return (
    <section className="erp-card dashboard-chart-card">
      <CardHeader title="승인 추이" action="주간" onAction={() => goToPage("approval")} />
      <div className="chart-legend">
        <span className="legend-teal">승인 건수</span>
        <span className="legend-blue">승인 금액(원)</span>
      </div>
      <div className="trend-chart" aria-label="승인 추이 그래프">
        <span className="axis-left">(건)</span>
        <span className="axis-right">(원)</span>
        <svg viewBox="0 0 520 240" role="img" aria-hidden="true">
          {[32, 72, 112, 152, 192].map((y) => (
            <line className="grid-line" x1="42" x2="488" y1={y} y2={y} key={y} />
          ))}
          <polyline className="line-teal" points={countLine} transform="translate(42 10)" />
          <polyline className="line-blue" points={amountLine} transform="translate(42 10)" />
          {buckets.map((bucket, index) => (
            <circle className="dot-teal" cx={(index * 72) + 42} cy={dashboardChartY(bucket.count, maxCount) + 10} onClick={() => onDrilldown(`승인 건수 ${bucket.label}`)} r="4" key={`count-${bucket.key}`} />
          ))}
          {buckets.map((bucket, index) => (
            <circle className="dot-blue" cx={(index * 72) + 42} cy={dashboardChartY(bucket.amount, maxAmount) + 10} onClick={() => onDrilldown(`승인 금액 ${bucket.label}`)} r="4" key={`amount-${bucket.key}`} />
          ))}
        </svg>
        <div className="trend-y left">
          {dashboardAxisLabels(maxCount, (value) => value.toLocaleString("ko-KR")).map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className="trend-y right">
          {dashboardAxisLabels(maxAmount, dashboardCompactWon).map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className="trend-x">
          {buckets.map((bucket) => (
            <span key={bucket.key}>{bucket.label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function buildDepartmentSpend(rows: TableRow[]) {
  const approvedRows = rows.filter((row) => dashboardApprovalStatus(row) === "승인 완료");
  const sourceRows = approvedRows.length > 0 ? approvedRows : rows;
  const totals = sourceRows.reduce<Record<string, number>>((acc, row) => {
    const department = row.부서 || "미지정";
    acc[department] = (acc[department] ?? 0) + parseWon(row.금액 ?? "0");
    return acc;
  }, {});
  const entries = Object.entries(totals)
    .sort(([, amountA], [, amountB]) => amountB - amountA)
    .slice(0, 7);
  const maxAmount = Math.max(...entries.map(([, amount]) => amount), 1);
  return entries.map(([name, amount]) => [name, formatCurrencyWon(amount), Math.max(6, Math.round((amount / maxAmount) * 100))] as [string, string, number]);
}

function DepartmentSpendCard({ rows, onDrilldown }: { rows: TableRow[]; onDrilldown: (label: string) => void }) {
  const departments = buildDepartmentSpend(rows);

  return (
    <section className="erp-card dashboard-chart-card">
      <CardHeader title="부서별 지출" action="이번 달" onAction={() => goToPage("budget")} />
      <div className="department-bars">
        {departments.length === 0 ? (
          <button className="department-bar-row" onClick={() => onDrilldown("부서별 지출 없음")} type="button">
            <span>데이터 없음</span>
            <i style={{ width: "6%" }} />
            <b>0 원</b>
          </button>
        ) : departments.map(([name, amount, width]) => (
          <button className="department-bar-row" key={name} onClick={() => onDrilldown(name)} type="button">
            <span>{name}</span>
            <i style={{ width: `${width}%` }} />
            <b>{amount}</b>
          </button>
        ))}
      </div>
      <div className="department-axis">
        {["0", "20%", "40%", "60%", "80%", "100%", "비중"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}

function DashboardUrgentPayments({ rows }: { rows: TableRow[] }) {
  const urgentRows = rows
    .filter((row) => ["승인 대기", "승인 진행 중"].includes(dashboardApprovalStatus(row)))
    .sort((a, b) => dashboardDueTime(a) - dashboardDueTime(b))
    .slice(0, 4);

  return (
    <section className="erp-card dashboard-side-card">
      <CardHeader title="긴급 결재" action="상세 보기" onAction={() => goToPage("approval")} />
      <div className="urgent-list">
        {urgentRows.length === 0 ? (
          <article className="urgent-item">
            <span className="urgent-badge">정상</span>
            <div>
              <b>대기 없음</b>
              <strong>처리할 긴급 결재가 없습니다.</strong>
              <small>dashboard API 기준</small>
            </div>
            <div className="urgent-amount">
              <b>0 원</b>
              <em>-</em>
            </div>
          </article>
        ) : urgentRows.map((row) => (
          <article className="urgent-item" key={row.요청번호}>
            <span className="urgent-badge">긴급</span>
            <div>
              <b>{row.요청번호}</b>
              <strong>{row.제목 || `${row.거래처} 결제 요청`}</strong>
              <small>{row.요청자} · {row.부서}</small>
            </div>
            <div className="urgent-amount">
              <b>{row.금액}</b>
              <em>{row.처리기한}</em>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function dashboardActivityIcon(source: string, tone: string) {
  if (source.includes("AuditLog")) return ClipboardCheck;
  if (tone === "danger" || tone === "warning") return AlertTriangle;
  if (tone === "payment") return WalletCards;
  if (tone === "success") return CheckCircle2;
  return Clock3;
}

function dashboardActivitiesFromRows(rows: TableRow[]) {
  const sourceRow = rows.find((row) => row.최근활동JSON);
  return readJsonRecords(sourceRow?.최근활동JSON).map((item) => {
    const tone = jsonText(item.톤) || "info";
    const source = jsonText(item.원천) || "Activity";
    const createdAt = jsonText(item.생성일시);
    return {
      title: jsonText(item.제목) || "활동",
      desc: jsonText(item.설명) || "-",
      meta: jsonText(item.메타) || source,
      time: createdAt ? formatNotificationTime(createdAt) : "-",
      tone,
      icon: dashboardActivityIcon(source, tone),
    };
  });
}

function DashboardRecentActivity({ notifications, rows }: { notifications: NotificationItem[]; rows: TableRow[] }) {
  const backendActivities = dashboardActivitiesFromRows(rows);
  const activities = backendActivities.length > 0 ? backendActivities : notifications.slice(0, 6).map((notification) => ({
    title: notification.title,
    desc: notification.message,
    meta: notification.entityId ?? notification.entityType ?? "알림",
    time: formatNotificationTime(notification.createdAt),
    tone: getNotificationTone(notification.type),
    icon: notification.type.includes("approval") ? ClipboardCheck : notification.type.includes("disbursement") ? WalletCards : notification.type.includes("operational") ? AlertTriangle : Clock3,
  }));

  return (
    <section className="erp-card dashboard-side-card dashboard-activity-card">
      <CardHeader title="최근 활동" action="상세 보기" onAction={() => goToPage("approval")} />
      <div className="activity-list">
        {activities.length === 0 ? (
          <article className="activity-item activity-tone-info">
            <span className="activity-icon">
              <Clock3 size={15} />
            </span>
            <div>
              <b>활동 없음</b>
              <strong>최근 활동이 없습니다.</strong>
              <small>AuditLog/Notification 기준</small>
            </div>
            <time>-</time>
          </article>
        ) : activities.map((item) => {
          const Icon = item.icon;
          return (
            <article className={`activity-item activity-tone-${item.tone}`} key={`${item.title}-${item.time}`}>
              <span className="activity-icon">
                <Icon size={15} />
              </span>
              <div>
                <b>{item.title}</b>
                <strong>{item.desc}</strong>
                <small>{item.meta}</small>
              </div>
              <time>{item.time}</time>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DashboardRecentPayments({ errorMessage, isLoading, rows }: { errorMessage: string; isLoading: boolean; rows: TableRow[] }) {
  const columns = ["요청번호", "요청일", "부서", "요청자", "거래처", "금액", "결재상태", "예산확인", "처리기한"];
  const recentRows = rows.slice(0, 8);

  return (
    <section className="erp-card dashboard-table-card">
      <CardHeader title="최근 결제 요청" action="상세 보기" onAction={() => goToPage("payment-request")} />
      <div className="dashboard-table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th aria-label="문서" />
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length + 1}>최근 결제 요청을 조회하는 중입니다.</td>
              </tr>
            )}
            {!isLoading && errorMessage && (
              <tr>
                <td colSpan={columns.length + 1}>{errorMessage}</td>
              </tr>
            )}
            {!isLoading && !errorMessage && recentRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1}>최근 결제 요청이 없습니다.</td>
              </tr>
            )}
            {!isLoading && !errorMessage && recentRows.map((row, index) => (
              <tr key={row.요청번호}>
                <td>
                  <span className="file-cell">
                    <FileText size={15} />
                  </span>
                </td>
                {columns.map((column) => {
                  const value = row[column] ?? "";
                  if (column === "결재상태" || column === "예산확인") {
                    return (
                      <td key={column}>
                        <StatusPill value={value} />
                      </td>
                    );
                  }
                  return (
                    <td className={column === "처리기한" && index < 2 ? "deadline-red" : undefined} key={column}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaymentRequestBody({ currentUser, page, searchQuery }: { currentUser: AuthUser; page: PageDefinition; searchQuery: string }) {
  const table = useManagedTable("payment-request", searchQuery);
  const [detailOpen, setDetailOpen] = useState(true);

  return (
    <div className="payment-request-page">
      <section className="payment-main-column">
        <PaymentRequestToolbar currentUser={currentUser} table={table} />
        <PaymentRequestTable page={page} table={table} onOpenDetail={() => setDetailOpen(true)} />
      </section>
      {detailOpen ? (
        <PaymentRequestInfoPanel currentUser={currentUser} table={table} onClose={() => setDetailOpen(false)} />
      ) : (
        <ClosedDetailPanel title="요청 정보" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function PaymentRequestToolbar({ currentUser, table }: { currentUser: AuthUser; table: TableController }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [departmentIndex, setDepartmentIndex] = useState(0);
  const periodOptions = ["2024-05-01 ~ 2024-05-31", "2024-06-01 ~ 2024-06-30", "최근 7일"];
  const departmentOptions = ["전체 부서", ...paymentDepartmentOptions.slice(0, 5)];
  const selectedStatus = table.selectedRow?.상태 ?? "임시 저장";
  const canCreateRequest = canUseAction(currentUser, "payment_request:create");
  const createDraftRequest = () => {
    const id = `PR-2024-${String(9000 + table.total + 1)}`;
    table.createRow(
      {
        요청번호: id,
        요청일: "2024-06-03",
        거래처: "",
        요청자: currentUser.name,
        부서: currentUser.departmentName,
        금액: formatCurrencyWon(0),
        상태: "임시 저장",
        "요청 사유": "",
        idempotencyKey: paymentRequestMutationKey("create", id),
      },
      `${id} 임시 저장 건이 생성되었습니다.`,
    );
  };
  const handleDownload = () => {
    downloadTableCsv("payment-requests-current-filter.csv", pages["payment-request"].tableColumns, table.rows);
    table.setActionMessage("현재 결제 요청 목록 CSV 다운로드를 시작했습니다.");
  };
  const handleApplyFilter = () => {
    table.setActionMessage(`${periodOptions[periodIndex]}, ${departmentOptions[departmentIndex]}, ${table.statusFilter} 조건을 적용했습니다.`);
    setFilterOpen(false);
  };
  const handleResetFilter = () => {
    setPeriodIndex(0);
    setDepartmentIndex(0);
    table.setStatusFilter("전체 상태");
    table.setActionMessage("결제 요청 상세 필터를 초기화했습니다.");
  };

  return (
    <div className="payment-toolbar">
      <div className="payment-filter-group">
        <button className="payment-filter date" onClick={() => setPeriodIndex((current) => (current + 1) % periodOptions.length)} type="button">
          {periodOptions[periodIndex]}
          <Calendar size={18} />
        </button>
        <button className="payment-filter" onClick={() => setDepartmentIndex((current) => (current + 1) % departmentOptions.length)} type="button">
          {departmentOptions[departmentIndex]}
          <ChevronDown size={16} />
        </button>
        <button className="payment-filter" onClick={table.cycleStatusFilter} type="button">
          {table.statusFilter}
          <ChevronDown size={16} />
        </button>
        <button className="payment-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="payment-toolbar-actions">
        <button className="payment-new-button" disabled={!canCreateRequest || table.isMutating} onClick={createDraftRequest} type="button">
          <Plus size={18} />새 요청
        </button>
        <button
          className="payment-plain-button"
          disabled={table.isMutating || !canUseAction(currentUser, "payment_request:update_own") || !canSavePaymentDraft(selectedStatus)}
          onClick={() => {
            const selectedRow = table.selectedRow;
            const rowVersion = paymentRequestRowVersion(selectedRow);
            table.updateSelectedRow(
              {
                상태: "임시 저장",
                rowVersion,
                요청RowVersion: rowVersion,
                idempotencyKey: paymentRequestMutationKey("draft", selectedRow?.요청번호 ?? "선택 요청", selectedRow),
              },
              `${selectedRow?.요청번호 ?? "선택 요청"} 임시 저장 완료`,
            );
          }}
          type="button"
        >
          임시 저장
        </button>
        <button className="payment-icon-action" aria-label="다운로드" onClick={handleDownload} type="button">
          <Download size={18} />
        </button>
        <button className="payment-icon-action" aria-label="새로고침" disabled={table.isLoading} onClick={table.refresh} type="button">
          <RefreshCw size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="결제 요청 필터"
          fields={[
            { label: "기간", value: periodOptions[periodIndex] },
            { label: "부서", value: departmentOptions[departmentIndex] },
            { label: "상태", value: table.statusFilter },
          ]}
          onApply={handleApplyFilter}
          onClose={() => setFilterOpen(false)}
          onReset={handleResetFilter}
        />
      )}
    </div>
  );
}

function PaymentRequestTable({ onOpenDetail, page, table }: { page: PageDefinition; table: TableController; onOpenDetail: () => void }) {
  return (
    <section className="erp-card payment-list-card">
      <header className="payment-list-head">
        <strong>{page.tableTitle}</strong>
        <span>전체 {table.total} 건</span>
      </header>
      <div className="payment-table-wrap">
        <table className="payment-request-table">
          <thead>
            <tr>
              <th>
                <button className="checkbox-button" onClick={table.toggleVisibleRows} type="button" aria-label="현재 페이지 전체 선택">
                  <span className={table.allVisibleSelected ? "checkbox-fake checked" : "checkbox-fake"} />
                </button>
              </th>
              {page.tableColumns.map((column) => (
                <th key={column}>
                  <SortableColumnHeader column={column} table={table} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableStateRow colSpan={page.tableColumns.length + 1} table={table} />
            {!table.isLoading && !table.errorMessage && table.rows.map((row) => (
              <tr
                aria-selected={table.isSelected(row)}
                className={table.isSelected(row) ? "selected" : undefined}
                key={row.요청번호}
                onClick={() => {
                  table.toggleRow(row);
                  onOpenDetail();
                }}
              >
                <td>
                  <span className={table.isSelected(row) ? "checkbox-fake checked" : "checkbox-fake"} />
                </td>
                {page.tableColumns.map((column) => {
                  const value = row[column] ?? "";
                  return <td key={column}>{column === "상태" ? <PaymentStatusPill value={value} /> : value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="payment-horizontal-scroll" aria-hidden="true">
          <i />
        </div>
      </div>
      <footer className="payment-pagination">
        <button aria-label="이전 페이지" onClick={table.previousPage} type="button">‹</button>
        {table.visiblePages.map((pageNumber) => (
          <button className={table.page === pageNumber ? "active" : undefined} key={pageNumber} onClick={() => table.setPage(pageNumber)} type="button">
            {pageNumber}
          </button>
        ))}
        {table.pageCount > table.visiblePages.length && (
          <>
            <span>...</span>
            <button onClick={() => table.setPage(table.pageCount)} type="button">{table.pageCount}</button>
          </>
        )}
        <button aria-label="다음 페이지" onClick={table.nextPage} type="button">›</button>
        <button className="rows-select" onClick={table.cyclePageSize} type="button">
          {table.pageSize} 건씩
          <ChevronDown size={15} />
        </button>
      </footer>
    </section>
  );
}

function PaymentStatusPill({ value }: { value: string }) {
  const className =
    value === "제출"
      ? "submit"
      : value === "승인 대기"
        ? "waiting"
        : value === "임시 저장"
          ? "draft"
          : value === "반려"
            ? "reject"
            : "complete";

  return <span className={`payment-status ${className}`}>{value}</span>;
}

function PaymentRequestInfoPanel({ currentUser, onClose, table }: { currentUser: AuthUser; onClose: () => void; table: TableController }) {
  const row = table.selectedRow;
  const status = row?.상태 ?? "임시 저장";
  const requestId = row?.요청번호 ?? "선택 요청";
  const requester = row?.요청자 ?? currentUser.name;
  const canUpdateRequest = canUseAction(currentUser, "payment_request:update_own");
  const canSubmitRequest = canUseAction(currentUser, "payment_request:submit");
  const canEditRequest = Boolean(row) && canUpdateRequest && canSavePaymentDraft(status);
  const canUploadAttachment = canEditRequest;
  const [draft, setDraft] = useState<PaymentRequestDraft>(() => ({
    vendor: row?.거래처 ?? "",
    department: row?.부서 ?? currentUser.departmentName,
    amount: normalizeAmountText(row?.금액 ?? "0"),
    requestDate: row?.요청일 ?? "2024-06-03",
    reason: row?.["요청 사유"] ?? (row?.거래처 ? `${row.거래처} 결제 요청 처리` : ""),
  }));
  const [validationMessage, setValidationMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PaymentFieldErrors>({});
  const [attachmentsByRequest, setAttachmentsByRequest] = useState<Record<string, AttachmentDraft[]>>({});
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const [autosaveMessage, setAutosaveMessage] = useState("");
  const pendingPaymentUploadFilesRef = useRef<Record<string, File>>({});
  const autosaveRowVersionRef = useRef<Record<string, string>>({});
  const lastAutosavePayloadRef = useRef<Record<string, string>>({});
  const [approvalLineMode, setApprovalLineMode] = useState("자동 결재선");
  const [paymentMasterData, setPaymentMasterData] = useState<PaymentRequestMasterData | null>(null);
  const [selectedBudgetItemId, setSelectedBudgetItemId] = useState(row?.예산항목ID ?? "");
  const [masterDataLoaded, setMasterDataLoaded] = useState(false);
  const [masterDataMessage, setMasterDataMessage] = useState("");
  const attachments = attachmentsByRequest[requestId] ?? [];
  const readyAttachmentCount = attachments.filter((attachment) => attachment.status === "ready").length;
  const amountNumber = parseWon(draft.amount);
  const formattedAmount = formatCurrencyWon(amountNumber);
  const activeVendorNames = useMemo(() => {
    if (paymentMasterData) return paymentMasterData.vendors.filter((vendor) => vendor.status === "활성").map((vendor) => vendor.name).filter(Boolean);
    return vendorRows.filter((vendor) => vendor.상태 === "활성").map((vendor) => vendor.거래처명).filter(Boolean);
  }, [paymentMasterData]);
  const vendorSelectOptions = useMemo(() => {
    const options = activeVendorNames.length > 0 ? [...activeVendorNames] : [...paymentVendorOptions];
    if (draft.vendor && !options.includes(draft.vendor)) options.unshift(draft.vendor);
    return options;
  }, [activeVendorNames, draft.vendor]);
  const knownDepartmentNames = useMemo(() => {
    if (paymentMasterData) return paymentMasterData.departments.map((department) => department.name).filter(Boolean);
    return Array.from(new Set([...budgetRows.map((budget) => budget.부서).filter(Boolean), ...paymentDepartmentOptions]));
  }, [paymentMasterData]);
  const departmentSelectOptions = useMemo(() => {
    const options = Array.from(new Set(knownDepartmentNames.length > 0 ? knownDepartmentNames : paymentDepartmentOptions));
    if (draft.department && !options.includes(draft.department)) options.unshift(draft.department);
    return options;
  }, [draft.department, knownDepartmentNames]);
  const departmentBudgetItems = useMemo(() => {
    if (paymentMasterData) return paymentMasterData.budgetItems.filter((budgetItem) => budgetItem.departmentName === draft.department);
    if (!draft.department) return [];
    return [
      {
        id: "",
        departmentName: draft.department,
        name: "운영비 > 일반 경비",
        remaining: getDepartmentBudgetRemaining(draft.department),
        status: "로컬 기본",
      },
    ];
  }, [draft.department, paymentMasterData]);
  const selectedBudgetItem = departmentBudgetItems.find((budgetItem) => budgetItem.id === selectedBudgetItemId) ?? departmentBudgetItems[0] ?? null;
  const departmentBudget = paymentMasterData?.departments.find((department) => department.name === draft.department) ?? null;
  const budgetSourceRow = budgetRows.find((budget) => budget.부서 === draft.department);
  const budgetRemaining = selectedBudgetItem?.remaining ?? departmentBudget?.budgetRemaining ?? (budgetSourceRow ? getBudgetNumber(budgetSourceRow, "잔액") : getDepartmentBudgetRemaining(draft.department));
  const budgetSourceLabel = paymentMasterData ? "backend payment master data" : budgetSourceRow ? "로컬 budget master" : "로컬 기본 예산";
  const budgetAfterRequest = budgetRemaining - amountNumber;
  const isBudgetExceeded = amountNumber > 0 && budgetAfterRequest < 0;
  const approvalCandidates = paymentMasterData?.approvalCandidates ?? [];
  const baseApprovalLine = getApprovalLine(amountNumber, currentUser, approvalCandidates);
  const approvalLine = getApprovalLineForMode(baseApprovalLine, approvalLineMode, draft.department, approvalCandidates);
  const approvalLineSummary = approvalLine.map(([name, role]) => `${role}:${name}`).join(" > ");
  const feedbackMessage = validationMessage || autosaveMessage || masterDataMessage || table.actionMessage;
  const readyAttachmentKey = attachments
    .filter((attachment) => attachment.status === "ready" && attachment.remoteId)
    .map((attachment) => attachment.remoteId)
    .join(",");
  const currentRequestRowVersion = () => autosaveRowVersionRef.current[requestId] ?? String(paymentRequestRowVersion(row));
  const autosavePayloadSignature = (paymentDraft: PaymentRequestDraft, budgetItemId: string, lineMode: string, attachmentKey: string) => JSON.stringify({
    draft: paymentDraft,
    budgetItemId,
    lineMode,
    attachmentKey,
  });

  useEffect(() => {
    const nextDraft = {
      vendor: row?.거래처 ?? "",
      department: row?.부서 ?? currentUser.departmentName,
      amount: normalizeAmountText(row?.금액 ?? "0"),
      requestDate: row?.요청일 ?? "2024-06-03",
      reason: row?.["요청 사유"] ?? (row?.거래처 ? `${row.거래처} 결제 요청 처리` : ""),
    };
    setDraft({
      ...nextDraft,
    });
    setValidationMessage("");
    setFieldErrors({});
    setAttachmentMessage("");
    setAutosaveMessage("");
    setSelectedBudgetItemId(row?.예산항목ID ?? "");
    if (row?.요청번호) {
      autosaveRowVersionRef.current[row.요청번호] = String(paymentRequestRowVersion(row));
      lastAutosavePayloadRef.current[row.요청번호] = autosavePayloadSignature(nextDraft, row?.예산항목ID ?? "", approvalLineMode, readyAttachmentKey);
    }
  }, [currentUser.departmentName, row?.거래처, row?.금액, row?.부서, row?.예산항목ID, row?.요청번호, row?.요청일, row]);

  useEffect(() => {
    if (!row || !canEditRequest || table.isMutating) return;
    const budgetItemId = selectedBudgetItem?.id ?? "";
    const signature = autosavePayloadSignature(draft, budgetItemId, approvalLineMode, readyAttachmentKey);
    if (lastAutosavePayloadRef.current[requestId] === signature) return;

    const timeoutId = window.setTimeout(async () => {
      const rowVersion = currentRequestRowVersion();
      const rowForKey = { ...(row ?? {}), rowVersion, 요청RowVersion: rowVersion };
      const patch = {
        ...buildPaymentRequestPatch(draft, "임시 저장", budgetItemId),
        ...(readyAttachmentKey ? { 첨부파일ID: readyAttachmentKey } : {}),
        결재선모드: approvalLineMode,
        예상결재선: approvalLineSummary,
        rowVersion,
        요청RowVersion: rowVersion,
        idempotencyKey: paymentRequestMutationKey("autosave", requestId, rowForKey),
      };
      try {
        const response = await erpApi.updatePageRow("payment-request", requestId, patch);
        if (response.data) {
          autosaveRowVersionRef.current[requestId] = String(paymentRequestRowVersion(response.data));
        }
        lastAutosavePayloadRef.current[requestId] = signature;
        window.localStorage.removeItem(`erp-payment-draft:${requestId}`);
        setAutosaveMessage(`${requestId} 서버 임시 저장 row에 자동 저장되었습니다.`);
      } catch (error) {
        try {
          window.localStorage.setItem(
            `erp-payment-draft:${requestId}`,
            JSON.stringify({ draft, budgetItemId, approvalLineMode, readyAttachmentKey, failedAt: new Date().toISOString() }),
          );
        } catch {
          // If browser storage is unavailable, the visible form state still remains in memory.
        }
        setAutosaveMessage(`서버 자동 저장 실패: ${error instanceof Error ? error.message : "local fallback에 임시 보관했습니다."}`);
      }
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [approvalLineMode, approvalLineSummary, canEditRequest, draft, readyAttachmentKey, requestId, row, selectedBudgetItem?.id, table.isMutating]);

  useEffect(() => {
    let active = true;
    const readPreferredVendor = (explicitVendorName?: string) => {
      if (explicitVendorName) return explicitVendorName;
      try {
        return window.localStorage.getItem("erp:last-created-vendor") ?? "";
      } catch {
        return "";
      }
    };
    const clearPreferredVendor = () => {
      try {
        window.localStorage.removeItem("erp:last-created-vendor");
      } catch {
        // Browser storage is optional for this convenience flow.
      }
    };
    const loadMasterData = async (explicitVendorName?: string) => {
      try {
        const response = await erpApi.getPaymentRequestMasterData();
        if (!active) return;
        const preferredVendorName = readPreferredVendor(explicitVendorName);
        setPaymentMasterData(response.data);
        setMasterDataLoaded(true);
        if (preferredVendorName && response.data.vendors.some((vendor) => vendor.status === "활성" && vendor.name === preferredVendorName)) {
          setDraft((current) => ({ ...current, vendor: preferredVendorName }));
          setMasterDataMessage(`${preferredVendorName} 거래처가 master data에 반영되어 선택되었습니다.`);
          clearPreferredVendor();
        } else {
          setMasterDataMessage("");
        }
      } catch (error: unknown) {
        if (!active) return;
        setMasterDataLoaded(false);
        setPaymentMasterData(null);
        setMasterDataMessage(`결제 요청 master data 조회 실패: ${error instanceof Error ? error.message : "로컬 기본값으로 표시합니다."}`);
      }
    };
    const handleVendorSaved = (event: Event) => {
      const vendorName = (event as CustomEvent<{ vendorName?: string }>).detail?.vendorName;
      void loadMasterData(vendorName);
    };

    void loadMasterData();
    window.addEventListener("erp:vendor-saved", handleVendorSaved);

    return () => {
      active = false;
      window.removeEventListener("erp:vendor-saved", handleVendorSaved);
    };
  }, []);

  useEffect(() => {
    if (!row?.요청번호) {
      setAttachmentsByRequest((current) => ({ ...current, [requestId]: [] }));
      return;
    }
    let active = true;
    erpApi
      .listFiles("PAYMENT_REQUEST", requestId)
      .then((response) => {
        if (!active) return;
        const syncedAttachments = response.data.map((file) => toStoredAttachment(file));
        const syncedIds = new Set(syncedAttachments.map((attachment) => attachment.remoteId ?? attachment.id));
        const recoveredAttachments = readUploadRecovery("PAYMENT_REQUEST", requestId).filter((attachment) => !syncedIds.has(attachment.remoteId ?? attachment.id));
        setAttachmentsByRequest((current) => ({
          ...current,
          [requestId]: [...syncedAttachments, ...recoveredAttachments],
        }));
        if (recoveredAttachments.length > 0) {
          setAttachmentMessage(`${recoveredAttachments.length}개 업로드 미완료 파일을 복구했습니다. 원본 파일을 다시 선택하거나 삭제할 수 있습니다.`);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        const recoveredAttachments = readUploadRecovery("PAYMENT_REQUEST", requestId);
        setAttachmentMessage(`첨부 파일 목록 조회 실패: ${error instanceof Error ? error.message : "다시 시도해주세요."}`);
        setAttachmentsByRequest((current) => ({ ...current, [requestId]: recoveredAttachments }));
      });

    return () => {
      active = false;
    };
  }, [requestId, row?.요청번호]);

  useEffect(() => {
    if (departmentBudgetItems.length === 0) {
      if (selectedBudgetItemId) setSelectedBudgetItemId("");
      return;
    }
    if (!departmentBudgetItems.some((budgetItem) => budgetItem.id === selectedBudgetItemId)) {
      setSelectedBudgetItemId(departmentBudgetItems[0]?.id ?? "");
    }
  }, [departmentBudgetItems, selectedBudgetItemId]);

  useEffect(() => {
    if (!table.actionMessage.startsWith("작업 실패:")) return;
    const message = table.actionMessage.replace(/^작업 실패:\s*/, "");
    const mappedErrors = paymentFieldErrorsFromMessage(message);
    if (Object.keys(mappedErrors).length > 0) {
      setFieldErrors(mappedErrors);
      setValidationMessage(message);
    }
  }, [table.actionMessage]);

  const updateDraft = (patch: Partial<PaymentRequestDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (validationMessage) setValidationMessage("");
    if (Object.keys(fieldErrors).length > 0) setFieldErrors({});
  };

  const validateDraft = (mode: "draft" | "submit") => {
    const errors: string[] = [];
    const nextFieldErrors: PaymentFieldErrors = {};
    const addError = (field: PaymentFieldErrorKey, message: string) => {
      if (!nextFieldErrors[field]) nextFieldErrors[field] = message;
      errors.push(message);
    };
    const amountText = normalizeAmountText(draft.amount);
    const amountValue = parseWon(amountText);

    if (!row) addError("row", "목록에서 결제 요청을 먼저 선택해야 합니다.");
    if (!draft.requestDate) addError("requestDate", "요청일을 입력해야 합니다.");
    if (mode === "submit" && !draft.vendor) addError("vendor", "거래처를 선택해야 합니다.");
    if (mode === "submit" && !draft.department) addError("department", "부서를 선택해야 합니다.");
    if (masterDataLoaded && draft.vendor && !activeVendorNames.includes(draft.vendor)) addError("vendor", "backend master data에 활성 거래처로 등록된 항목만 선택할 수 있습니다.");
    if (masterDataLoaded && draft.department && !knownDepartmentNames.includes(draft.department)) addError("department", "backend budget master data에 등록된 부서만 선택할 수 있습니다.");
    if (mode === "submit" && masterDataLoaded && paymentMasterData && departmentBudgetItems.length === 0) addError("budget", "backend budget master data에 선택 부서의 예산 항목이 없습니다.");
    if (mode === "submit" && masterDataLoaded && paymentMasterData && departmentBudgetItems.length > 0 && !selectedBudgetItem) addError("budget", "예산 항목을 선택해야 합니다.");
    if (mode === "submit" && amountValue <= 0) addError("amount", "금액은 1원 이상이어야 합니다.");
    if (mode === "submit" && !draft.reason.trim()) addError("reason", "요청 사유를 입력해야 합니다.");
    if (mode === "submit" && readyAttachmentCount === 0) addError("attachments", "증빙 파일이 1개 이상 필요합니다.");
    if (mode === "submit" && isBudgetExceeded) addError("budget", "요청 금액이 예산 잔액을 초과합니다.");

    return { errors, fieldErrors: nextFieldErrors };
  };

  const saveDraft = () => {
    const validation = validateDraft("draft");
    if (validation.errors.length > 0) {
      setFieldErrors(validation.fieldErrors);
      setValidationMessage(validation.errors[0]);
      return;
    }
    const rowVersion = currentRequestRowVersion();
    const rowForKey = { ...(row ?? {}), rowVersion, 요청RowVersion: rowVersion };
    const idempotencyKey = paymentRequestMutationKey("draft", requestId, rowForKey);
    lastAutosavePayloadRef.current[requestId] = autosavePayloadSignature(draft, selectedBudgetItem?.id ?? "", approvalLineMode, readyAttachmentKey);
    setAutosaveMessage("");
    table.updateSelectedRow(
      withPaymentAttachmentIds(
        {
          ...buildPaymentRequestPatch(draft, "임시 저장", selectedBudgetItem?.id ?? ""),
          결재선모드: approvalLineMode,
          예상결재선: approvalLineSummary,
          rowVersion,
          요청RowVersion: rowVersion,
          idempotencyKey,
        },
        attachments,
      ),
      `${requestId} 임시 저장 완료 · 서버 PaymentRequest DRAFT row 저장`,
    );
  };

  const submitRequest = () => {
    const validation = validateDraft("submit");
    if (validation.errors.length > 0) {
      setFieldErrors(validation.fieldErrors);
      setValidationMessage(validation.errors[0]);
      return;
    }
    const rowVersion = currentRequestRowVersion();
    const rowForKey = { ...(row ?? {}), rowVersion, 요청RowVersion: rowVersion };
    const idempotencyKey = paymentRequestMutationKey("submit", requestId, rowForKey);
    lastAutosavePayloadRef.current[requestId] = autosavePayloadSignature(draft, selectedBudgetItem?.id ?? "", approvalLineMode, readyAttachmentKey);
    setAutosaveMessage("");
    table.updateSelectedRow(
      withPaymentAttachmentIds(
        {
          ...buildPaymentRequestPatch(draft, "제출", selectedBudgetItem?.id ?? ""),
          결재선모드: approvalLineMode,
          예상결재선: approvalLineSummary,
          rowVersion,
          요청RowVersion: rowVersion,
          idempotencyKey,
        },
        attachments,
      ),
      `${requestId} 제출 완료 · 최종 확인 완료 · idempotencyKey ${idempotencyKey}`,
    );
  };

  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;

    if (!canUploadAttachment) {
      setAttachmentMessage("현재 상태에서는 증빙 파일을 변경할 수 없습니다.");
      return;
    }

    const { accepted, rejected } = prepareAttachmentDrafts(files);
    const uploadPairs = matchAcceptedFiles(files, accepted);
    const uploadingAttachments = uploadPairs.map(({ attachment, file }) => {
      pendingPaymentUploadFilesRef.current[attachment.id] = file;
      return { ...attachment, status: "uploading" as const, message: "업로드 준비 중", progressPercent: 4, retryCount: 0 };
    });
    if (uploadingAttachments.length > 0) {
      setAttachmentsByRequest((current) => ({
        ...current,
        [requestId]: [...(current[requestId] ?? []), ...uploadingAttachments],
      }));
      replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, uploadingAttachments);
    }
    if (uploadPairs.length === 0) {
      setAttachmentMessage(rejected.length > 0 ? rejected.join(" ") : "업로드할 수 있는 파일이 없습니다.");
      return;
    }

    setAttachmentMessage(`${uploadPairs.length}개 파일을 저장소로 업로드하고 있습니다.${rejected.length > 0 ? ` ${rejected.join(" ")}` : ""}`);
    const uploadedAttachments = await Promise.all(
      uploadPairs.map(async ({ attachment, file }) => {
        try {
          const stored = await uploadAttachmentToStorage("PAYMENT_REQUEST", requestId, file, attachment.id, {
            onProgress: (percent, message) => {
              setAttachmentsByRequest((current) => ({
                ...current,
                [requestId]: (current[requestId] ?? []).map((item) => (item.id === attachment.id ? { ...item, progressPercent: percent, message } : item)),
              }));
            },
          });
          delete pendingPaymentUploadFilesRef.current[attachment.id];
          return stored;
        } catch (error) {
          return {
            ...attachment,
            status: "error" as const,
            progressPercent: 0,
            retryCount: (attachment.retryCount ?? 0),
            message: `${error instanceof Error ? error.message : "업로드 실패"} · 재시도 가능`,
          };
        }
      }),
    );
    const uploadingIds = new Set(uploadingAttachments.map((attachment) => attachment.id));
    setAttachmentsByRequest((current) => {
      const existing = current[requestId] ?? [];
      return {
        ...current,
        [requestId]: [...existing.filter((attachment) => !uploadingIds.has(attachment.id)), ...uploadedAttachments],
      };
    });
    replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, uploadedAttachments, uploadingAttachments.map((attachment) => attachment.id));
    const successCount = uploadedAttachments.filter((attachment) => attachment.status === "ready").length;
    const failedCount = uploadedAttachments.length - successCount;
    setAttachmentMessage(
      [
        successCount > 0 ? `${successCount}개 파일이 업로드되었습니다. 저장소 metadata와 연결되었습니다.` : "",
        failedCount > 0 ? `${failedCount}개 파일 업로드에 실패했습니다.` : "",
        rejected.join(" "),
      ].filter(Boolean).join(" "),
    );
  };

  const retryAttachmentUpload = async (attachmentId: string) => {
    if (!canUploadAttachment) {
      setAttachmentMessage("현재 상태에서는 증빙 파일을 변경할 수 없습니다.");
      return;
    }
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    const file = pendingPaymentUploadFilesRef.current[attachmentId];
    if (!file) {
      setAttachmentMessage(`${attachment.fileName} 원본 파일이 브라우저 세션에 남아 있지 않습니다. 파일을 다시 선택해 업로드하세요.`);
      setAttachmentsByRequest((current) => ({
        ...current,
        [requestId]: (current[requestId] ?? []).map((item) => (
          item.id === attachmentId
            ? { ...item, status: "error", progressPercent: 0, message: "원본 파일 재선택 필요" }
            : item
        )),
      }));
      return;
    }
    const retryingAttachment: AttachmentDraft = {
      ...attachment,
      status: "uploading",
      progressPercent: 4,
      retryCount: (attachment.retryCount ?? 0) + 1,
      message: "재시도 준비 중",
    };
    setAttachmentsByRequest((current) => ({
      ...current,
      [requestId]: (current[requestId] ?? []).map((item) => (item.id === attachmentId ? retryingAttachment : item)),
    }));
    replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, [retryingAttachment], [attachmentId]);
    try {
      const stored = await uploadAttachmentToStorage("PAYMENT_REQUEST", requestId, file, attachmentId, {
        onProgress: (percent, message) => {
          setAttachmentsByRequest((current) => ({
            ...current,
            [requestId]: (current[requestId] ?? []).map((item) => (item.id === attachmentId ? { ...item, progressPercent: percent, message } : item)),
          }));
        },
      });
      delete pendingPaymentUploadFilesRef.current[attachmentId];
      setAttachmentsByRequest((current) => ({
        ...current,
        [requestId]: (current[requestId] ?? []).map((item) => (item.id === attachmentId ? { ...stored, retryCount: retryingAttachment.retryCount } : item)),
      }));
      replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, [stored], [attachmentId]);
      setAttachmentMessage(`${stored.fileName} 재업로드가 완료되었습니다.`);
    } catch (error) {
      const failedAttachment: AttachmentDraft = {
        ...attachment,
        status: "error",
        progressPercent: 0,
        retryCount: retryingAttachment.retryCount,
        message: `${error instanceof Error ? error.message : "업로드 실패"} · 재시도 가능`,
      };
      setAttachmentsByRequest((current) => ({
        ...current,
        [requestId]: (current[requestId] ?? []).map((item) => (item.id === attachmentId ? failedAttachment : item)),
      }));
      replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, [failedAttachment], [attachmentId]);
      setAttachmentMessage(`${attachment.fileName} 재업로드에 실패했습니다.`);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!canUploadAttachment) {
      setAttachmentMessage("현재 상태에서는 증빙 파일을 삭제할 수 없습니다.");
      return;
    }

    const attachment = attachments.find((item) => item.id === attachmentId);
    if (attachment?.remoteId) {
      try {
        await erpApi.deleteFile(attachment.remoteId, {
          idempotencyKey: fileMutationKey("delete", "PAYMENT_REQUEST", requestId, attachment.remoteId, attachment.id),
        });
      } catch (error) {
        setAttachmentMessage(error instanceof Error ? error.message : "첨부 파일 삭제에 실패했습니다.");
        return;
      }
    }
    setAttachmentsByRequest((current) => ({
      ...current,
      [requestId]: attachments.filter((attachment) => attachment.id !== attachmentId),
    }));
    delete pendingPaymentUploadFilesRef.current[attachmentId];
    replaceUploadRecoveryItems("PAYMENT_REQUEST", requestId, [], [attachmentId]);
    setAttachmentMessage("첨부 파일이 삭제되었습니다.");
  };

  const downloadAttachment = async (attachment: AttachmentDraft) => {
    if (attachment.status === "uploading") {
      setAttachmentMessage("업로드가 완료된 뒤 다운로드할 수 있습니다.");
      return;
    }
    if (attachment.remoteId) {
      try {
        const ticket = await erpApi.getFileDownload(attachment.remoteId, {
          reason: `결제 요청 ${requestId} 증빙 원본 확인`,
        });
        if (canDownloadDirectly(ticket.data.download.url)) {
          triggerUrlDownload(ticket.data.download.url, ticket.data.file.fileName);
          setAttachmentMessage(`${ticket.data.file.fileName} 원본 다운로드를 시작했습니다. 다운로드 사유가 감사 로그에 기록되었습니다.`);
          return;
        }
      } catch (error) {
        setAttachmentMessage(error instanceof Error ? error.message : "첨부 파일 다운로드에 실패했습니다.");
        return;
      }
    }
    downloadAttachmentFile(attachment.fileName, [
      `요청번호: ${requestId}`,
      `파일명: ${attachment.fileName}`,
      `크기: ${formatFileSize(attachment.byteSize)}`,
      `상태: ${attachment.status}`,
    ]);
    setAttachmentMessage(`${attachment.fileName} 다운로드를 시작했습니다.`);
  };


  const previewAttachment = async (attachment: AttachmentDraft) => {
    if (attachment.status === "uploading") {
      setAttachmentMessage("업로드가 완료된 뒤 미리보기할 수 있습니다.");
      return;
    }
    if (!canPreviewAttachment(attachment.fileName)) {
      setAttachmentMessage("PDF, JPG, PNG 파일만 미리보기를 지원합니다.");
      return;
    }
    if (!attachment.remoteId) {
      setAttachmentMessage("저장소 업로드가 완료된 파일만 미리보기할 수 있습니다.");
      return;
    }
    try {
      const ticket = await erpApi.getFileDownload(attachment.remoteId, {
        reason: `결제 요청 ${requestId} 증빙 미리보기`,
        disposition: "inline",
      });
      if (canDownloadDirectly(ticket.data.download.url)) {
        const opened = triggerUrlPreview(ticket.data.download.url);
        setAttachmentMessage(opened
          ? `${ticket.data.file.fileName} 미리보기를 열었습니다. signed URL 만료: ${ticket.data.download.expiresAt.slice(0, 16)}. 접근 로그가 감사 로그에 기록되었습니다.`
          : "브라우저가 미리보기 창을 차단했습니다. 팝업 허용 후 다시 시도하세요.");
        return;
      }
      setAttachmentMessage("remote mode signed URL을 받을 수 있을 때 미리보기를 열 수 있습니다.");
    } catch (error) {
      setAttachmentMessage(error instanceof Error ? error.message : "첨부 파일 미리보기에 실패했습니다.");
    }
  };
  const toggleApprovalLineMode = () => {
    const modes = ["자동 결재선", "수동 편집", "부서장 추가"];
    const nextMode = modes[(modes.indexOf(approvalLineMode) + 1) % modes.length];
    setApprovalLineMode(nextMode);
    setValidationMessage(`${nextMode} 모드가 예상 결재선과 저장/제출 데이터에 반영됩니다.`);
  };

  return (
    <aside className="payment-info-panel" aria-label="요청 정보">
      <header className="payment-info-head">
        <strong>{requestId}</strong>
        {row?.상태 && <PaymentStatusPill value={row.상태} />}
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>
      {feedbackMessage && <small className={validationMessage ? "panel-action-message error" : "panel-action-message"}>{feedbackMessage}</small>}

      <div className="payment-field full">
        <label>거래처 *</label>
        <div className="field-inline">
          <select
            aria-label="거래처 선택"
            aria-invalid={Boolean(fieldErrors.vendor)}
            className="field-control select-input"
            disabled={!canEditRequest}
            onChange={(event) => updateDraft({ vendor: event.currentTarget.value })}
            value={draft.vendor}
          >
            <option value="">거래처를 선택하세요</option>
            {vendorSelectOptions.map((vendorName) => (
              <option key={vendorName} value={vendorName}>{vendorName}</option>
            ))}
          </select>
          <button className="vendor-add-button" onClick={() => goToPage("vendors")} type="button">거래처 추가</button>
        </div>
        {fieldErrors.vendor && <small className="field-error-text">{fieldErrors.vendor}</small>}
      </div>

      <div className="payment-field-grid">
        <div className="payment-field">
          <label>요청일 *</label>
          <input
            aria-label="요청일 입력"
            aria-invalid={Boolean(fieldErrors.requestDate)}
            className="field-control with-icon"
            disabled={!canEditRequest}
            onChange={(event) => updateDraft({ requestDate: event.currentTarget.value })}
            type="date"
            value={draft.requestDate}
          />
          {fieldErrors.requestDate && <small className="field-error-text">{fieldErrors.requestDate}</small>}
        </div>
        <div className="payment-field">
          <label>요청자</label>
          <span className="field-control muted">{requester} ({draft.department || currentUser.departmentName})</span>
        </div>
      </div>

      <div className="payment-field full">
        <label>부서 *</label>
        <select
          aria-label="부서 선택"
          aria-invalid={Boolean(fieldErrors.department)}
          className="field-control select-input"
          disabled={!canEditRequest}
          onChange={(event) => updateDraft({ department: event.currentTarget.value })}
          value={draft.department}
        >
          {departmentSelectOptions.map((departmentName) => (
            <option key={departmentName} value={departmentName}>{departmentName}</option>
          ))}
        </select>
        {fieldErrors.department && <small className="field-error-text">{fieldErrors.department}</small>}
      </div>

      <div className="payment-field full">
        <label>예산 항목 *</label>
        <select
          aria-label="예산 항목 선택"
          aria-invalid={Boolean(fieldErrors.budget)}
          className="field-control select-input"
          disabled={!canEditRequest || departmentBudgetItems.length === 0}
          onChange={(event) => {
            setSelectedBudgetItemId(event.currentTarget.value);
            if (fieldErrors.budget) {
              setFieldErrors((current) => {
                const { budget: _removed, ...rest } = current;
                return rest;
              });
            }
          }}
          value={selectedBudgetItemId}
        >
          {departmentBudgetItems.length === 0 ? (
            <option value="">등록된 예산 항목 없음</option>
          ) : (
            departmentBudgetItems.map((budgetItem) => (
              <option key={budgetItem.id || `${budgetItem.departmentName}-${budgetItem.name}`} value={budgetItem.id}>
                {budgetItem.name} · 잔액 {formatCurrencyWon(budgetItem.remaining)}
              </option>
            ))
          )}
        </select>
        {fieldErrors.budget && <small className="field-error-text">{fieldErrors.budget}</small>}
      </div>

      <div className="payment-field full">
        <label>금액 *</label>
        <div className="field-control with-unit editable">
          <input
            aria-label="금액 입력"
            aria-invalid={Boolean(fieldErrors.amount)}
            disabled={!canEditRequest}
            inputMode="numeric"
            onChange={(event) => updateDraft({ amount: normalizeAmountText(event.currentTarget.value) })}
            placeholder="0"
            value={draft.amount}
          />
          <b>원</b>
        </div>
        {fieldErrors.amount && <small className="field-error-text">{fieldErrors.amount}</small>}
      </div>

      <div className="payment-field full">
        <label>증빙 파일 *</label>
        <label className="payment-upload-box">
          <Upload size={22} />
          <span>
            파일을 드래그하거나 클릭하여 업로드
            <small>PDF, JPG, PNG (최대 10MB)</small>
          </span>
          <input
            accept=".pdf,.jpg,.jpeg,.png,.xlsx"
            aria-label="증빙 파일 업로드"
            aria-invalid={Boolean(fieldErrors.attachments)}
            disabled={!canUploadAttachment}
            multiple
            onChange={handleAttachmentChange}
            type="file"
          />
        </label>
        {fieldErrors.attachments && <small className="field-error-text">{fieldErrors.attachments}</small>}
        {attachmentMessage && <small className="panel-action-message">{attachmentMessage}</small>}
        {attachments.map((attachment) => (
          <div className="uploaded-file-row" key={attachment.id}>
            <span className="uploaded-file-info">
              <b>{attachment.fileName}</b>
              <small>{formatFileSize(attachment.byteSize)}{attachment.message ? ` · ${attachment.message}` : ""}</small>
              {attachment.status === "uploading" && (
                <span className="upload-progress-track" aria-label={`${attachment.fileName} 업로드 진행률 ${attachment.progressPercent ?? 0}%`}>
                  <i style={{ width: `${attachment.progressPercent ?? 0}%` }} />
                </span>
              )}
            </span>
            {attachment.status === "error" && (
              <button aria-label={`${attachment.fileName} 재업로드`} disabled={!canUploadAttachment} onClick={() => retryAttachmentUpload(attachment.id)} type="button">
                <RefreshCw size={16} />
              </button>
            )}
            {attachment.status !== "error" && <i className="upload-row-spacer" aria-hidden="true" />}
            {canPreviewAttachment(attachment.fileName) ? (
              <button aria-label={`${attachment.fileName} 미리보기`} disabled={attachment.status === "uploading" || attachment.status === "error"} onClick={() => previewAttachment(attachment)} type="button">
                <Eye size={16} />
              </button>
            ) : (
              <i className="upload-row-spacer" aria-hidden="true" />
            )}
            <button aria-label={`${attachment.fileName} 다운로드`} disabled={attachment.status === "uploading"} onClick={() => downloadAttachment(attachment)} type="button">
              <Download size={16} />
            </button>
            <button aria-label={`${attachment.fileName} 삭제`} disabled={!canUploadAttachment} onClick={() => removeAttachment(attachment.id)} type="button">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="payment-field full">
        <label>요청 사유 *</label>
        <textarea
          aria-label="요청 사유 입력"
          aria-invalid={Boolean(fieldErrors.reason)}
          className="reason-box textarea-field"
          disabled={!canEditRequest}
          maxLength={500}
          onChange={(event) => updateDraft({ reason: event.currentTarget.value })}
          placeholder="결제 요청 사유를 입력하세요."
          value={draft.reason}
        />
        <small className="field-count">{draft.reason.length} / 500</small>
        {fieldErrors.reason && <small className="field-error-text">{fieldErrors.reason}</small>}
      </div>

      <section className="budget-check-card">
        <header>
          <strong>예산 확인</strong>
          <span className={isBudgetExceeded ? "warning" : undefined}>
            {isBudgetExceeded ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
            {isBudgetExceeded ? "초과" : "확인 완료"}
          </span>
          <button onClick={() => goToPage("budget")} type="button">상세 보기</button>
        </header>
        <dl>
          <dt>예산 항목</dt>
          <dd>{selectedBudgetItem ? `${draft.department || currentUser.departmentName} ${selectedBudgetItem.name}` : `${draft.department || currentUser.departmentName} 예산 항목 미등록`}</dd>
          <dt>원천 데이터</dt>
          <dd>{budgetSourceLabel}</dd>
          <dt>예산 상태</dt>
          <dd>{selectedBudgetItem?.status ?? departmentBudget?.budgetStatus ?? budgetSourceRow?.상태 ?? "로컬"}</dd>
          <dt>예산 잔액</dt>
          <dd>{formatCurrencyWon(budgetRemaining)}</dd>
          <dt>요청 금액</dt>
          <dd>{formattedAmount}</dd>
          <dt>집행 후 잔액</dt>
          <dd className={isBudgetExceeded ? "warning-text" : "teal-text"}>{formatCurrencyWon(budgetAfterRequest)}</dd>
        </dl>
      </section>

      <section className="approval-line-card">
        <header>
          <strong>결재선 (예상)</strong>
          <em>{paymentMasterData ? `${approvalLineMode} · backend 후보` : approvalLineMode}</em>
          <button onClick={toggleApprovalLineMode} type="button">변경</button>
        </header>
        <div className="approval-people">
          {approvalLine.map(([name, role], index) => (
            <div className="approval-person" key={`${name}-${role}`}>
              <i className={`person-avatar person-${index}`} />
              <b>{name}</b>
              <span>{role}</span>
              {index < approvalLine.length - 1 && <ChevronRight size={18} />}
            </div>
          ))}
        </div>
        {fieldErrors.approvalLine && <small className="field-error-text">{fieldErrors.approvalLine}</small>}
      </section>

      <footer className="payment-info-actions">
        <button disabled={table.isMutating || !canEditRequest} onClick={saveDraft} type="button">임시 저장</button>
        <button className="submit" disabled={table.isMutating || !row || !canSubmitRequest || !canSubmitPayment(status)} onClick={submitRequest} type="button">제출</button>
      </footer>
    </aside>
  );
}

function ApprovalBody({ currentUser, page, searchQuery }: { currentUser: AuthUser; page: PageDefinition; searchQuery: string }) {
  const [myRequestsOnly, setMyRequestsOnly] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const routeState = readFavoriteRouteState("approval");
  const routeFilterKey = JSON.stringify(routeState.filters);
  const approvalFilters = useMemo(
    () => ({
      ...routeState.filters,
      ...(myRequestsOnly ? { 결재선: currentUser.name } : {}),
    }),
    [currentUser.name, myRequestsOnly, routeFilterKey],
  );
  const table = useManagedTable("approval", searchQuery, approvalFilters);
  const toggleMyRequests = () => {
    setMyRequestsOnly((current) => {
      const next = !current;
      table.setActionMessage(next ? `${currentUser.roles.join(", ")} 권한 범위에서 내 결재 요청만 표시합니다.` : "내 요청 필터를 해제하고 전체 승인 요청을 표시합니다.");
      return next;
    });
  };

  return (
    <div className="approval-management-page">
      <section className="approval-main-column">
        <ApprovalToolbar
          currentUser={currentUser}
          myRequestsOnly={myRequestsOnly}
          onToggleMyRequests={toggleMyRequests}
          table={table}
        />
        <section className="kpi-row approval-kpis">
          {page.kpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} />
          ))}
        </section>
        <ApprovalRequestTable page={page} table={table} onOpenDetail={() => setDetailOpen(true)} />
      </section>
      {detailOpen ? (
        <ApprovalDetailPanel currentUser={currentUser} table={table} onClose={() => setDetailOpen(false)} />
      ) : (
        <ClosedDetailPanel title="승인 상세" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function ApprovalToolbar({
  currentUser,
  myRequestsOnly,
  onToggleMyRequests,
  table,
}: {
  currentUser: AuthUser;
  myRequestsOnly: boolean;
  onToggleMyRequests: () => void;
  table: TableController;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [departmentIndex, setDepartmentIndex] = useState(0);
  const periodOptions = ["2024-05-01 ~ 2024-05-31", "2024-06-01 ~ 2024-06-30", "오늘 마감"];
  const departmentOptions = ["전체 부서", ...paymentDepartmentOptions.slice(0, 5)];
  const canActApproval = canUseAction(currentUser, "approval:act");
  const approvableRows = table.selectedRows.filter((row) => canCurrentUserProcessApproval(row, currentUser));
  const approveSelectedRows = () => {
    const skippedCount = Math.max(0, table.selectedRows.length - approvableRows.length);
    table.updateSelectedRows(
      (row) => withApprovalMutationGuards(row, getApprovalApprovePatch(row, currentUser), "approve"),
      `${approvableRows.length}건 일괄 승인 요청 완료 · 제외 ${skippedCount}건은 권한/순서/상태 미충족 · 성공 건 감사 로그 기록`,
      (row) => canCurrentUserProcessApproval(row, currentUser),
    );
  };
  const handleDownload = () => {
    downloadTableCsv("approval-list-current-filter.csv", pages.approval.tableColumns, table.rows);
    table.setActionMessage("현재 승인 목록과 결재 이력 CSV 다운로드를 시작했습니다.");
  };
  const handleApplyFilter = () => {
    table.setActionMessage(`${periodOptions[periodIndex]}, ${departmentOptions[departmentIndex]}, ${table.statusFilter} 승인 필터를 적용했습니다.`);
    setFilterOpen(false);
  };
  const handleResetFilter = () => {
    setPeriodIndex(0);
    setDepartmentIndex(0);
    table.setStatusFilter("전체 상태");
    table.setActionMessage("승인 상세 필터를 초기화했습니다.");
  };

  return (
    <div className="approval-toolbar">
      <div className="approval-filter-group">
        <button className="approval-filter date" onClick={() => setPeriodIndex((current) => (current + 1) % periodOptions.length)} type="button">
          {periodOptions[periodIndex]}
          <Calendar size={18} />
        </button>
        <button className="approval-filter" onClick={table.cycleStatusFilter} type="button">
          {table.statusFilter}
          <ChevronDown size={16} />
        </button>
        <button className="approval-filter" onClick={() => setDepartmentIndex((current) => (current + 1) % departmentOptions.length)} type="button">
          {departmentOptions[departmentIndex]}
          <ChevronDown size={16} />
        </button>
        <button className="approval-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="approval-toolbar-actions">
        <button className={myRequestsOnly ? "approval-plain-button active" : "approval-plain-button"} onClick={onToggleMyRequests} type="button">내 요청</button>
        <button className="approval-bulk-button" disabled={table.isMutating || !canActApproval || approvableRows.length === 0} onClick={approveSelectedRows} type="button">일괄 승인</button>
        <button className="approval-icon-button" aria-label="다운로드" onClick={handleDownload} type="button">
          <Download size={18} />
        </button>
        <button className="approval-icon-button" aria-label="새로고침" disabled={table.isLoading} onClick={table.refresh} type="button">
          <RefreshCw size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="승인 목록 필터"
          fields={[
            { label: "기간", value: periodOptions[periodIndex] },
            { label: "부서", value: departmentOptions[departmentIndex] },
            { label: "상태", value: table.statusFilter },
            { label: "범위", value: myRequestsOnly ? "내 요청" : "전체 요청" },
          ]}
          onApply={handleApplyFilter}
          onClose={() => setFilterOpen(false)}
          onReset={handleResetFilter}
        />
      )}
    </div>
  );
}

function ApprovalRequestTable({ onOpenDetail, page, table }: { page: PageDefinition; table: TableController; onOpenDetail: () => void }) {
  return (
    <section className="erp-card approval-table-card">
      <div className="approval-table-scroll">
        <table className="approval-request-table">
          <thead>
            <tr>
              <th>
                <button className="checkbox-button" onClick={table.toggleVisibleRows} type="button" aria-label="현재 페이지 전체 선택">
                  <span className={table.allVisibleSelected ? "checkbox-fake checked" : "checkbox-fake"} />
                </button>
              </th>
              {page.tableColumns.map((column) => (
                <th key={column}>
                  <SortableColumnHeader column={column} table={table} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableStateRow colSpan={page.tableColumns.length + 1} table={table} />
            {!table.isLoading && !table.errorMessage && table.rows.map((row, rowIndex) => (
              <tr
                aria-selected={table.isSelected(row)}
                className={table.isSelected(row) ? "selected" : undefined}
                key={row.요청번호}
                onClick={() => {
                  table.toggleRow(row);
                  onOpenDetail();
                }}
              >
                <td>
                  <span className={table.isSelected(row) ? "checkbox-fake checked" : "checkbox-fake"} />
                </td>
                {page.tableColumns.map((column) => {
                  const value = row[column] ?? "";
                  return (
                    <td className={column === "처리기한" && rowIndex < 2 ? "deadline-red" : undefined} key={column}>
                      {isStatusColumn(column) ? <StatusPill value={value} /> : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="approval-horizontal-scroll" aria-hidden="true">
          <i />
        </div>
      </div>
      <footer className="approval-table-footer">
        <span>전체 {table.total} 건</span>
        <div>
          <button onClick={table.previousPage} type="button">‹</button>
          {table.visiblePages.map((pageNumber) => (
            <button className={table.page === pageNumber ? "active" : undefined} key={pageNumber} onClick={() => table.setPage(pageNumber)} type="button">
              {pageNumber}
            </button>
          ))}
          {table.pageCount > table.visiblePages.length && (
            <>
              <span>...</span>
              <button onClick={() => table.setPage(table.pageCount)} type="button">{table.pageCount}</button>
            </>
          )}
          <button onClick={table.nextPage} type="button">›</button>
        </div>
        <button className="rows-select" onClick={table.cyclePageSize} type="button">
          {table.pageSize} 건씩
          <ChevronDown size={15} />
        </button>
      </footer>
    </section>
  );
}

function ApprovalDetailPanel({ currentUser, onClose, table }: { currentUser: AuthUser; onClose: () => void; table: TableController }) {
  const row = table.selectedRow;
  const requestId = row?.요청번호 ?? "선택 요청";
  const status = row?.결재상태 ?? "승인 대기";
  const canProcess = canUseAction(currentUser, "approval:act") && canCurrentUserProcessApproval(row, currentUser);
  const approvalSteps = getApprovalSteps(row, currentUser);
  const approvalAttachments = getApprovalAttachments(row);
  const [actionReason, setActionReason] = useState(row?.["처리 사유"] ?? "");
  const [approvalFeedback, setApprovalFeedback] = useState("");
  const [selectedStepNote, setSelectedStepNote] = useState("");
  const feedbackMessage = approvalFeedback || table.actionMessage;

  useEffect(() => {
    setActionReason(row?.["처리 사유"] ?? "");
    setApprovalFeedback("");
    setSelectedStepNote("");
  }, [row?.요청번호, row?.["처리 사유"]]);

  const processApprovalAction = (nextStatus: "승인 완료" | "반려" | "보류") => {
    if (!row) {
      setApprovalFeedback("목록에서 승인 요청을 먼저 선택해야 합니다.");
      return;
    }
    if (!canCurrentUserProcessApproval(row, currentUser)) {
      setApprovalFeedback("현재 결재 순서가 아니거나 이미 처리된 요청입니다.");
      return;
    }
    if ((nextStatus === "반려" || nextStatus === "보류") && !actionReason.trim()) {
      setApprovalFeedback(`${nextStatus} 사유를 입력해야 합니다.`);
      return;
    }

    const reasonText = actionReason.trim();
    const processedAt = "2024-06-03 10:30";
    const approvalPatch = nextStatus === "승인 완료" ? getApprovalApprovePatch(row, currentUser) : { 결재상태: nextStatus };
    table.updateSelectedRow(
      withApprovalMutationGuards(row, {
        ...approvalPatch,
        ...(nextStatus === "반려" ? { 예산확인: "미확인" } : {}),
        "처리 사유": reasonText,
        "처리 이력": `${processedAt} ${currentUser.name} ${nextStatus}${reasonText ? ` - ${reasonText}` : ""}`,
      }, nextStatus),
      `${requestId} ${nextStatus} 처리 완료 · 서버 응답 반영 · 다음 처리 건 자동 선택 · 감사 로그 기록`,
      {
        selectNextRow: (rows, currentRow) => selectNextProcessableApprovalRow(rows, currentRow, currentUser),
      },
    );
  };
  const downloadApprovalAttachment = (attachment: ApprovalAttachmentItem) => {
    downloadAttachmentFile(attachment.fileName, [
      `요청번호: ${requestId}`,
      `출처: ${attachment.source}`,
      `파일명: ${attachment.fileName}`,
      `크기: ${attachment.sizeLabel}`,
    ]);
    setApprovalFeedback(`${attachment.fileName} 다운로드를 시작했습니다.`);
  };

  return (
    <aside className="approval-detail-panel" aria-label="상세 정보">
      <header className="approval-detail-head">
        <strong>상세 정보</strong>
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>

      <section className="approval-detail-summary">
        <header>
          <b>{requestId}</b>
          <StatusPill value={status} />
        </header>
        <dl>
          <dt>요청일</dt>
          <dd>{row?.요청일 ?? "2024-05-31"}</dd>
          <dt>부서</dt>
          <dd>{row?.부서 ?? "마케팅팀"}</dd>
          <dt>요청자</dt>
          <dd>{row?.요청자 ?? "이주연 대리"}</dd>
          <dt>거래처</dt>
          <dd>{row?.거래처 ?? "이노베이션(주)"}</dd>
          <dt>금액</dt>
          <dd>{row?.금액 ?? "2,450,000 원"}</dd>
          <dt>처리기한</dt>
          <dd className="deadline-red">{row?.처리기한 ?? "2024-06-01"}</dd>
          <dt>요청 사유</dt>
          <dd>{row?.["요청 사유"] ?? `${row?.거래처 ?? "이노베이션(주)"} 결제 승인 요청`}</dd>
          {row?.["처리 사유"] && (
            <>
              <dt>처리 사유</dt>
              <dd>{row["처리 사유"]}</dd>
            </>
          )}
        </dl>
      </section>
      {feedbackMessage && <small className={approvalFeedback ? "panel-action-message error" : "panel-action-message"}>{feedbackMessage}</small>}

      <section className="approval-attachments">
        <strong>첨부 파일 ({approvalAttachments.length})</strong>
        {approvalAttachments.map((attachment) => (
          <div className="approval-file-row" key={attachment.fileName}>
            <span className={attachment.type === "pdf" ? "file-type pdf" : attachment.type === "sheet" ? "file-type sheet" : "file-type image"}>
              <FileText size={15} />
            </span>
            <p>
              <b>{attachment.fileName}</b>
              <small>{attachment.source} · {attachment.sizeLabel}</small>
            </p>
            <button aria-label={`${attachment.fileName} 다운로드`} onClick={() => downloadApprovalAttachment(attachment)} type="button">
              <Download size={16} />
            </button>
          </div>
        ))}
      </section>

      <section className="approval-flow-card">
        <strong>결재선 현황</strong>
        <ol>
          {approvalSteps.map((step) => (
            <li className={step.state} key={`${step.step}-${step.name}`} onClick={() => setSelectedStepNote(`${step.step} · ${step.name} · ${step.note}`)}>
              <i />
              <b>{step.step}</b>
              <span>{step.name} ({step.role})</span>
              <small>{step.note}</small>
            </li>
          ))}
        </ol>
        {row?.["처리 이력"] && <small className="approval-history-note">{row["처리 이력"]}</small>}
        {selectedStepNote && <small className="approval-history-note">단계 상세: {selectedStepNote}</small>}
      </section>

      <div className="approval-reason-field">
        <label>반려/보류 사유</label>
        <textarea
          disabled={!canProcess}
          maxLength={300}
          onChange={(event) => {
            setActionReason(event.currentTarget.value);
            if (approvalFeedback) setApprovalFeedback("");
          }}
          placeholder="반려 또는 보류 처리 시 사유를 입력하세요."
          value={actionReason}
        />
        <small>{actionReason.length} / 300</small>
      </div>

      <footer className="approval-detail-actions">
        <button className="approve" disabled={table.isMutating || !canProcess} onClick={() => processApprovalAction("승인 완료")} type="button">승인</button>
        <button className="reject" disabled={table.isMutating || !canProcess} onClick={() => processApprovalAction("반려")} type="button">반려</button>
        <button disabled={table.isMutating || !canProcess} onClick={() => processApprovalAction("보류")} type="button">보류</button>
      </footer>
    </aside>
  );
}

function DisbursementBody({ currentUser, page, searchQuery }: { currentUser: AuthUser; page: PageDefinition; searchQuery: string }) {
  const routeState = readFavoriteRouteState("disbursement");
  const routeFilterKey = JSON.stringify(routeState.filters);
  const disbursementFilters = useMemo(() => ({ ...routeState.filters }), [routeFilterKey]);
  const table = useManagedTable("disbursement", searchQuery, disbursementFilters);
  const [detailOpen, setDetailOpen] = useState(true);

  return (
    <div className="disbursement-management-page">
      <section className="disbursement-main-column">
        <DisbursementToolbar currentUser={currentUser} table={table} />
        <section className="kpi-row disbursement-kpis">
          {page.kpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} />
          ))}
        </section>
        <DisbursementTabs table={table} />
        <DisbursementTable page={page} table={table} onOpenDetail={() => setDetailOpen(true)} />
      </section>
      {detailOpen ? (
        <DisbursementDetailPanel currentUser={currentUser} table={table} onClose={() => setDetailOpen(false)} />
      ) : (
        <ClosedDetailPanel title="지급 상세" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function DisbursementToolbar({ currentUser, table }: { currentUser: AuthUser; table: TableController }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [bankIndex, setBankIndex] = useState(0);
  const [departmentIndex, setDepartmentIndex] = useState(0);
  const periodOptions = ["2024-05-01 ~ 2024-05-31", "2024-06-01 ~ 2024-06-30", "오늘 지급"];
  const bankOptions = ["전체 계좌", "신한은행", "우리은행", "국민은행", "하나은행"];
  const departmentOptions = ["전체", ...paymentDepartmentOptions.slice(0, 5)];
  const canExecutePayment = canUseAction(currentUser, "disbursement:execute");
  const executableRows = table.selectedRows.filter((row) => canExecuteDisbursementByPolicy(row));
  const executeSelectedRows = () => {
    const skippedCount = Math.max(0, table.selectedRows.length - executableRows.length);
    table.updateSelectedRows(
      (row) => buildDisbursementExecutePatch(currentUser, row),
      `${executableRows.length}건 일괄 지급 완료 · 지급 대상 확인 ${table.selectedRows.length}건 · 부분 실패 ${skippedCount}건 · 재시도 목록 갱신`,
      (row) => canExecuteDisbursementByPolicy(row),
    );
  };
  const handleDownload = async () => {
    const filters: Record<string, string> = {};
    const [scheduledFrom, scheduledTo] = periodOptions[periodIndex].includes("~")
      ? periodOptions[periodIndex].split("~").map((value) => value.trim())
      : ["", ""];
    if (scheduledFrom) filters.scheduledFrom = scheduledFrom;
    if (scheduledTo) filters.scheduledTo = scheduledTo;
    if (!bankOptions[bankIndex].startsWith("전체")) filters.은행 = bankOptions[bankIndex];
    if (!departmentOptions[departmentIndex].startsWith("전체")) filters.부서 = departmentOptions[departmentIndex];
    const statusFilter = periodOptions[periodIndex] === "오늘 지급" && table.statusFilter.startsWith("전체") ? "오늘 지급" : table.statusFilter;
    if (!statusFilter.startsWith("전체")) filters.지급상태 = statusFilter;

    table.setActionMessage("DB 승인 상태와 계좌 검증 기준으로 은행 이체 파일을 생성하는 중입니다.");
    try {
      const response = await erpApi.exportDisbursementBankTransfer({ filters });
      triggerTextDownload(response.data.fileName, `\uFEFF${response.data.csv}`, response.data.contentType);
      const summary = response.data.summary;
      const statusSummary = [
        summary.scheduledCount > 0 ? `예정 ${summary.scheduledCount}건` : "",
        summary.dueTodayCount > 0 ? `오늘 ${summary.dueTodayCount}건` : "",
      ].filter(Boolean).join("/");
      table.setActionMessage(
        `은행 이체 파일 생성 완료 · 대상 ${summary.targetCount}건${statusSummary ? `(${statusSummary})` : ""} · 총액 ${formatCurrencyWon(summary.totalAmount)} · 거래처 ${summary.vendorCount}곳 · 계좌확인 ${summary.accountVerifiedCount}/${summary.targetCount}건 · 승인확인 ${summary.approvalVerifiedCount}/${summary.targetCount}건`,
      );
    } catch (error) {
      table.setActionMessage(`은행 이체 파일 생성 실패: ${error instanceof Error ? error.message : "대상 검증을 통과하지 못했습니다."}`);
    }
  };
  const handleApplyFilter = () => {
    table.setActionMessage(`${periodOptions[periodIndex]}, ${bankOptions[bankIndex]}, ${departmentOptions[departmentIndex]}, ${table.statusFilter} 지급 필터를 적용했습니다.`);
    setFilterOpen(false);
  };
  const handleResetFilter = () => {
    setPeriodIndex(0);
    setBankIndex(0);
    setDepartmentIndex(0);
    table.setStatusFilter("전체");
    table.setActionMessage("지급 상세 필터를 초기화했습니다.");
  };

  return (
    <div className="disbursement-toolbar">
      <div className="disbursement-filter-group">
        <button className="disbursement-filter date" onClick={() => setPeriodIndex((current) => (current + 1) % periodOptions.length)} type="button">
          {periodOptions[periodIndex]}
          <Calendar size={18} />
        </button>
        <button className="disbursement-select-filter" onClick={() => setBankIndex((current) => (current + 1) % bankOptions.length)} type="button">
          <span>은행 계좌</span>
          <b>{bankOptions[bankIndex]}</b>
          <ChevronDown size={16} />
        </button>
        <button className="disbursement-select-filter" onClick={table.cycleStatusFilter} type="button">
          <span>지급 상태</span>
          <b>{table.statusFilter}</b>
          <ChevronDown size={16} />
        </button>
        <button className="disbursement-select-filter" onClick={() => setDepartmentIndex((current) => (current + 1) % departmentOptions.length)} type="button">
          <span>부서</span>
          <b>{departmentOptions[departmentIndex]}</b>
          <ChevronDown size={16} />
        </button>
        <button className="disbursement-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="disbursement-toolbar-actions">
        <button className="disbursement-bulk-button" disabled={table.isMutating || !canExecutePayment || executableRows.length === 0} onClick={executeSelectedRows} type="button">일괄 지급</button>
        <button className="disbursement-icon-button" aria-label="다운로드" disabled={table.isLoading} onClick={handleDownload} type="button">
          <Download size={18} />
        </button>
        <button className="disbursement-icon-button" aria-label="새로고침" disabled={table.isLoading} onClick={table.refresh} type="button">
          <RefreshCw size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="지급 목록 필터"
          fields={[
            { label: "기간", value: periodOptions[periodIndex] },
            { label: "은행", value: bankOptions[bankIndex] },
            { label: "부서", value: departmentOptions[departmentIndex] },
            { label: "상태", value: table.statusFilter },
          ]}
          onApply={handleApplyFilter}
          onClose={() => setFilterOpen(false)}
          onReset={handleResetFilter}
        />
      )}
    </div>
  );
}

function DisbursementTabs({ table }: { table: TableController }) {
  return (
    <nav className="disbursement-tabs" aria-label="지급 상태">
      {["전체", "지급 예정", "오늘 지급", "지급 완료", "오류", "보류"].map((item) => (
        <button className={table.statusFilter === item ? "active" : undefined} key={item} onClick={() => table.setStatusFilter(item)} type="button">
          {item}
        </button>
      ))}
    </nav>
  );
}

function DisbursementTable({ onOpenDetail, page, table }: { page: PageDefinition; table: TableController; onOpenDetail: () => void }) {
  return (
    <section className="erp-card disbursement-table-card">
      <div className="disbursement-table-scroll">
        <table className="disbursement-request-table">
          <thead>
            <tr>
              <th>
                <button className="checkbox-button" onClick={table.toggleVisibleRows} type="button" aria-label="현재 페이지 전체 선택">
                  <span className={table.allVisibleSelected ? "checkbox-fake checked" : "checkbox-fake"} />
                </button>
              </th>
              {page.tableColumns.map((column) => (
                <th key={column}>
                  <SortableColumnHeader column={column} table={table} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableStateRow colSpan={page.tableColumns.length + 1} table={table} />
            {!table.isLoading && !table.errorMessage && table.rows.map((row) => (
              <tr
                aria-selected={table.isSelected(row)}
                className={table.isSelected(row) ? "selected" : undefined}
                key={row.지급번호}
                onClick={() => {
                  table.toggleRow(row);
                  onOpenDetail();
                }}
              >
                <td>
                  <span className={table.isSelected(row) ? "checkbox-fake checked" : "checkbox-fake"} />
                </td>
                {page.tableColumns.map((column) => {
                  const value = row[column] ?? "";
                  if (column === "지급상태") {
                    return (
                      <td key={column}>
                        <DisbursementStatusPill value={value} />
                      </td>
                    );
                  }
                  if (column === "계좌확인") {
                    return (
                      <td key={column}>
                        <AccountStatusPill value={value} />
                      </td>
                    );
                  }
                  return <td key={column}>{value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="disbursement-horizontal-scroll" aria-hidden="true">
          <i />
        </div>
      </div>
      <footer className="disbursement-table-footer">
        <span>전체 {table.total} 건</span>
        <div>
          <button onClick={table.previousPage} type="button">‹</button>
          {table.visiblePages.map((pageNumber) => (
            <button className={table.page === pageNumber ? "active" : undefined} key={pageNumber} onClick={() => table.setPage(pageNumber)} type="button">
              {pageNumber}
            </button>
          ))}
          {table.pageCount > table.visiblePages.length && (
            <>
              <span>...</span>
              <button onClick={() => table.setPage(table.pageCount)} type="button">{table.pageCount}</button>
            </>
          )}
          <button onClick={table.nextPage} type="button">›</button>
        </div>
        <button className="rows-select" onClick={table.cyclePageSize} type="button">
          {table.pageSize} 건씩
          <ChevronDown size={15} />
        </button>
      </footer>
    </section>
  );
}

function DisbursementStatusPill({ value }: { value: string }) {
  const className = value.includes("오류")
    ? "error"
    : value.includes("오늘")
      ? "today"
      : value.includes("완료")
        ? "complete"
        : "scheduled";
  return <span className={`disbursement-pill ${className}`}>{value}</span>;
}

function AccountStatusPill({ value }: { value: string }) {
  const className = value.includes("불일치") || value.includes("비활성") ? "error" : value.includes("대기") ? "pending" : "complete";
  return <span className={`account-pill ${className}`}>{value}</span>;
}

function DisbursementDetailPanel({ currentUser, onClose, table }: { currentUser: AuthUser; onClose: () => void; table: TableController }) {
  const days = ["26", "27", "28", "29", "30", "31", "1", "2", "3", "4", "5", "6", "7", "8"];
  const row = table.selectedRow;
  const paymentId = row?.지급번호 ?? "선택 지급";
  const paymentStatus = row?.지급상태 ?? "지급 예정";
  const accountStatus = row?.계좌확인 ?? "확인 완료";
  const vendorAccountStatus = row?.거래처계좌확인 ?? accountStatus;
  const canRetryPayment = canRetryDisbursementByPolicy(row);
  const canExecuteSelectedPayment = canExecuteDisbursementByPolicy(row);
  const isAccountFullyVerified = accountStatus === "확인 완료" && vendorAccountStatus === "확인 완료";
  const displayedAccount = maskAccountForDisplay(splitVendorBank(row?.은행 ?? "").bankAccount);
  const scheduledDate = row?.지급예정일 ?? "2024-06-03";
  const schedulePolicy = row?.지급일정정책 ?? "은행 영업일 기준";
  const nextAvailablePaymentDate = row?.다음지급가능일 ?? "-";
  const scheduleWarning = row?.지급일정경고 ?? "";
  const scheduledDay = scheduledDate.slice(-2).replace(/^0/, "");
  const [calendarMonth, setCalendarMonth] = useState(6);
  const canExecutePayment = canUseAction(currentUser, "disbursement:execute");
  const canHoldPayment = canUseAction(currentUser, "disbursement:hold");
  const linkedApproval = getLinkedApprovalRow(row);
  const retryGuide = getDisbursementRetryGuide(row);
  const [disbursementReason, setDisbursementReason] = useState(row?.["지급 보류 사유"] ?? row?.["지급 오류 메모"] ?? "");
  const [disbursementFeedback, setDisbursementFeedback] = useState("");
  const feedbackMessage = disbursementFeedback || table.actionMessage;

  useEffect(() => {
    setDisbursementReason(row?.["지급 보류 사유"] ?? row?.["지급 오류 메모"] ?? "");
    setDisbursementFeedback("");
    setCalendarMonth(Number((row?.지급예정일 ?? "2024-06-03").slice(5, 7)));
  }, [row?.지급번호, row?.["지급 보류 사유"], row?.["지급 오류 메모"]]);

  const approveExecution = () => {
    if (!row) {
      setDisbursementFeedback("목록에서 지급 건을 먼저 선택해야 합니다.");
      return;
    }
    if (!canExecuteSelectedPayment) {
      setDisbursementFeedback(row?.계좌검증사유 ?? "계좌 확인 완료 상태의 지급 예정/오늘 지급/보류 건만 2인 확인할 수 있습니다.");
      return;
    }
    const idempotencyKey = `disbursement-execution-approval-${paymentId}-${Date.now()}`;
    table.executeSelectedRowAction(
      "execution-approval",
      {
        rowVersion: Number(row.rowVersion ?? "1"),
        idempotencyKey,
        reason: disbursementReason.trim() || "지급 실행 2인 확인",
        patch: {
          지급실행확인: `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${currentUser.name}`,
        },
      },
      `${paymentId} 지급 실행 2인 확인 완료 · 실행자는 다른 담당자여야 합니다.`,
    );
  };

  const executeDisbursement = () => {
    if (!row) {
      setDisbursementFeedback("목록에서 지급 건을 먼저 선택해야 합니다.");
      return;
    }
    if (!canExecuteSelectedPayment) {
      setDisbursementFeedback(row?.계좌검증사유 ?? "계좌 확인 완료 상태의 지급 예정/오늘 지급/보류 건만 실행할 수 있습니다.");
      return;
    }
    table.updateSelectedRow(
      {
        ...buildDisbursementExecutePatch(currentUser, row),
        지급실행번호: `EXEC-${paymentId}-${Date.now()}`,
      },
      `${paymentId} 지급 실행 완료 · 최종 확인 완료 · 지급번호 생성 · 감사 로그 기록`,
    );
  };

  const holdDisbursement = () => {
    if (!row) {
      setDisbursementFeedback("목록에서 지급 건을 먼저 선택해야 합니다.");
      return;
    }
    if (!disbursementReason.trim()) {
      setDisbursementFeedback("지급 보류 사유를 입력해야 합니다.");
      return;
    }
    table.updateSelectedRow(
      buildDisbursementMutationPatch("hold", currentUser, row, {
        지급상태: "보류",
        "지급 보류 사유": disbursementReason.trim(),
        "지급 이력": `2024-06-03 11:00 ${currentUser.name} 지급 보류 - ${disbursementReason.trim()}`,
      }),
      `${paymentId} 지급 보류 완료 · 보류 알림 발송 · 감사 로그 기록`,
    );
  };

  const recheckAccount = () => {
    if (!row) return;
    table.updateSelectedRow(
      buildDisbursementMutationPatch("verify", currentUser, row, {
        계좌확인: "확인 완료",
        ...(paymentStatus === "오류" ? { 지급상태: "지급 예정" } : {}),
        "지급 오류 메모": "",
        "지급 이력": `2024-06-03 11:00 ${currentUser.name} 계좌 재확인 완료`,
      }),
      `${paymentId} 계좌 확인 완료`,
    );
  };

  const reschedulePayment = (nextDate: string) => {
    if (!row || !nextDate) return;
    table.updateSelectedRow(
      buildDisbursementMutationPatch("reschedule", currentUser, row, {
        지급예정일: nextDate,
        "지급 이력": `2024-06-03 11:00 ${currentUser.name} 지급 예정일 변경: ${nextDate}`,
      }),
      `${paymentId} 지급 일정 변경 완료`,
    );
  };

  const retryDisbursement = () => {
    if (!row || paymentStatus !== "오류") {
      setDisbursementFeedback("오류 상태의 지급 건만 재처리할 수 있습니다.");
      return;
    }
    if (!canRetryPayment) {
      setDisbursementFeedback(getDisbursementRetryGuide(row));
      return;
    }
    table.updateSelectedRow(
      buildDisbursementMutationPatch("retry", currentUser, row, {
        지급상태: "지급 예정",
        "지급 오류 메모": "",
        "지급 이력": `2024-06-03 11:00 ${currentUser.name} 오류 재처리 대기 전환`,
      }),
      `${paymentId} 오류 재처리 준비 완료`,
    );
  };

  const reconcileBankResult = async () => {
    if (!row) {
      setDisbursementFeedback("목록에서 지급 건을 먼저 선택해야 합니다.");
      return;
    }
    if (paymentStatus !== "지급 완료") {
      setDisbursementFeedback("지급 완료 건만 은행 결과와 대사할 수 있습니다.");
      return;
    }
    const idempotencyKey = `bank-result-reconcile-${paymentId}-${Date.now()}`;
    try {
      const response = await erpApi.reconcileDisbursementBankResults({
        idempotencyKey,
        rows: [{
          disbursementCode: paymentId,
          approvalCode: row.승인번호,
          amount: parseWon(row.금액 ?? ""),
          status: "SUCCESS",
          bankResultId: `BANK-${paymentId}-${Date.now()}`,
          message: disbursementReason.trim() || "은행 지급 성공 결과 대사",
        }],
      });
      table.setActionMessage(`${paymentId} 은행 결과 대사 완료 · 일치 ${response.data.matchedCount}건 · 실패 ${response.data.bankFailedCount}건`);
      table.refresh();
    } catch (error) {
      setDisbursementFeedback(`은행 결과 대사 실패: ${error instanceof Error ? error.message : "대사 조건을 통과하지 못했습니다."}`);
    }
  };

  return (
    <aside className="disbursement-detail-panel" aria-label="상세 정보">
      <header className="disbursement-detail-head">
        <strong>상세 정보</strong>
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>

      <section className="disbursement-detail-summary">
        <header>
          <b>{paymentId}</b>
          <DisbursementStatusPill value={paymentStatus} />
        </header>
        <strong>기본 정보</strong>
        <dl>
          <dt>거래처</dt>
          <dd>{row?.거래처 ?? "이노베이션(주)"}</dd>
          <dt>지급예정일</dt>
          <dd>{row?.지급예정일 ?? "2024-06-03"}</dd>
          <dt>승인번호</dt>
          <dd>{row?.승인번호 ?? "PR-2024-0058"}</dd>
          <dt>금액</dt>
          <dd>{row?.금액 ?? "2,450,000 원"}</dd>
          <dt>담당자</dt>
          <dd>{row?.담당자 ?? "김민수 과장"}</dd>
          <dt>요청일</dt>
          <dd>{linkedApproval?.요청일 ?? (row?.승인번호 ? "2024-05-31" : "-")}</dd>
          {row?.["지급 이력"] && (
            <>
              <dt>지급 이력</dt>
              <dd>{row["지급 이력"]}</dd>
            </>
          )}
          {row?.지급실행확인 && (
            <>
              <dt>지급 실행 확인</dt>
              <dd>{row.지급실행확인}</dd>
            </>
          )}
        </dl>
      </section>
      {feedbackMessage && <small className={disbursementFeedback ? "panel-action-message error" : "panel-action-message"}>{feedbackMessage}</small>}

      <section className="disbursement-account-card">
        <header>
          <strong>계좌 정보</strong>
          <AccountStatusPill value={accountStatus} />
          <button disabled={table.isMutating || isAccountFullyVerified || paymentStatus === "지급 완료"} onClick={recheckAccount} type="button">계좌 재확인</button>
        </header>
        <dl>
          <dt>은행</dt>
          <dd>{row?.은행 ?? "가나다은행"}</dd>
          <dt>계좌번호</dt>
          <dd>{displayedAccount}</dd>
          <dt>예금주</dt>
          <dd>{row?.거래처 ?? "이노베이션(주)"}</dd>
          <dt>계좌 일치 여부</dt>
          <dd className="match">{row?.계좌확인?.includes("불일치") ? "불일치" : "일치"}</dd>
          <dt>거래처 계좌</dt>
          <dd>{vendorAccountStatus}</dd>
          <dt>검증 코드</dt>
          <dd>{row?.계좌검증코드 ?? "-"}</dd>
          <dt>검증 사유</dt>
          <dd>{row?.계좌검증사유 ?? "-"}</dd>
          <dt>검증 adapter</dt>
          <dd>{row?.계좌검증Adapter ?? "-"}</dd>
        </dl>
      </section>

      <section className="disbursement-linked-card">
        <strong>연결 승인 건</strong>
        <dl>
          <dt>승인번호</dt>
          <dd>{row?.승인번호 ?? "-"}</dd>
          <dt>결재상태</dt>
          <dd>{linkedApproval?.결재상태 ?? "승인 완료"}</dd>
          <dt>요청부서</dt>
          <dd>{linkedApproval?.부서 ?? "-"}</dd>
          <dt>요청자</dt>
          <dd>{linkedApproval?.요청자 ?? "-"}</dd>
        </dl>
      </section>

      <section className="disbursement-calendar-card">
        <strong>지급 일정</strong>
        <div className="mini-calendar-head">
          <button onClick={() => {
            setCalendarMonth((current) => Math.max(1, current - 1));
            setDisbursementFeedback("이전 업무월 지급 일정을 표시했습니다.");
          }} type="button">‹</button>
          <b>2024년 {calendarMonth}월</b>
          <button onClick={() => {
            setCalendarMonth((current) => Math.min(12, current + 1));
            setDisbursementFeedback("다음 업무월 지급 일정을 표시했습니다.");
          }} type="button">›</button>
        </div>
        <div className="mini-calendar-week">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="mini-calendar-grid">
          {days.map((day) => (
            <span className={day === scheduledDay ? "selected" : undefined} key={day}>
              {day}
            </span>
          ))}
        </div>
        <dl>
          <dt>정책</dt>
          <dd>{schedulePolicy}</dd>
          <dt>다음 가능일</dt>
          <dd>{nextAvailablePaymentDate}</dd>
          <dt>업무일 판정</dt>
          <dd>{row?.지급예정일업무일 ?? "확인 전"}</dd>
          <dt>예정일</dt>
          <dd>
            <input
              aria-label="지급 예정일 변경"
              disabled={paymentStatus === "지급 완료"}
              onChange={(event) => reschedulePayment(event.currentTarget.value)}
              type="date"
              value={scheduledDate}
            />
          </dd>
          <dt>지급 메모</dt>
          <dd>{scheduleWarning || row?.["지급 보류 사유"] || (paymentStatus === "보류" ? "지급 보류 처리됨" : "-")}</dd>
        </dl>
      </section>

      {paymentStatus === "오류" && (
        <section className="disbursement-error-card">
          <strong>지급 오류 처리</strong>
          <p>{retryGuide}</p>
        </section>
      )}

      <div className="disbursement-reason-field">
        <label>지급 보류/오류 메모</label>
        <textarea
          maxLength={300}
          onChange={(event) => {
            setDisbursementReason(event.currentTarget.value);
            if (disbursementFeedback) setDisbursementFeedback("");
          }}
          placeholder="보류 또는 오류 재처리 사유를 입력하세요."
          value={disbursementReason}
        />
        <small>{disbursementReason.length} / 300</small>
      </div>

      <footer className="disbursement-detail-actions">
        <button disabled={table.isMutating || !canExecutePayment || !canExecuteSelectedPayment} onClick={approveExecution} type="button">2인 확인</button>
        <button className="execute" disabled={table.isMutating || !canExecutePayment || !canExecuteSelectedPayment} onClick={executeDisbursement} type="button">지급 실행</button>
        <button disabled={table.isMutating || !canHoldPayment || !canHoldDisbursement(paymentStatus)} onClick={holdDisbursement} type="button">보류</button>
        <button disabled={table.isMutating || paymentStatus !== "오류" || !canRetryPayment} onClick={retryDisbursement} type="button">재처리</button>
        <button disabled={table.isMutating || !canExecutePayment || paymentStatus !== "지급 완료"} onClick={reconcileBankResult} type="button">결과 대사</button>
        <button onClick={onClose} type="button">닫기</button>
      </footer>
    </aside>
  );
}

function BudgetBody({ page }: { page: PageDefinition }) {
  const periodOptions = ["2026-01-01 ~ 2026-12-31", "2026-01-01 ~ 2026-06-30", "2026-07-01 ~ 2026-12-31"];
  const categoryOptions = ["전체 예산 항목", "인건비", "광고/마케팅비", "SW/IT 비용", "외주/용역비", "사무/운영비"];
  const statusOptions = ["전체 상태", "정상", "주의", "초과"];
  const favoriteState = readFavoriteRouteState("budget");
  const favoritePeriod = favoriteState.filters.기간 ?? favoriteState.filters.회계연도 ?? "";
  const favoritePeriodIndex = favoritePeriod ? periodOptions.findIndex((period) => period.includes(favoritePeriod)) : -1;
  const [periodIndex, setPeriodIndex] = useState(favoritePeriodIndex >= 0 ? favoritePeriodIndex : 0);
  const [departmentFilter, setDepartmentFilter] = useState(favoriteState.filters.부서 ?? "전체 부서");
  const [categoryFilter, setCategoryFilter] = useState(favoriteState.filters.예산항목 ?? "전체 예산 항목");
  const [statusFilter, setStatusFilter] = useState(favoriteState.statusFilter && statusOptions.includes(favoriteState.statusFilter) ? favoriteState.statusFilter : "전체 상태");
  const [selectedDepartment, setSelectedDepartment] = useState(favoriteState.filters.부서 && favoriteState.filters.부서 !== "전체 부서" ? favoriteState.filters.부서 : "마케팅팀");
  const [adjustmentHistory, setAdjustmentHistory] = useState<TableRow[]>([]);
  const [budgetMessage, setBudgetMessage] = useState("");
  const [adjustFormOpen, setAdjustFormOpen] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("50000000");
  const [adjustReason, setAdjustReason] = useState("연간 운영비 증액");
  const [detailOpen, setDetailOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const periodLabel = periodOptions[periodIndex];
  const fiscalYearFilter = periodLabel.match(/\d{4}/)?.[0] ?? "";
  const budgetQueryFilters = useMemo(
    () => ({
      ...(fiscalYearFilter ? { 회계연도: fiscalYearFilter } : {}),
      ...(departmentFilter !== "전체 부서" ? { 부서: departmentFilter } : {}),
      ...(categoryFilter !== "전체 예산 항목" ? { 예산항목: categoryFilter } : {}),
      ...(statusFilter !== "전체 상태" ? { 상태: statusFilter } : {}),
    }),
    [categoryFilter, departmentFilter, fiscalYearFilter, statusFilter],
  );
  const table = useManagedTable("budget", "", budgetQueryFilters);
  const budgetSourceRows = table.rows;
  const optionSourceRows = useMemo(() => [...page.tableRows, ...budgetSourceRows], [budgetSourceRows, page.tableRows]);
  const departmentOptions = ["전체 부서", ...Array.from(new Set(optionSourceRows.map((row) => row.부서).filter(Boolean)))];
  const filteredRows = budgetSourceRows;
  const selectedRow = budgetSourceRows.find((row) => row.부서 === selectedDepartment) ?? budgetSourceRows[0];

  useEffect(() => {
    let ignore = false;
    if (!selectedDepartment) {
      setAdjustmentHistory([]);
      return () => {
        ignore = true;
      };
    }
    erpApi
      .listBudgetAdjustments(selectedDepartment)
      .then((response) => {
        if (!ignore) setAdjustmentHistory(response.data);
      })
      .catch((error: unknown) => {
        if (!ignore) setBudgetMessage(error instanceof Error ? error.message : "예산 조정 이력을 불러오지 못했습니다.");
      });
    return () => {
      ignore = true;
    };
  }, [selectedDepartment]);

  const adjustSelectedBudget = async () => {
    if (!selectedRow) return;
    const amount = parseWon(adjustAmount);
    if (amount <= 0) {
      setBudgetMessage("조정 금액은 1원 이상 입력해야 합니다.");
      return;
    }
    if (!adjustReason.trim()) {
      setBudgetMessage("예산 조정 사유를 입력해야 합니다.");
      return;
    }
    const rowVersion = Number(selectedRow.예산RowVersion ?? "");
    setIsAdjusting(true);
    try {
      const response = await erpApi.createBudgetAdjustment(selectedRow.부서, {
        amount,
        reason: adjustReason.trim(),
        ...(Number.isInteger(rowVersion) && rowVersion > 0 ? { rowVersion } : {}),
        idempotencyKey: `budget-adjust-${selectedRow.부서}-${Date.now()}`,
      });
      setAdjustmentHistory((current) => [response.data.adjustment, ...current.filter((row) => row.조정ID !== response.data.adjustment.조정ID)].slice(0, 50));
      table.refresh();
      setBudgetMessage(`${selectedRow.부서} 예산 ${formatCurrencyWon(amount)} 조정 ${response.data.requiresApproval ? "요청을 저장했습니다. 승인 대기 상태입니다." : "을 DB에 즉시 반영했습니다."}`);
      setAdjustFormOpen(false);
    } catch (error) {
      setBudgetMessage(error instanceof Error ? error.message : "예산 조정을 처리하지 못했습니다.");
    } finally {
      setIsAdjusting(false);
    }
  };
  const updateBudgetAdjustmentStatus = async (adjustment: TableRow, action: "cancel" | "reject") => {
    const adjustmentId = adjustment.조정ID;
    if (!adjustmentId) {
      setBudgetMessage("예산 조정 ID를 확인할 수 없습니다.");
      return;
    }
    if (adjustment[action === "cancel" ? "취소가능" : "반려가능"] !== "가능") {
      setBudgetMessage(adjustment.원장반영방식 || "이미 종료되었거나 원장에 반영된 조정 요청입니다.");
      return;
    }
    const actionLabel = action === "cancel" ? "취소" : "반려";
    setIsAdjusting(true);
    try {
      const response = await erpApi.updateBudgetAdjustment(adjustment.부서 || selectedDepartment, adjustmentId, action, {
        reason: `예산 조정 ${actionLabel}`,
        idempotencyKey: `budget-adjustment-${action}-${adjustmentId}-${Date.now()}`,
      });
      setAdjustmentHistory((current) => [response.data.adjustment, ...current.filter((row) => row.조정ID !== adjustmentId)].slice(0, 50));
      table.refresh();
      setBudgetMessage(`${adjustment.부서 || selectedDepartment} 예산 조정 ${actionLabel} 완료 · ${response.data.rollbackPolicy}`);
    } catch (error) {
      setBudgetMessage(error instanceof Error ? error.message : `예산 조정 ${actionLabel}을 처리하지 못했습니다.`);
    } finally {
      setIsAdjusting(false);
    }
  };
  const resetBudgetFilters = () => {
    setPeriodIndex(0);
    setDepartmentFilter(departmentOptions[0]);
    setCategoryFilter(categoryOptions[0]);
    setStatusFilter(statusOptions[0]);
    setBudgetMessage("예산 상세 필터를 초기화했습니다.");
  };

  return (
    <div className="budget-management-page management-page">
      <section className="management-main-column">
        <BudgetToolbar
          categoryFilter={categoryFilter}
          categoryOptions={categoryOptions}
          departmentFilter={departmentFilter}
          departmentOptions={departmentOptions}
          onAdjust={() => setAdjustFormOpen((current) => !current)}
          onCycleCategory={() => setCategoryFilter((current) => categoryOptions[(categoryOptions.indexOf(current) + 1) % categoryOptions.length])}
          onCycleDepartment={() => {
            const next = departmentOptions[(departmentOptions.indexOf(departmentFilter) + 1) % departmentOptions.length];
            setDepartmentFilter(next);
            if (next !== "전체 부서") setSelectedDepartment(next);
          }}
          onCyclePeriod={() => setPeriodIndex((current) => (current + 1) % periodOptions.length)}
          onCycleStatus={() => setStatusFilter((current) => statusOptions[(statusOptions.indexOf(current) + 1) % statusOptions.length])}
          onDownload={() => {
            downloadTableCsv("budget-current-filter.csv", pages.budget.tableColumns, filteredRows);
            setBudgetMessage("현재 예산 현황 CSV 다운로드를 시작했습니다.");
          }}
          onFilterMessage={setBudgetMessage}
          onResetFilters={resetBudgetFilters}
          onToggleView={() => {
            setViewMode((current) => (current === "table" ? "card" : "table"));
            setBudgetMessage(`예산 목록 보기를 ${viewMode === "table" ? "카드" : "표"} 보기로 전환했습니다.`);
          }}
          periodLabel={periodLabel}
          rows={filteredRows}
          statusFilter={statusFilter}
          viewMode={viewMode}
        />
        {adjustFormOpen && (
          <section className="budget-adjust-panel" aria-label="예산 조정 입력">
            <label>
              조정 금액
              <input aria-label="예산 조정 금액 입력" inputMode="numeric" onChange={(event) => setAdjustAmount(normalizeAmountText(event.currentTarget.value))} value={adjustAmount} />
            </label>
            <label>
              조정 사유
              <input aria-label="예산 조정 사유 입력" onChange={(event) => setAdjustReason(event.currentTarget.value)} value={adjustReason} />
            </label>
            <span>{parseWon(adjustAmount) >= 10_000_000 ? "승인 필요" : "즉시 반영"}</span>
            <button disabled={isAdjusting} onClick={adjustSelectedBudget} type="button">{isAdjusting ? "처리 중" : "조정 적용"}</button>
            <button disabled={isAdjusting} onClick={() => setAdjustFormOpen(false)} type="button">취소</button>
          </section>
        )}
        {budgetMessage && <small className="panel-action-message budget-message">{budgetMessage}</small>}
        <section className="kpi-row management-kpis budget-kpis">
          {page.kpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} />
          ))}
        </section>
        <div className="budget-middle-grid">
          <BudgetUsageTable
            rows={filteredRows}
            selectedDepartment={selectedDepartment}
            viewMode={viewMode}
            onSelectDepartment={(department) => {
              setSelectedDepartment(department);
              setDetailOpen(true);
            }}
          />
          <BudgetCategoryChart categoryFilter={categoryFilter} rows={filteredRows} />
        </div>
        <BudgetWarningItems rows={filteredRows} />
      </section>
      {detailOpen ? (
        <BudgetDetailPanel
          adjustmentHistory={adjustmentHistory}
          isAdjusting={isAdjusting}
          onClose={() => setDetailOpen(false)}
          onUpdateAdjustment={updateBudgetAdjustmentStatus}
          periodLabel={periodLabel}
          row={selectedRow}
        />
      ) : (
        <ClosedDetailPanel title="예산 상세" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function BudgetToolbar({
  categoryFilter,
  departmentFilter,
  onAdjust,
  onCycleCategory,
  onCycleDepartment,
  onCyclePeriod,
  onCycleStatus,
  onDownload,
  onFilterMessage,
  onResetFilters,
  onToggleView,
  periodLabel,
  rows,
  statusFilter,
  viewMode,
}: {
  categoryFilter: string;
  categoryOptions: string[];
  departmentFilter: string;
  departmentOptions: string[];
  onAdjust: () => void;
  onCycleCategory: () => void;
  onCycleDepartment: () => void;
  onCyclePeriod: () => void;
  onCycleStatus: () => void;
  onDownload: () => void;
  onFilterMessage: (message: string) => void;
  onResetFilters: () => void;
  onToggleView: () => void;
  periodLabel: string;
  rows: TableRow[];
  statusFilter: string;
  viewMode: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const applyFilters = () => {
    onFilterMessage(`${periodLabel}, ${departmentFilter}, ${categoryFilter}, ${statusFilter} 예산 필터를 적용했습니다.`);
    setFilterOpen(false);
  };
  return (
    <div className="management-toolbar budget-toolbar">
      <div className="management-filter-group budget-filter-group">
        <button className="management-filter date" onClick={onCyclePeriod} type="button">
          {periodLabel}
          <Calendar size={18} />
        </button>
        <button className="management-filter" onClick={onCycleDepartment} type="button">
          {departmentFilter}
          <ChevronDown size={16} />
        </button>
        <button className="management-filter" onClick={onCycleCategory} type="button">
          {categoryFilter}
          <ChevronDown size={16} />
        </button>
        <button className="management-filter" onClick={onCycleStatus} type="button">
          {statusFilter}
          <ChevronDown size={16} />
        </button>
        <button className="management-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="management-toolbar-actions">
        <button className="management-primary-button" onClick={onAdjust} type="button">예산 조정</button>
        <button className="management-icon-button" aria-label="다운로드" onClick={onDownload} type="button">
          <Download size={18} />
        </button>
        <button className="management-icon-button" aria-label="목록 보기" onClick={onToggleView} type="button">
          <SlidersHorizontal size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="예산 상세 필터"
          fields={[
            { label: "기간", value: periodLabel },
            { label: "부서", value: departmentFilter },
            { label: "항목", value: categoryFilter },
            { label: "상태", value: statusFilter },
            { label: "표시", value: `${rows.length}개 · ${viewMode}` },
          ]}
          onApply={applyFilters}
          onClose={() => setFilterOpen(false)}
          onReset={onResetFilters}
        />
      )}
    </div>
  );
}

function BudgetUsageTable({
  onSelectDepartment,
  rows,
  selectedDepartment,
  viewMode,
}: {
  onSelectDepartment: (department: string) => void;
  rows: TableRow[];
  selectedDepartment: string;
  viewMode: "table" | "card";
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);
  return (
    <section className="erp-card budget-usage-card">
      <CardHeader title="부서별 예산 사용 현황" />
      {viewMode === "card" && (
        <div className="budget-card-view">
          {pageRows.map((row) => (
            <button className={row.부서 === selectedDepartment ? "selected" : undefined} key={row.부서} onClick={() => onSelectDepartment(row.부서)} type="button">
              <b>{row.부서}</b>
              <span>{row.사용률}</span>
              <small>{formatCurrencyWon(getBudgetNumber(row, "잔액"))}</small>
              <BudgetStatusPill value={row.상태} />
            </button>
          ))}
        </div>
      )}
      {viewMode === "table" && (
      <table className="budget-table">
        <thead>
          <tr>
            {["부서", "배정 예산", "사용 금액", "사용률", "잔액", "상태"].map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const usage = getBudgetUsageRate(row);
            return (
              <tr className={row.부서 === selectedDepartment ? "selected" : undefined} key={row.부서} onClick={() => onSelectDepartment(row.부서)}>
                <td>{row.부서}</td>
                <td>{formatCurrencyWon(getBudgetNumber(row, "배정 예산"))}</td>
                <td>{formatCurrencyWon(getBudgetNumber(row, "사용 금액"))}</td>
                <td>
                  <span className="budget-usage-cell">
                    {usage}%
                    <i className={usage >= 95 ? "danger" : usage >= 75 ? "warning" : "normal"} style={{ width: row.사용률 }} />
                  </span>
                </td>
                <td>{formatCurrencyWon(getBudgetNumber(row, "잔액"))}</td>
                <td>
                  <BudgetStatusPill value={row.상태} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
      <footer className="mini-table-footer">
        <span>전체 {rows.length}개 부서</span>
        <div>
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">‹</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button className={pageNumber === page ? "active" : undefined} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>
          ))}
          <button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">›</button>
        </div>
        <button className="rows-select" onClick={() => setPageSize((current) => (current === 10 ? 5 : 10))} type="button">{pageSize} 개씩</button>
      </footer>
    </section>
  );
}

function BudgetStatusPill({ value }: { value: string }) {
  const className = value.includes("초과") ? "error" : value.includes("주의") ? "warning" : "complete";
  return <span className={`budget-status-pill ${className}`}>{value}</span>;
}

function BudgetCategoryChart({ categoryFilter, rows }: { categoryFilter: string; rows: TableRow[] }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const totalUsed = rows.reduce((sum, row) => sum + getBudgetNumber(row, "사용 금액"), 0);
  const categoryRatios = [
    ["인건비", 0.36],
    ["광고/마케팅비", 0.22],
    ["SW/IT 비용", 0.18],
    ["외주/용역비", 0.13],
    ["사무/운영비", 0.08],
    ["기타", 0.03],
  ] as Array<[string, number]>;
  const items = categoryRatios
    .filter(([name]) => categoryFilter === "전체 예산 항목" || name === categoryFilter)
    .map(([name, ratio]) => {
      const used = Math.round(totalUsed * ratio);
      const width = Math.min(100, Math.max(8, Math.round(ratio * 240)));
      return [name, formatCurrencyWon(used), `${width}%`, width] as [string, string, string, number];
    });

  return (
    <section className="erp-card budget-category-card">
      <CardHeader title="예산 항목별 사용 현황 (전체)" />
      <div className="category-legend">
        <span>사용 금액</span>
        <span>잔여 예산</span>
      </div>
      <div className="budget-category-bars">
        {items.map(([name, amount, percent, width]) => (
          <div className="budget-category-row" key={name}>
            <span>{name}</span>
            <i>
              <b style={{ width: `${width}%` }} />
            </i>
            <strong>{amount}</strong>
            <em>{percent}</em>
          </div>
        ))}
      </div>
      <div className="budget-axis">
        {["0", "2.5B", "5B", "7.5B", "10B", "(원)"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {detailOpen && (
        <div className="budget-category-detail">
          {items.map(([name, amount, percent]) => (
            <span key={name}><b>{name}</b>{amount}<small>{percent}</small></span>
          ))}
        </div>
      )}
      <button className="wide-card-link" onClick={() => setDetailOpen((current) => !current)} type="button">
        예산 항목별 상세 보기
        <ChevronRight size={16} />
      </button>
    </section>
  );
}

function BudgetWarningItems({ rows }: { rows: TableRow[] }) {
  const [activeDepartment, setActiveDepartment] = useState("");
  const warningRows = rows.filter((row) => row.상태 !== "정상").slice(0, 4);
  return (
    <section className="erp-card budget-warning-card">
      <strong>예산 초과/주의 항목</strong>
      <div>
        {warningRows.map((row) => {
          const usage = getBudgetUsageRate(row);
          const tone = row.상태 === "초과" ? "danger" : "warning";
          return (
          <article className={activeDepartment === row.부서 ? "selected" : undefined} key={row.부서} onClick={() => setActiveDepartment(row.부서)}>
            <i className={tone} />
            <p>
              <b>{row.부서} - 예산 사용률</b>
              <span>사용률 {usage}% ({row.상태})</span>
              <strong>{row.상태 === "초과" ? `초과 금액 ${formatCurrencyWon(Math.abs(getBudgetNumber(row, "잔액")))}` : `잔여 예산 ${formatCurrencyWon(getBudgetNumber(row, "잔액"))}`}</strong>
            </p>
            <ChevronRight size={18} />
          </article>
          );
        })}
      </div>
    </section>
  );
}

function BudgetDetailPanel({
  adjustmentHistory,
  isAdjusting,
  onClose,
  onUpdateAdjustment,
  periodLabel,
  row,
}: {
  adjustmentHistory: TableRow[];
  isAdjusting: boolean;
  onClose: () => void;
  onUpdateAdjustment: (adjustment: TableRow, action: "cancel" | "reject") => void;
  periodLabel: string;
  row?: TableRow;
}) {
  const isEmpty = !row;
  const selected = row ?? emptyBudgetDetailRow;
  const relatedRequests = isEmpty ? [] : getBudgetRelatedRequests(selected.부서);
  const usageRate = getBudgetUsageRate(selected);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const visibleRequests = showAllRequests ? relatedRequests : relatedRequests.slice(0, 3);
  const historyItems = adjustmentHistory.length > 0 ? adjustmentHistory : [];
  const visibleHistory = showAllHistory ? historyItems : historyItems.slice(0, 4);
  return (
    <aside className="management-detail-panel budget-detail-panel" aria-label="선택 부서 상세">
      <header className="management-detail-head">
        <strong>선택 부서 상세</strong>
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>
      <section className="panel-card budget-selected-card">
        <header>
          <b>{selected.부서}</b>
          <BudgetStatusPill value={selected.상태} />
        </header>
        <dl>
          <dt>배정 예산</dt>
          <dd>{formatCurrencyWon(getBudgetNumber(selected, "배정 예산"))}</dd>
          <dt>사용 금액</dt>
          <dd>{formatCurrencyWon(getBudgetNumber(selected, "사용 금액"))}</dd>
          <dt>잔여 예산</dt>
          <dd className={selected.상태 === "정상" ? undefined : "warning"}>{formatCurrencyWon(getBudgetNumber(selected, "잔액"))}</dd>
          <dt>사용률</dt>
          <dd>{usageRate}%</dd>
          <dt>회계 기간</dt>
          <dd>{periodLabel}</dd>
          <dt>예산 담당자</dt>
          <dd>{isEmpty ? "-" : "이주연 대리"}</dd>
          <dt>승인 정책</dt>
          <dd>{isEmpty ? "예산 목록을 불러오는 중입니다." : "요청 건당 500만원 초과 시 팀장 승인 필요"}</dd>
        </dl>
      </section>
      <section className="panel-card linked-request-card">
        <header>
          <strong>최근 요청 (예산 연계)</strong>
          <button onClick={() => setShowAllRequests((current) => !current)} type="button">{showAllRequests ? "접기" : "더보기"}</button>
        </header>
        {visibleRequests.map((request) => (
          <article key={request.요청번호}>
            <p>
              <b>{request.요청번호}</b>
              <span>{request.거래처} 결제 요청</span>
            </p>
            <strong>{request.금액}</strong>
            <StatusPill value={request.결재상태} />
          </article>
        ))}
      </section>
      <section className="panel-card budget-history-card">
        <strong>예산 조정 이력</strong>
        {visibleHistory.length === 0 && <small>2024-01-01 연간 예산 최초 배정</small>}
        {visibleHistory.map((item) => (
          <article className="budget-history-item" key={item.조정ID || formatBudgetAdjustmentHistory(item)}>
            <small>{formatBudgetAdjustmentHistory(item)}</small>
            {item.원장반영방식 && <small>{item.원장반영방식}</small>}
            {item.상태 === "승인 대기" && (
              <div className="budget-history-actions">
                <button disabled={isAdjusting || item.취소가능 !== "가능"} onClick={() => onUpdateAdjustment(item, "cancel")} type="button">취소</button>
                <button disabled={isAdjusting || item.반려가능 !== "가능"} onClick={() => onUpdateAdjustment(item, "reject")} type="button">반려</button>
              </div>
            )}
          </article>
        ))}
      </section>
      <button className="wide-card-link panel-bottom-link" onClick={() => setShowAllHistory((current) => !current)} type="button">
        예산 조정 이력 보기
        <ChevronRight size={16} />
      </button>
    </aside>
  );
}

function VendorBody({ page }: { page: PageDefinition }) {
  const statusOptions = ["전체 상태", "활성", "비활성"];
  const accountOptions = ["전체 계좌", "확인 완료", "검증 대기", "계좌 불일치", "비활성"];
  const typeOptions = ["전체 구분", "법인", "개인/소상공", "일반"];
  const favoriteState = readFavoriteRouteState("vendors");
  const [vendors, setVendors] = useState<TableRow[]>(() => vendorRows.map((row) => ({ ...row })));
  const [selectedVendorName, setSelectedVendorName] = useState(vendorRows[0]?.거래처명 ?? "");
  const [statusFilter, setStatusFilter] = useState(favoriteState.statusFilter && statusOptions.includes(favoriteState.statusFilter) ? favoriteState.statusFilter : statusOptions[0]);
  const [accountFilter, setAccountFilter] = useState(favoriteState.filters.계좌확인 && accountOptions.includes(favoriteState.filters.계좌확인) ? favoriteState.filters.계좌확인 : accountOptions[0]);
  const [typeFilter, setTypeFilter] = useState(favoriteState.filters.구분 && typeOptions.includes(favoriteState.filters.구분) ? favoriteState.filters.구분 : typeOptions[0]);
  const [searchTerm, setSearchTerm] = useState(favoriteState.filters.검색어 ?? favoriteState.filters.거래처명 ?? "");
  const [vendorMessage, setVendorMessage] = useState("");
  const [detailOpen, setDetailOpen] = useState(true);
  const [isVendorLoading, setIsVendorLoading] = useState(false);
  const [vendorRefreshVersion, setVendorRefreshVersion] = useState(0);
  const [vendorPage, setVendorPage] = useState(1);
  const [vendorPageSize, setVendorPageSize] = useState(10);
  const [vendorTotal, setVendorTotal] = useState(vendorRows.length);
  const [pendingVendorNames, setPendingVendorNames] = useState<Set<string>>(new Set());
  const [pendingVendorUploadFiles, setPendingVendorUploadFiles] = useState<Record<string, File[]>>({});
  const [vendorDocuments, setVendorDocuments] = useState<Record<string, VendorDocument[]>>({});
  const [vendorPaymentSourceRows, setVendorPaymentSourceRows] = useState<{ disbursements: TableRow[]; requests: TableRow[] }>({
    disbursements: [],
    requests: [],
  });
  const vendorMutationInFlightRef = useRef(false);
  const pendingVendorUploadFilesRef = useRef<Record<string, File>>({});

  useEffect(() => {
    let active = true;
    setIsVendorLoading(true);
    const filters: Record<string, string> = {};
    if (statusFilter !== "전체 상태") filters.상태 = statusFilter;
    if (accountFilter !== "전체 계좌") filters.계좌확인 = accountFilter;
    if (typeFilter !== "전체 구분") filters.구분 = typeFilter;
    erpApi.listPageRows("vendors", {
      page: vendorPage,
      pageSize: vendorPageSize,
      search: searchTerm.trim(),
      filters,
      sort: encodeSort("거래처명", "asc"),
    })
      .then((response) => {
        if (!active) return;
        const rows = response.data.rows;
        setVendors(rows);
        setVendorTotal(response.data.total);
        setSelectedVendorName((current) => (rows.some((row) => row.거래처명 === current) ? current : rows[0]?.거래처명 ?? ""));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setVendors([]);
        setVendorTotal(0);
        setSelectedVendorName("");
        setVendorMessage(`거래처 목록을 API에서 불러오지 못했습니다. ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      })
      .finally(() => {
        if (active) setIsVendorLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountFilter, searchTerm, statusFilter, typeFilter, vendorPage, vendorPageSize, vendorRefreshVersion]);

  useEffect(() => {
    setVendorPage(1);
  }, [accountFilter, searchTerm, statusFilter, typeFilter]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      erpApi.listPageRows("disbursement", { page: 1, pageSize: 100, sort: encodeSort("지급예정일", "desc") }),
      erpApi.listPageRows("payment-request", { page: 1, pageSize: 100, sort: encodeSort("요청일", "desc") }),
    ])
      .then(([disbursementResult, requestResult]) => {
        if (!active) return;
        setVendorPaymentSourceRows({
          disbursements: disbursementResult.status === "fulfilled" ? disbursementResult.value.data.rows : [],
          requests: requestResult.status === "fulfilled" ? requestResult.value.data.rows : [],
        });
        const failures = [disbursementResult, requestResult].filter((result) => result.status === "rejected");
        if (failures.length > 0) setVendorMessage("일부 거래처 지급/요청 이력은 권한 또는 API 오류로 표시하지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [vendorRefreshVersion]);

  const filteredVendors = vendors;
  const selectedVendor = vendors.find((vendor) => vendor.거래처명 === selectedVendorName) ?? filteredVendors[0] ?? vendors[0];
  const selectedVendorKey = selectedVendor?.거래처명 ?? "";
  const selectedVendorBusinessNumber = selectedVendor?.사업자번호 ?? "";
  const selectedVendorIsPending = selectedVendorKey ? pendingVendorNames.has(selectedVendorKey) : false;
  const selectedVendorPaymentHistory = selectedVendor
    ? getVendorRecentPayments(selectedVendor.거래처명, vendorPaymentSourceRows.disbursements, vendorPaymentSourceRows.requests)
    : [];

  useEffect(() => {
    if (!selectedVendorKey || selectedVendorIsPending) return;
    let active = true;
    erpApi.listFiles("VENDOR", selectedVendorKey)
      .then((response) => {
        if (!active) return;
        const syncedDocuments = response.data.map((file) => toStoredVendorDocument(file));
        const recoveredDocuments = readUploadRecovery("VENDOR", selectedVendorKey).map((attachment) => ({
          ...attachment,
          category: getVendorDocumentCategory(attachment.fileName),
          uploadedAt: getSettingsTimestamp(),
        }) satisfies VendorDocument);
        setVendorDocuments((current) => ({
          ...current,
          [selectedVendorKey]: mergeSyncedVendorDocuments(syncedDocuments, [...recoveredDocuments, ...(current[selectedVendorKey] ?? [])]),
        }));
        if (recoveredDocuments.length > 0) {
          setVendorMessage(`${selectedVendorKey} 증빙 미완료 파일 ${recoveredDocuments.length}개를 복구했습니다. 원본 파일을 다시 선택하거나 삭제할 수 있습니다.`);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        const recoveredDocuments = readUploadRecovery("VENDOR", selectedVendorKey).map((attachment) => ({
          ...attachment,
          category: getVendorDocumentCategory(attachment.fileName),
          uploadedAt: getSettingsTimestamp(),
        }) satisfies VendorDocument);
        setVendorDocuments((current) => ({
          ...current,
          [selectedVendorKey]: recoveredDocuments.length > 0 ? recoveredDocuments : current[selectedVendorKey] ?? [],
        }));
        setVendorMessage(`거래처 증빙 목록 조회 실패: ${error instanceof Error ? error.message : "파일 metadata를 불러오지 못했습니다."}`);
      });
    return () => {
      active = false;
    };
  }, [selectedVendorKey, selectedVendorBusinessNumber, selectedVendorIsPending, vendorRefreshVersion]);

  const addVendor = () => {
    const sequence = vendors.length + 1;
    const vendorName = `신규거래처-${sequence}`;
    const newVendor = buildVendorRow({
      originalName: vendorName,
      name: vendorName,
      businessNumber: "",
      manager: "",
      bankName: "",
      bankAccount: "",
      accountStatus: "검증 대기",
      status: "활성",
      taxEmail: "",
      taxIssueType: "이메일 발행",
    });
    setVendors((current) => [newVendor, ...current]);
    setVendorTotal((current) => current + 1);
    setVendorDocuments((current) => ({ ...current, [newVendor.거래처명]: [] }));
    setPendingVendorNames((current) => new Set(current).add(newVendor.거래처명));
    setSelectedVendorName(newVendor.거래처명);
    setDetailOpen(true);
    setVendorMessage(`${newVendor.거래처명} 거래처 등록 폼이 열렸습니다. 필수 정보와 증빙 파일을 입력하세요.`);
  };

  const saveVendor = async (draft: VendorDraft) => {
    if (vendorMutationInFlightRef.current) {
      setVendorMessage("거래처 저장 요청을 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    const currentVendor = vendors.find((vendor) => vendor.거래처명 === draft.originalName) ?? selectedVendor;
    if (!currentVendor) return;
    const isPendingVendor = pendingVendorNames.has(draft.originalName);
    const nextName = draft.name.trim();
    const nextBusinessNumber = draft.businessNumber.trim();
    const nextAccount = draft.bankAccount.trim();
    if (!nextName || !nextBusinessNumber || !draft.bankName.trim() || !nextAccount) {
      setVendorMessage("거래처명, 사업자번호, 은행, 계좌번호는 필수입니다.");
      return;
    }
    if (!draft.manager.trim()) {
      setVendorMessage("거래처 담당자는 필수입니다.");
      return;
    }
    if (!draft.taxEmail.trim() || !isValidVendorTaxEmail(draft.taxEmail)) {
      setVendorMessage("유효한 세금계산서 수신 이메일을 입력하세요.");
      return;
    }
    const hasDuplicateVendorName = vendors.some((vendor) => vendor.거래처명 !== draft.originalName && vendor.거래처명 === nextName);
    if (hasDuplicateVendorName) {
      setVendorMessage("거래처명이 이미 등록되어 있습니다.");
      return;
    }
    const hasDuplicateBusinessNumber = vendors.some((vendor) => vendor.거래처명 !== draft.originalName && vendor.사업자번호 === nextBusinessNumber);
    if (hasDuplicateBusinessNumber) {
      setVendorMessage("사업자번호가 이미 등록되어 있습니다.");
      return;
    }
    const hasDuplicateAccount = vendors.some((vendor) => vendor.거래처명 !== draft.originalName && splitVendorBank(vendor.은행).bankAccount === nextAccount);
    if (hasDuplicateAccount) {
      setVendorMessage("계좌번호가 이미 등록되어 있습니다.");
      return;
    }

    const nextVendor = buildVendorRow(draft, currentVendor);
    const changeSummary = [
      currentVendor.거래처명 !== nextVendor.거래처명 ? `거래처명 ${currentVendor.거래처명} → ${nextVendor.거래처명}` : "",
      currentVendor.은행 !== nextVendor.은행 ? "계좌 정보 변경" : "",
      currentVendor.상태 !== nextVendor.상태 ? `상태 ${currentVendor.상태} → ${nextVendor.상태}` : "",
    ].filter(Boolean).join(", ") || "기본 정보 확인";
    const deferredFiles = pendingVendorUploadFiles[draft.originalName] ?? [];

    try {
      vendorMutationInFlightRef.current = true;
      setVendorMessage(`${nextVendor.거래처명} 거래처 정보를 저장하고 있습니다.`);
      const requestRowVersion = vendorRowVersion(currentVendor);
      const mutationPayload = {
        ...nextVendor,
        rowVersion: requestRowVersion,
        거래처RowVersion: requestRowVersion,
        idempotencyKey: vendorMutationKey(isPendingVendor ? "create" : "update", currentVendor, requestRowVersion),
      };
      const response = isPendingVendor
        ? await erpApi.createPageRow("vendors", mutationPayload)
        : await erpApi.updatePageRow("vendors", draft.originalName, mutationPayload);
      const savedVendor = response.data ?? nextVendor;
      const savedName = savedVendor.거래처명 || nextVendor.거래처명;
      setVendors((current) => {
        if (isPendingVendor) {
          return [savedVendor, ...current.filter((vendor) => vendor.거래처명 !== draft.originalName)];
        }
        return current.map((vendor) => (vendor.거래처명 === draft.originalName ? savedVendor : vendor));
      });
      setVendorDocuments((current) => {
        const documents = current[draft.originalName] ?? [];
        const retainedDocuments = deferredFiles.length > 0 ? documents.filter((document) => document.message !== deferredVendorUploadMessage) : documents;
        if (draft.originalName === savedName) return { ...current, [savedName]: retainedDocuments };
        const { [draft.originalName]: _removed, ...rest } = current;
        return { ...rest, [savedName]: retainedDocuments };
      });
      setPendingVendorNames((current) => {
        const next = new Set(current);
        next.delete(draft.originalName);
        next.delete(savedName);
        return next;
      });
      setPendingVendorUploadFiles((current) => {
        const { [draft.originalName]: _removed, ...rest } = current;
        return rest;
      });
      setSelectedVendorName(savedName);
      try {
        window.localStorage.setItem("erp:last-created-vendor", savedName);
      } catch {
        setVendorMessage("거래처는 저장되었지만 최근 거래처 선택 정보는 브라우저 저장소에 남기지 못했습니다.");
      }
      window.dispatchEvent(new CustomEvent("erp:vendor-saved", { detail: { vendorName: savedName } }));
      if (deferredFiles.length > 0) {
        await uploadVendorDocuments(savedName, deferredFiles, { deferIfPending: false, finalMessage: false });
      }
      setVendorMessage(
        `${savedName} 거래처 정보가 저장되었습니다. 변경 요약: ${changeSummary}. 감사 로그에 기록되었습니다.${
          deferredFiles.length > 0 ? ` 대기 중이던 증빙 파일 ${deferredFiles.length}개도 저장소에 업로드했습니다.` : ""
        }`,
      );
      setVendorRefreshVersion((current) => current + 1);
    } catch (error) {
      setVendorMessage(`거래처 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      vendorMutationInFlightRef.current = false;
    }
  };

  const uploadVendorDocuments = async (vendorName: string, files: File[], options: { deferIfPending?: boolean; finalMessage?: boolean } = {}) => {
    if (!files.length) return;
    const { accepted, rejected } = prepareAttachmentDrafts(files);
    const uploadPairs = matchAcceptedFiles(files, accepted);
    const uploadingDocuments: VendorDocument[] = uploadPairs.map(({ attachment, file }) => {
      pendingVendorUploadFilesRef.current[attachment.id] = file;
      return {
        ...attachment,
        status: "uploading",
        message: "업로드 준비 중",
        progressPercent: 4,
        retryCount: 0,
        category: getVendorDocumentCategory(attachment.fileName),
        uploadedAt: getSettingsTimestamp(),
      };
    });
    const shouldDefer = (options.deferIfPending ?? true) && pendingVendorNames.has(vendorName);
    if (shouldDefer) {
      if (uploadingDocuments.length > 0) {
        setVendorDocuments((current) => ({
          ...current,
          [vendorName]: [
            ...uploadingDocuments.map((document) => ({ ...document, message: deferredVendorUploadMessage })),
            ...(current[vendorName] ?? []),
          ],
        }));
        setPendingVendorUploadFiles((current) => ({
          ...current,
          [vendorName]: [...(current[vendorName] ?? []), ...uploadPairs.map(({ file }) => file)],
        }));
      }
      setVendorMessage(
        [
          uploadPairs.length > 0 ? `${vendorName} 증빙 파일 ${uploadPairs.length}개가 업로드 대기 상태입니다. 거래처 저장 시 저장소에 업로드됩니다.` : "",
          rejected.join(" "),
        ].filter(Boolean).join(" "),
      );
      return;
    }
    if (uploadingDocuments.length > 0) {
      const uploadKeys = new Set(uploadPairs.map(({ file }) => `${file.name}:${file.size}`));
      setVendorDocuments((current) => ({
        ...current,
        [vendorName]: [
          ...uploadingDocuments,
          ...(current[vendorName] ?? []).filter((document) => document.message !== deferredVendorUploadMessage || !uploadKeys.has(`${document.fileName}:${document.byteSize}`)),
        ],
      }));
      replaceUploadRecoveryItems("VENDOR", vendorName, uploadingDocuments);
    }
    if (uploadPairs.length === 0) {
      setVendorMessage(rejected.length > 0 ? rejected.join(" ") : "업로드할 수 있는 증빙 파일이 없습니다.");
      return;
    }
    setVendorMessage(`${vendorName} 증빙 파일 ${uploadPairs.length}개를 저장소로 업로드하고 있습니다.${rejected.length > 0 ? ` ${rejected.join(" ")}` : ""}`);
    const uploadedDocuments = await Promise.all(
      uploadPairs.map(async ({ attachment, file }) => {
        try {
          const stored = await uploadAttachmentToStorage("VENDOR", vendorName, file, attachment.id, {
            onProgress: (percent, message) => {
              setVendorDocuments((current) => ({
                ...current,
                [vendorName]: (current[vendorName] ?? []).map((document) => (document.id === attachment.id ? { ...document, progressPercent: percent, message } : document)),
              }));
            },
          });
          delete pendingVendorUploadFilesRef.current[attachment.id];
          return {
            ...stored,
            category: getVendorDocumentCategory(stored.fileName),
            uploadedAt: getSettingsTimestamp(),
          } satisfies VendorDocument;
        } catch (error) {
          return {
            ...attachment,
            status: "error" as const,
            progressPercent: 0,
            retryCount: attachment.retryCount ?? 0,
            message: `${error instanceof Error ? error.message : "업로드 실패"} · 재시도 가능`,
            category: getVendorDocumentCategory(attachment.fileName),
            uploadedAt: getSettingsTimestamp(),
          } satisfies VendorDocument;
        }
      }),
    );
    const uploadingIds = new Set(uploadingDocuments.map((document) => document.id));
    setVendorDocuments((current) => ({
      ...current,
      [vendorName]: mergeCompletedVendorUploads(uploadedDocuments, current[vendorName] ?? [], uploadingIds),
    }));
    replaceUploadRecoveryItems("VENDOR", vendorName, uploadedDocuments, uploadingDocuments.map((document) => document.id));
    const successCount = uploadedDocuments.filter((document) => document.status === "ready").length;
    const failedCount = uploadedDocuments.length - successCount;
    if (options.finalMessage !== false) {
      setVendorMessage(
        [
          successCount > 0 ? `${vendorName} 증빙 파일 ${successCount}개가 업로드되었습니다. 저장소 metadata와 연결되었습니다.` : "",
          failedCount > 0 ? `${failedCount}개 파일 업로드에 실패했습니다.` : "",
          rejected.join(" "),
        ].filter(Boolean).join(" "),
      );
    }
  };

  const retryVendorDocumentUpload = async (vendorName: string, documentId: string) => {
    if (pendingVendorNames.has(vendorName)) {
      setVendorMessage("거래처 저장 후 증빙 파일을 업로드할 수 있습니다.");
      return;
    }
    const document = (vendorDocuments[vendorName] ?? []).find((item) => item.id === documentId);
    if (!document) return;
    const file = pendingVendorUploadFilesRef.current[documentId];
    if (!file) {
      setVendorMessage(`${document.fileName} 원본 파일이 브라우저 세션에 남아 있지 않습니다. 파일을 다시 선택해 업로드하세요.`);
      setVendorDocuments((current) => ({
        ...current,
        [vendorName]: (current[vendorName] ?? []).map((item) => (
          item.id === documentId
            ? { ...item, status: "error", progressPercent: 0, message: "원본 파일 재선택 필요" }
            : item
        )),
      }));
      return;
    }
    const retryingDocument: VendorDocument = {
      ...document,
      status: "uploading",
      progressPercent: 4,
      retryCount: (document.retryCount ?? 0) + 1,
      message: "재시도 준비 중",
      uploadedAt: getSettingsTimestamp(),
    };
    setVendorDocuments((current) => ({
      ...current,
      [vendorName]: (current[vendorName] ?? []).map((item) => (item.id === documentId ? retryingDocument : item)),
    }));
    replaceUploadRecoveryItems("VENDOR", vendorName, [retryingDocument], [documentId]);
    try {
      const stored = await uploadAttachmentToStorage("VENDOR", vendorName, file, documentId, {
        onProgress: (percent, message) => {
          setVendorDocuments((current) => ({
            ...current,
            [vendorName]: (current[vendorName] ?? []).map((item) => (item.id === documentId ? { ...item, progressPercent: percent, message } : item)),
          }));
        },
      });
      delete pendingVendorUploadFilesRef.current[documentId];
      const storedDocument: VendorDocument = {
        ...stored,
        retryCount: retryingDocument.retryCount,
        category: getVendorDocumentCategory(stored.fileName),
        uploadedAt: getSettingsTimestamp(),
      };
      setVendorDocuments((current) => ({
        ...current,
        [vendorName]: (current[vendorName] ?? []).map((item) => (item.id === documentId ? storedDocument : item)),
      }));
      replaceUploadRecoveryItems("VENDOR", vendorName, [storedDocument], [documentId]);
      setVendorMessage(`${vendorName} ${storedDocument.fileName} 재업로드가 완료되었습니다.`);
    } catch (error) {
      const failedDocument: VendorDocument = {
        ...document,
        status: "error",
        progressPercent: 0,
        retryCount: retryingDocument.retryCount,
        message: `${error instanceof Error ? error.message : "업로드 실패"} · 재시도 가능`,
        uploadedAt: getSettingsTimestamp(),
      };
      setVendorDocuments((current) => ({
        ...current,
        [vendorName]: (current[vendorName] ?? []).map((item) => (item.id === documentId ? failedDocument : item)),
      }));
      replaceUploadRecoveryItems("VENDOR", vendorName, [failedDocument], [documentId]);
      setVendorMessage(`${vendorName} ${document.fileName} 재업로드에 실패했습니다.`);
    }
  };

  const removeVendorDocument = async (vendorName: string, documentId: string) => {
    const document = (vendorDocuments[vendorName] ?? []).find((item) => item.id === documentId);
    if (document?.remoteId) {
      try {
        await erpApi.deleteFile(document.remoteId, {
          idempotencyKey: fileMutationKey("delete", "VENDOR", vendorName, document.remoteId, document.id),
        });
      } catch (error) {
        setVendorMessage(error instanceof Error ? error.message : "거래처 증빙 파일 삭제에 실패했습니다.");
        return;
      }
    }
    setVendorDocuments((current) => ({
      ...current,
      [vendorName]: (current[vendorName] ?? []).filter((document) => document.id !== documentId),
    }));
    delete pendingVendorUploadFilesRef.current[documentId];
    replaceUploadRecoveryItems("VENDOR", vendorName, [], [documentId]);
    setVendorMessage(`${vendorName} 증빙 파일이 삭제되었습니다.`);
  };

  const downloadVendorDocument = async (vendorDocument: VendorDocument) => {
    if (vendorDocument.status === "uploading") {
      setVendorMessage("업로드가 완료된 뒤 다운로드할 수 있습니다.");
      return;
    }
    if (vendorDocument.remoteId) {
      try {
        const ticket = await erpApi.getFileDownload(vendorDocument.remoteId, {
          reason: `거래처 ${selectedVendorKey || "선택 거래처"} ${vendorDocument.category} 증빙 확인`,
        });
        if (canDownloadDirectly(ticket.data.download.url)) {
          triggerUrlDownload(ticket.data.download.url, ticket.data.file.fileName);
          setVendorMessage(`${ticket.data.file.fileName} 원본 다운로드를 시작했습니다. 다운로드 사유가 감사 로그에 기록되었습니다.`);
          return;
        }
      } catch (error) {
        setVendorMessage(error instanceof Error ? error.message : "거래처 증빙 파일 다운로드에 실패했습니다.");
        return;
      }
    }
    const blob = new Blob([`${vendorDocument.category}\n${vendorDocument.fileName}\n${vendorDocument.uploadedAt}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = vendorDocument.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setVendorMessage(`${vendorDocument.fileName} 다운로드를 준비했습니다.`);
  };


  const previewVendorDocument = async (vendorDocument: VendorDocument) => {
    if (vendorDocument.status === "uploading") {
      setVendorMessage("업로드가 완료된 뒤 미리보기할 수 있습니다.");
      return;
    }
    if (!canPreviewAttachment(vendorDocument.fileName)) {
      setVendorMessage("PDF, JPG, PNG 파일만 미리보기를 지원합니다.");
      return;
    }
    if (!vendorDocument.remoteId) {
      setVendorMessage("저장소 업로드가 완료된 파일만 미리보기할 수 있습니다.");
      return;
    }
    try {
      const ticket = await erpApi.getFileDownload(vendorDocument.remoteId, {
        reason: `거래처 ${selectedVendorKey || "선택 거래처"} ${vendorDocument.category} 증빙 미리보기`,
        disposition: "inline",
      });
      if (canDownloadDirectly(ticket.data.download.url)) {
        const opened = triggerUrlPreview(ticket.data.download.url);
        setVendorMessage(opened
          ? `${ticket.data.file.fileName} 미리보기를 열었습니다. signed URL 만료: ${ticket.data.download.expiresAt.slice(0, 16)}. 접근 로그가 감사 로그에 기록되었습니다.`
          : "브라우저가 미리보기 창을 차단했습니다. 팝업 허용 후 다시 시도하세요.");
        return;
      }
      setVendorMessage("remote mode signed URL을 받을 수 있을 때 미리보기를 열 수 있습니다.");
    } catch (error) {
      setVendorMessage(error instanceof Error ? error.message : "거래처 증빙 파일 미리보기에 실패했습니다.");
    }
  };
  const deactivateVendor = async (reason = "운영자 수동 비활성화") => {
    if (vendorMutationInFlightRef.current) {
      setVendorMessage("거래처 변경 요청을 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (!selectedVendor) return;
    const patch = { 상태: "비활성", 계좌확인: "비활성" };
    if (pendingVendorNames.has(selectedVendor.거래처명)) {
      setVendors((current) => current.map((vendor) => (vendor.거래처명 === selectedVendor.거래처명 ? { ...vendor, ...patch } : vendor)));
      setVendorMessage(`${selectedVendor.거래처명} 거래처가 비활성화되었습니다. 사유: ${reason}. 저장 전 임시 거래처라 서버 반영은 저장 시점에 수행됩니다.`);
      return;
    }

    try {
      vendorMutationInFlightRef.current = true;
      const requestRowVersion = vendorRowVersion(selectedVendor);
      const response = await erpApi.executePageAction("vendors", selectedVendor.거래처명, "deactivate", {
        reason,
        patch: { ...patch, rowVersion: requestRowVersion, 거래처RowVersion: requestRowVersion },
        rowVersion: Number(requestRowVersion),
        idempotencyKey: vendorMutationKey("deactivate", selectedVendor, requestRowVersion),
      });
      const updatedVendor = response.data ?? { ...selectedVendor, ...patch };
      const activeRequests = Number(updatedVendor.비활성화영향요청 ?? "0");
      const openDisbursements = Number(updatedVendor.비활성화영향지급예약 ?? "0");
      setVendors((current) => current.map((vendor) => (vendor.거래처명 === selectedVendor.거래처명 ? updatedVendor : vendor)));
      setVendorMessage(`${updatedVendor.거래처명 ?? selectedVendor.거래처명} 거래처가 비활성화되었습니다. 사유: ${reason}. 서버 기준 진행 중 요청 ${activeRequests}건, 지급 예약/미완료 ${openDisbursements}건 영향 확인 후 결제 요청 선택 목록에서 제외됩니다.`);
      setVendorRefreshVersion((current) => current + 1);
    } catch (error) {
      setVendorMessage(`거래처 비활성화 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      vendorMutationInFlightRef.current = false;
    }
  };

  const recheckVendorAccount = async () => {
    if (vendorMutationInFlightRef.current) {
      setVendorMessage("거래처 변경 요청을 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (!selectedVendor) return;
    const patch = { 계좌확인: "확인 완료" };
    if (pendingVendorNames.has(selectedVendor.거래처명)) {
      setVendors((current) => current.map((vendor) => (vendor.거래처명 === selectedVendor.거래처명 ? { ...vendor, ...patch } : vendor)));
      setVendorMessage(`${selectedVendor.거래처명} 계좌 확인이 완료되었습니다. 저장 전 임시 거래처라 서버 반영은 저장 시점에 수행됩니다.`);
      return;
    }

    try {
      vendorMutationInFlightRef.current = true;
      const requestRowVersion = vendorRowVersion(selectedVendor);
      const response = await erpApi.updatePageRow("vendors", selectedVendor.거래처명, {
        ...patch,
        rowVersion: requestRowVersion,
        거래처RowVersion: requestRowVersion,
        idempotencyKey: vendorMutationKey("verify", selectedVendor, requestRowVersion),
      });
      const updatedVendor = response.data ?? { ...selectedVendor, ...patch };
      setVendors((current) => current.map((vendor) => (vendor.거래처명 === selectedVendor.거래처명 ? updatedVendor : vendor)));
      setVendorMessage(`${updatedVendor.거래처명 ?? selectedVendor.거래처명} 계좌 확인이 완료되었습니다.`);
      setVendorRefreshVersion((current) => current + 1);
    } catch (error) {
      setVendorMessage(`계좌 확인 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      vendorMutationInFlightRef.current = false;
    }
  };

  const vendorFeedback = isVendorLoading ? "거래처 목록을 API에서 불러오는 중입니다." : vendorMessage;
  const isVendorErrorMessage = ["이미", "필수", "실패", "불러오지"].some((keyword) => vendorFeedback.includes(keyword));

  return (
    <div className="vendor-management-page">
      <section className="management-main-column">
        <VendorToolbar
          accountFilter={accountFilter}
          onAddVendor={addVendor}
          onCycleAccount={() => setAccountFilter((current) => accountOptions[(accountOptions.indexOf(current) + 1) % accountOptions.length])}
          onCycleStatus={() => setStatusFilter((current) => statusOptions[(statusOptions.indexOf(current) + 1) % statusOptions.length])}
          onCycleType={() => setTypeFilter((current) => typeOptions[(typeOptions.indexOf(current) + 1) % typeOptions.length])}
          onDownload={() => {
            downloadTableCsv("vendors-current-filter.csv", pages.vendors.tableColumns, filteredVendors);
            setVendorMessage("현재 거래처 목록과 계좌 검증 결과 CSV 다운로드를 시작했습니다.");
          }}
          onFilterMessage={setVendorMessage}
          onResetFilters={() => {
            setStatusFilter(statusOptions[0]);
            setAccountFilter(accountOptions[0]);
            setTypeFilter(typeOptions[0]);
            setSearchTerm("");
            setVendorMessage("거래처 상세 필터를 초기화했습니다.");
          }}
          onSearchChange={setSearchTerm}
          searchTerm={searchTerm}
          statusFilter={statusFilter}
          typeFilter={typeFilter}
        />
        {vendorFeedback && <small className={isVendorErrorMessage ? "panel-action-message error vendor-message" : "panel-action-message vendor-message"}>{vendorFeedback}</small>}
        <section className="kpi-row management-kpis vendor-kpis">
          {page.kpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} />
          ))}
        </section>
        <VendorTable
          page={vendorPage}
          pageSize={vendorPageSize}
          rows={filteredVendors}
          selectedVendorName={selectedVendor?.거래처명 ?? ""}
          total={vendorTotal}
          onPageChange={setVendorPage}
          onPageSizeToggle={() => {
            setVendorPage(1);
            setVendorPageSize((current) => (current === 10 ? 5 : 10));
          }}
          onSelectVendor={(vendorName) => {
            setSelectedVendorName(vendorName);
            setDetailOpen(true);
          }}
        />
      </section>
      {detailOpen ? (
        <VendorDetailPanel
          documents={vendorDocuments[selectedVendor?.거래처명 ?? ""] ?? []}
          paymentHistory={selectedVendorPaymentHistory}
          row={selectedVendor}
          onClose={() => setDetailOpen(false)}
          onDeactivate={deactivateVendor}
          onDownloadDocument={downloadVendorDocument}
          onPreviewDocument={previewVendorDocument}
          onRecheckAccount={recheckVendorAccount}
          onRemoveDocument={removeVendorDocument}
          onRetryDocumentUpload={retryVendorDocumentUpload}
          onSave={saveVendor}
          onUploadDocuments={uploadVendorDocuments}
        />
      ) : (
        <ClosedDetailPanel title="거래처 상세" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function VendorToolbar({
  accountFilter,
  onAddVendor,
  onCycleAccount,
  onCycleStatus,
  onCycleType,
  onDownload,
  onFilterMessage,
  onResetFilters,
  onSearchChange,
  searchTerm,
  statusFilter,
  typeFilter,
}: {
  accountFilter: string;
  onAddVendor: () => void;
  onCycleAccount: () => void;
  onCycleStatus: () => void;
  onCycleType: () => void;
  onDownload: () => void;
  onFilterMessage: (message: string) => void;
  onResetFilters: () => void;
  onSearchChange: (value: string) => void;
  searchTerm: string;
  statusFilter: string;
  typeFilter: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <div className="management-toolbar vendor-toolbar">
      <div className="management-filter-group vendor-filter-group">
        <button className="management-select-filter" onClick={onCycleStatus} type="button">
          <span>거래처 상태</span>
          <b>{statusFilter}</b>
          <ChevronDown size={16} />
        </button>
        <button className="management-select-filter" onClick={onCycleAccount} type="button">
          <span>계좌 확인</span>
          <b>{accountFilter}</b>
          <ChevronDown size={16} />
        </button>
        <button className="management-select-filter" onClick={onCycleType} type="button">
          <span>거래처 구분</span>
          <b>{typeFilter}</b>
          <ChevronDown size={16} />
        </button>
        <label className="management-search-filter vendor-search-filter">
          <input
            aria-label="거래처 검색"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="거래처명, 사업자번호 검색"
            value={searchTerm}
          />
          <Search size={17} />
        </label>
        <button className="management-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="management-toolbar-actions">
        <button className="management-primary-button" onClick={onAddVendor} type="button">
          <Plus size={17} />
          거래처 추가
        </button>
        <button className="management-icon-button" aria-label="다운로드" onClick={onDownload} type="button">
          <Download size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="거래처 상세 필터"
          fields={[
            { label: "상태", value: statusFilter },
            { label: "계좌", value: accountFilter },
            { label: "구분", value: typeFilter },
            { label: "검색어", value: searchTerm || "없음" },
          ]}
          onApply={() => {
            onFilterMessage(`${statusFilter}, ${accountFilter}, ${typeFilter} 거래처 필터를 적용했습니다.`);
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
          onReset={onResetFilters}
        />
      )}
    </div>
  );
}

function VendorTable({
  onPageChange,
  onPageSizeToggle,
  onSelectVendor,
  page,
  pageSize,
  rows,
  selectedVendorName,
  total,
}: {
  onPageChange: (page: number) => void;
  onPageSizeToggle: () => void;
  onSelectVendor: (vendorName: string) => void;
  page: number;
  pageSize: number;
  rows: TableRow[];
  selectedVendorName: string;
  total: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows;
  return (
    <section className="erp-card vendor-table-card">
      <table className="vendor-table">
        <thead>
          <tr>
            <th>
              <span className="checkbox-fake" />
            </th>
            {["거래처명", "사업자번호", "담당자", "은행", "계좌확인", "최근 지급일", "누적 지급액", "상태"].map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr className={row.거래처명 === selectedVendorName ? "selected" : ""} key={row.거래처명} onClick={() => onSelectVendor(row.거래처명)}>
              <td>
                <span className={row.거래처명 === selectedVendorName ? "checkbox-fake checked" : "checkbox-fake"} />
              </td>
              <td>{row.거래처명}</td>
              <td>{row.사업자번호}</td>
              <td>{row.담당자}</td>
              <td>{row.은행}</td>
              <td>
                <AccountStatusPill value={row.계좌확인} />
              </td>
              <td>{row.최근지급일}</td>
              <td>{row.누적지급액}</td>
              <td>
                <StatusPill value={row.상태} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="management-table-footer">
        <span>전체 {total} 건</span>
        <div>
          <button onClick={() => onPageChange(Math.max(1, page - 1))} type="button">‹</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5).map((pageNumber) => (
            <button className={pageNumber === page ? "active" : undefined} key={pageNumber} onClick={() => onPageChange(pageNumber)} type="button">{pageNumber}</button>
          ))}
          <button onClick={() => onPageChange(Math.min(pageCount, page + 1))} type="button">›</button>
        </div>
        <button className="rows-select" onClick={onPageSizeToggle} type="button">{pageSize} 건씩</button>
      </footer>
    </section>
  );
}

function VendorDetailPanel({
  documents,
  onClose,
  onDeactivate,
  onDownloadDocument,
  onPreviewDocument,
  onRecheckAccount,
  onRemoveDocument,
  onRetryDocumentUpload,
  onSave,
  onUploadDocuments,
  paymentHistory,
  row,
}: {
  documents: VendorDocument[];
  onClose: () => void;
  onDeactivate: (reason?: string) => void | Promise<void>;
  onDownloadDocument: (document: VendorDocument) => void | Promise<void>;
  onPreviewDocument: (document: VendorDocument) => void | Promise<void>;
  onRecheckAccount: () => void | Promise<void>;
  onRemoveDocument: (vendorName: string, documentId: string) => void | Promise<void>;
  onRetryDocumentUpload: (vendorName: string, documentId: string) => void | Promise<void>;
  onSave: (draft: VendorDraft) => void;
  onUploadDocuments: (vendorName: string, files: File[]) => void | Promise<void>;
  paymentHistory: VendorPaymentHistoryItem[];
  row?: TableRow;
}) {
  const isEmpty = !row;
  const selected = row ?? emptyVendorDetailRow;
  const [draft, setDraft] = useState<VendorDraft>(() => makeVendorDraft(selected));
  const [activeTab, setActiveTab] = useState<"basic" | "payments">("basic");
  const [deactivateReason, setDeactivateReason] = useState("거래 종료");
  const visiblePaymentHistory = paymentHistory.length > 0
    ? paymentHistory
    : [{ id: "-", date: "-", department: "최근 지급/요청 없음", amount: "0 원", status: "대기", source: "-" as const }];

  useEffect(() => {
    setDraft(makeVendorDraft(selected));
    setActiveTab("basic");
  }, [selected]);

  const updateDraft = (patch: Partial<VendorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleDocumentUpload = (event: ChangeEvent<HTMLInputElement>) => {
    void onUploadDocuments(selected.거래처명, Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  };

  return (
    <aside className="vendor-detail-panel" aria-label="거래처 상세">
      <header className="vendor-detail-title">
        <div>
          <strong>{selected.거래처명}</strong>
          <StatusPill value={selected.상태} />
        </div>
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>
      <nav className="vendor-detail-tabs">
        <button className={activeTab === "basic" ? "active" : undefined} onClick={() => setActiveTab("basic")} type="button">기본 정보</button>
        <button className={activeTab === "payments" ? "active" : undefined} onClick={() => setActiveTab("payments")} type="button">지급 이력</button>
      </nav>
      {activeTab === "basic" ? (
        <>
      <section className="vendor-detail-section">
        <strong>기본 정보</strong>
        <div className="vendor-edit-grid">
          <label>
            거래처명
            <input aria-label="거래처명 입력" onChange={(event) => updateDraft({ name: event.currentTarget.value })} value={draft.name} />
          </label>
          <label>
            사업자번호
            <input aria-label="사업자번호 입력" onChange={(event) => updateDraft({ businessNumber: event.currentTarget.value })} value={draft.businessNumber} />
          </label>
          <label>
            담당자
            <input aria-label="거래처 담당자 입력" onChange={(event) => updateDraft({ manager: event.currentTarget.value })} value={draft.manager} />
          </label>
          <label>
            상태
            <select aria-label="거래처 상태 선택" onChange={(event) => updateDraft({ status: event.currentTarget.value })} value={draft.status}>
              <option value="활성">활성</option>
              <option value="비활성">비활성</option>
            </select>
          </label>
        </div>
        {draft.status === "비활성" && <small className="vendor-restriction-note">비활성 거래처는 결제 요청 거래처 선택 목록에서 제외됩니다.</small>}
      </section>
      <section className="vendor-detail-section">
        <header>
          <strong>계좌 정보</strong>
          <AccountStatusPill value={draft.accountStatus} />
        </header>
        <div className="vendor-edit-grid">
          <label>
            은행명
            <input aria-label="은행명 입력" onChange={(event) => updateDraft({ bankName: event.currentTarget.value })} value={draft.bankName} />
          </label>
          <label>
            계좌번호
            <input aria-label="계좌번호 입력" onChange={(event) => updateDraft({ bankAccount: event.currentTarget.value })} value={draft.bankAccount} />
          </label>
          <label>
            예금주
            <input aria-label="예금주 입력" readOnly value={draft.name} />
          </label>
          <label>
            계좌확인
            <select aria-label="계좌 확인 상태 선택" onChange={(event) => updateDraft({ accountStatus: event.currentTarget.value })} value={draft.accountStatus}>
              <option value="확인 완료">확인 완료</option>
              <option value="검증 대기">검증 대기</option>
              <option value="계좌 불일치">계좌 불일치</option>
              <option value="비활성">비활성</option>
            </select>
          </label>
        </div>
        <button className="inline-action vendor-recheck-button" disabled={draft.accountStatus === "확인 완료"} onClick={onRecheckAccount} type="button">계좌 재확인</button>
      </section>
      <section className="vendor-detail-section">
        <strong>세금계산서 및 증빙 파일</strong>
        <div className="vendor-edit-grid">
          <label>
            이메일
            <input aria-label="세금계산서 이메일 입력" onChange={(event) => updateDraft({ taxEmail: event.currentTarget.value })} value={draft.taxEmail} />
          </label>
          <label>
            발행 방식
            <select aria-label="세금계산서 발행 방식 선택" onChange={(event) => updateDraft({ taxIssueType: event.currentTarget.value })} value={draft.taxIssueType}>
              <option value="이메일 발행">이메일 발행</option>
              <option value="전자세금계산서 연동">전자세금계산서 연동</option>
              <option value="수기 확인">수기 확인</option>
            </select>
          </label>
        </div>
        <label className="vendor-upload-box">
          <Upload size={18} />
          <span>사업자등록증/통장사본/세금계산서 업로드</span>
          <small>PDF, JPG, PNG, XLSX · 최대 10MB</small>
          <input
            aria-label="거래처 증빙 파일 업로드"
            accept=".pdf,.jpg,.jpeg,.png,.xlsx"
            multiple
            onChange={handleDocumentUpload}
            type="file"
          />
        </label>
        <div className="vendor-document-list">
          {documents.length === 0 ? (
            <small>등록된 증빙 파일이 없습니다.</small>
          ) : (
            documents.map((documentItem) => (
              <article key={documentItem.id}>
                <span>
                  <b>{documentItem.category}</b>
                  {documentItem.fileName}
                  <small>{formatFileSize(documentItem.byteSize)} · {documentItem.uploadedAt}{documentItem.message ? ` · ${documentItem.message}` : ""}</small>
                  {documentItem.status === "uploading" && (
                    <span className="upload-progress-track" aria-label={`${documentItem.fileName} 업로드 진행률 ${documentItem.progressPercent ?? 0}%`}>
                      <i style={{ width: `${documentItem.progressPercent ?? 0}%` }} />
                    </span>
                  )}
                </span>
                {documentItem.status === "error" && (
                  <button aria-label={`${documentItem.fileName} 재업로드`} onClick={() => onRetryDocumentUpload(selected.거래처명, documentItem.id)} type="button">
                    <RefreshCw size={14} />
                  </button>
                )}
                {documentItem.status !== "error" && <i className="upload-row-spacer" aria-hidden="true" />}
                {canPreviewAttachment(documentItem.fileName) ? (
                  <button aria-label={`${documentItem.fileName} 미리보기`} disabled={documentItem.status === "uploading" || documentItem.status === "error"} onClick={() => onPreviewDocument(documentItem)} type="button">
                    <Eye size={14} />
                  </button>
                ) : (
                  <i className="upload-row-spacer" aria-hidden="true" />
                )}
                <button aria-label={`${documentItem.fileName} 다운로드`} disabled={documentItem.status === "uploading"} onClick={() => onDownloadDocument(documentItem)} type="button">
                  <Download size={14} />
                </button>
                <button aria-label={`${documentItem.fileName} 삭제`} onClick={() => onRemoveDocument(selected.거래처명, documentItem.id)} type="button">
                  <Trash2 size={14} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>
      <section className="vendor-recent-payments">
        <header>
          <strong>최근 지급/요청</strong>
          <button onClick={() => setActiveTab("payments")} type="button">더보기</button>
        </header>
        {visiblePaymentHistory.slice(0, 4).map((payment) => (
          <article key={`${payment.id}-${payment.date}`}>
            <span>{payment.id}</span>
            <small>{payment.source} · {payment.date}</small>
            <small>{payment.department}</small>
            <b>{payment.amount}</b>
            <StatusPill value={payment.status} />
          </article>
        ))}
      </section>
        </>
      ) : (
        <section className="vendor-payment-history-panel">
          <strong>지급 이력 전체</strong>
          <table>
            <thead>
              <tr>
                <th>번호</th>
                <th>구분</th>
                <th>일자</th>
                <th>부서</th>
                <th>금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {visiblePaymentHistory.map((payment) => (
                <tr key={`${payment.id}-${payment.date}`}>
                  <td>{payment.id}</td>
                  <td>{payment.source}</td>
                  <td>{payment.date}</td>
                  <td>{payment.department}</td>
                  <td>{payment.amount}</td>
                  <td><StatusPill value={payment.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer className="vendor-detail-actions">
        <label className="vendor-deactivate-reason">
          비활성 사유
          <input aria-label="거래처 비활성 사유 입력" onChange={(event) => setDeactivateReason(event.currentTarget.value)} value={deactivateReason} />
        </label>
        <button className="save" disabled={isEmpty} onClick={() => onSave(draft)} type="button">수정</button>
        <button className="danger" disabled={isEmpty || selected.상태 === "비활성"} onClick={() => onDeactivate(deactivateReason.trim() || "운영자 수동 비활성화")} type="button">비활성화</button>
      </footer>
    </aside>
  );
}

function ReportsBody({ currentUser, page }: { currentUser: AuthUser; page: PageDefinition }) {
  const reportTypes = ["종합", "지급", "승인", "예산"];
  const [reportType, setReportType] = useState("종합");
  const [period, setPeriod] = useState("2024-05-01 ~ 2024-05-31");
  const [departmentFilter, setDepartmentFilter] = useState("전체 부서");
  const [vendorFilter, setVendorFilter] = useState("전체 거래처");
  const [reports, setReports] = useState<TableRow[]>(() => reportRows.map((row) => ({ ...row })));
  const [reportMessage, setReportMessage] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSort, setReportSort] = useState<"latest" | "name">("latest");
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(20);
  const [reportTotal, setReportTotal] = useState(reportRows.length);
  const [reportRefreshVersion, setReportRefreshVersion] = useState(0);
  const [selectedReportName, setSelectedReportName] = useState(reportRows[0]?.보고서명 ?? "");
  const [reportDrilldown, setReportDrilldown] = useState<ReportDrilldownState | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsMutating, setReportsMutating] = useState(false);
  const [auditLogSearch, setAuditLogSearch] = useState("");
  const [auditLogResult, setAuditLogResult] = useState<AuditLogSearchResult | null>(null);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const canReadAuditLogs = canUseAction(currentUser, "audit:read") || canUseAction(currentUser, "system:manage");
  const departmentOptions = getReportFilterOptions(reports, "부서", [...budgetRows, ...approvalRows, ...paymentRows], "부서", "전체 부서");
  const vendorOptions = getReportFilterOptions(reports, "거래처", [...vendorRows, ...paymentRows, ...disbursementRows], "거래처", "전체 거래처");
  const reportQueryFilters = useMemo(() => ({
    ...(reportType !== "종합" ? { 유형: reportType } : {}),
    ...(departmentFilter !== "전체 부서" ? { 부서: departmentFilter } : {}),
    ...(vendorFilter !== "전체 거래처" ? { 거래처: vendorFilter } : {}),
  }), [departmentFilter, reportType, vendorFilter]);
  const reportQueryFilterKey = JSON.stringify(reportQueryFilters);
  const filteredReports = reports;
  const selectedReport = filteredReports.find((report) => report.보고서명 === selectedReportName) ?? filteredReports[0] ?? null;

  useEffect(() => {
    setReportPage(1);
  }, [reportPageSize, reportQueryFilterKey, reportSearch, reportSort]);

  useEffect(() => {
    let active = true;
    setReportsLoading(true);
    erpApi.listPageRows("reports", {
      page: reportPage,
      pageSize: reportPageSize,
      search: reportSearch.trim(),
      filters: Object.keys(reportQueryFilters).length > 0 ? reportQueryFilters : undefined,
      sort: reportSort === "latest" ? encodeSort("생성일시", "desc") : encodeSort("보고서명", "asc"),
    })
      .then((response) => {
        if (!active) return;
        setReports(response.data.rows);
        setReportTotal(response.data.total);
        if (response.data.rows.length > 0) {
          setSelectedReportName((current) => (response.data.rows.some((report) => report.보고서명 === current) ? current : response.data.rows[0].보고서명));
        } else {
          setSelectedReportName("");
        }
        setReportMessage(`보고서 ${response.data.total}건 중 ${response.data.rows.length}건을 backend 조건으로 조회했습니다.`);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReports([]);
        setReportTotal(0);
        setReportMessage(`보고서 목록 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      })
      .finally(() => {
        if (active) setReportsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reportPage, reportPageSize, reportQueryFilterKey, reportRefreshVersion, reportSearch, reportSort]);

  useEffect(() => {
    if (!canReadAuditLogs) return;
    let active = true;
    setAuditLogsLoading(true);
    erpApi.listAuditLogs({ pageSize: 8 })
      .then((response) => {
        if (!active) return;
        setAuditLogResult(response.data);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReportMessage(`감사 로그 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      })
      .finally(() => {
        if (active) setAuditLogsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canReadAuditLogs]);

  const refreshAuditLogs = async () => {
    if (!canReadAuditLogs) return;
    setAuditLogsLoading(true);
    try {
      const response = await erpApi.listAuditLogs({ search: auditLogSearch.trim(), pageSize: 8 });
      setAuditLogResult(response.data);
      setReportMessage(`감사 로그 ${response.data.total}건 중 ${response.data.rows.length}건을 조회했습니다.`);
    } catch (error) {
      setReportMessage(`감사 로그 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  const generateReport = async () => {
    const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    const filterSuffix = [departmentFilter, vendorFilter].filter((value) => !value.startsWith("전체")).join(" ");
    const reportName = `${period.slice(0, 7)} ${reportType} 보고서${filterSuffix ? ` (${filterSuffix})` : ""}`;
    const newReport = {
      보고서명: reportName,
      유형: reportType,
      기간: period,
      생성일시: generatedAt,
      생성자: currentUser.name,
      부서: departmentFilter,
      거래처: vendorFilter,
      요약: `${reportType === "지급" ? "지급 실행 및 예정 건 자동 집계" : reportType === "승인" ? "승인 상태와 처리율 자동 집계" : reportType === "예산" ? "예산 사용률과 초과 위험 자동 집계" : "결제, 승인, 지급, 예산 종합 집계"} · ${departmentFilter} · ${vendorFilter}`,
      드릴다운JSON: JSON.stringify(buildLocalReportDrilldownSnapshot(reportName)),
      idempotencyKey: reportMutationKey("create", `${period.slice(0, 7)} ${reportType} 보고서 ${departmentFilter} ${vendorFilter}`),
    };
    setReportsMutating(true);
    try {
      const response = await erpApi.createPageRow("reports", newReport);
      const savedReport = response.data;
      setReports((current) => [savedReport, ...current.filter((report) => report.보고서명 !== savedReport.보고서명)]);
      setSelectedReportName(savedReport.보고서명);
      setReportMessage(`${savedReport.보고서명} 생성 완료`);
    } catch (error) {
      setReportMessage(`보고서 생성 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setReportsMutating(false);
    }
  };

  const downloadSelectedReport = async (format: ReportDownloadFormat) => {
    if (!selectedReport) {
      setReportMessage("다운로드할 보고서를 먼저 선택하세요.");
      return false;
    }
    setReportsMutating(true);
    try {
      const response = await erpApi.downloadReport(selectedReport.보고서명, format);
      triggerBase64Download(response.data.fileName, response.data.contentType, response.data.contentBase64);
      setReportMessage(`현재 보고서 ${format === "csv" ? "CSV" : "PDF"} 다운로드를 시작했습니다.`);
      return true;
    } catch (error) {
      setReportMessage(`보고서 다운로드 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      return false;
    } finally {
      setReportsMutating(false);
    }
  };

  const updateSavedReport = async (reportName: string, patch: TableRow) => {
    const target = reports.find((report) => report.보고서명 === reportName);
    if (!target) {
      setReportMessage("수정할 보고서를 먼저 선택하세요.");
      return false;
    }
    const nextName = (patch.보고서명 || reportName).trim();
    if (!nextName) {
      setReportMessage("보고서명은 비워둘 수 없습니다.");
      return false;
    }
    if (nextName !== reportName && reports.some((report) => report.보고서명 === nextName)) {
      setReportMessage("같은 이름의 보고서가 이미 있습니다.");
      return false;
    }
    setReportsMutating(true);
    try {
      const updatePayload = {
        ...patch,
        보고서명: nextName,
        rowVersion: reportRowVersion(target),
        보고서RowVersion: reportRowVersion(target),
        idempotencyKey: reportMutationKey("update", reportName, target),
      };
      const response = await erpApi.updatePageRow("reports", reportName, updatePayload);
      const savedReport = response.data ?? { ...target, ...updatePayload };
      setReports((current) => current.map((report) => (report.보고서명 === reportName ? savedReport : report)));
      setSelectedReportName(savedReport.보고서명);
      setReportMessage(`${savedReport.보고서명} 보고서 설정이 저장되었습니다.`);
      return true;
    } catch (error) {
      setReportMessage(`보고서 설정 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      return false;
    } finally {
      setReportsMutating(false);
    }
  };

  const deleteSavedReport = async (reportName: string) => {
    const target = reports.find((report) => report.보고서명 === reportName);
    if (!target) {
      setReportMessage("삭제할 보고서를 먼저 선택하세요.");
      return false;
    }
    setReportsMutating(true);
    try {
      await erpApi.deletePageRow("reports", reportName, {
        rowVersion: reportRowVersion(target),
        보고서RowVersion: reportRowVersion(target),
        idempotencyKey: reportMutationKey("delete", reportName, target),
      });
      const nextReports = reports.filter((report) => report.보고서명 !== reportName);
      setReports(nextReports);
      setSelectedReportName(nextReports[0]?.보고서명 ?? "");
      setReportMessage(`${reportName} 보고서를 삭제했습니다.`);
      return true;
    } catch (error) {
      setReportMessage(`보고서 삭제 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      return false;
    } finally {
      setReportsMutating(false);
    }
  };

  return (
    <div className="reports-management-page">
      <section className="management-main-column">
        <ReportsToolbar
          activeType={reportType}
          departmentFilter={departmentFilter}
          departmentOptions={departmentOptions}
          isBusy={reportsLoading || reportsMutating}
          onDownload={downloadSelectedReport}
          rows={filteredReports}
          onGenerate={generateReport}
          onDepartmentCycle={() => {
            const next = departmentOptions[(departmentOptions.indexOf(departmentFilter) + 1) % departmentOptions.length] ?? "전체 부서";
            setDepartmentFilter(next);
            setReportMessage(`${next} 보고서 필터를 적용했습니다.`);
          }}
          onMessage={setReportMessage}
          onPeriodCycle={() => setPeriod((current) => (current.startsWith("2024-05") ? "2024-06-01 ~ 2024-06-30" : "2024-05-01 ~ 2024-05-31"))}
          onResetFilters={() => {
            setDepartmentFilter("전체 부서");
            setVendorFilter("전체 거래처");
            setReportType("종합");
            setReportMessage("보고서 상세 필터를 초기화했습니다.");
          }}
          onTypeChange={setReportType}
          onVendorCycle={() => {
            const next = vendorOptions[(vendorOptions.indexOf(vendorFilter) + 1) % vendorOptions.length] ?? "전체 거래처";
            setVendorFilter(next);
            setReportMessage(`${next} 보고서 필터를 적용했습니다.`);
          }}
          period={period}
          reportTypes={reportTypes}
          vendorFilter={vendorFilter}
          vendorOptions={vendorOptions}
        />
        {reportMessage && <small className="panel-action-message report-message">{reportMessage}</small>}
        <section className="kpi-row management-kpis reports-kpis">
          {page.kpis.map((kpi) => (
            <KpiCard item={kpi} key={kpi.label} />
          ))}
        </section>
        <div className="reports-chart-grid">
          <ReportsLineChart
            values={getMonthlyDisbursementValues()}
            onDrilldown={(label) => {
              setReportDrilldown(getReportDrilldown(label, "monthly", selectedReport));
              setReportMessage(`${selectedReport?.보고서명 ?? "선택 보고서"} 기준 ${label} 지급 추이 원천 데이터 테이블을 열었습니다.`);
            }}
          />
          <ReportsDepartmentBars
            items={getDepartmentSpendItems()}
            onDrilldown={(label) => {
              setReportDrilldown(getReportDrilldown(label, "department", selectedReport));
              setReportMessage(`${selectedReport?.보고서명 ?? "선택 보고서"} 기준 ${label} 부서 지출 원천 데이터를 열었습니다.`);
            }}
          />
          <ReportsDonutCard
            items={getApprovalStatusItems()}
            onDrilldown={(label) => {
              setReportDrilldown(getReportDrilldown(label, "approval", selectedReport));
              setReportMessage(`${selectedReport?.보고서명 ?? "선택 보고서"} 기준 ${label} 승인 상태 원천 데이터를 열었습니다.`);
            }}
          />
        </div>
        {reportDrilldown && <ReportDrilldownPanel drilldown={reportDrilldown} onClose={() => setReportDrilldown(null)} />}
        <ReportsTable
          isLoading={reportsLoading}
          page={reportPage}
          pageSize={reportPageSize}
          rows={filteredReports}
          searchTerm={reportSearch}
          selectedReportName={selectedReport?.보고서명 ?? ""}
          sortMode={reportSort}
          total={reportTotal}
          onPageChange={setReportPage}
          onPageSizeChange={setReportPageSize}
          onSearchChange={setReportSearch}
          onSelectReport={(report) => {
            setSelectedReportName(report.보고서명);
            setReportMessage(`${report.보고서명} 상세 미리보기를 열었습니다.`);
          }}
          onSortChange={() => {
            setReportSort((current) => (current === "latest" ? "name" : "latest"));
            setReportMessage(`보고서 목록을 ${reportSort === "latest" ? "보고서명순" : "최신순"}으로 정렬했습니다.`);
          }}
        />
        {canReadAuditLogs && (
          <AuditLogSearchCard
            isLoading={auditLogsLoading}
            onRefresh={refreshAuditLogs}
            onSearchChange={setAuditLogSearch}
            result={auditLogResult}
            search={auditLogSearch}
          />
        )}
      </section>
      <ReportsSideColumn
        activeType={reportType}
        currentUser={currentUser}
        onDeleteReport={deleteSavedReport}
        onDownload={downloadSelectedReport}
        onUpdateReport={updateSavedReport}
        reports={reports}
        selectedReport={selectedReport}
      />
    </div>
  );
}

function ReportsToolbar({
  activeType,
  departmentFilter,
  departmentOptions,
  isBusy,
  onDownload,
  onDepartmentCycle,
  rows,
  onGenerate,
  onMessage,
  onPeriodCycle,
  onResetFilters,
  onTypeChange,
  onVendorCycle,
  period,
  reportTypes,
  vendorFilter,
  vendorOptions,
}: {
  activeType: string;
  departmentFilter: string;
  departmentOptions: string[];
  isBusy: boolean;
  onDownload: (format: ReportDownloadFormat) => Promise<boolean>;
  onDepartmentCycle: () => void;
  rows: TableRow[];
  onGenerate: () => Promise<void>;
  onMessage: (message: string) => void;
  onPeriodCycle: () => void;
  onResetFilters: () => void;
  onTypeChange: (type: string) => void;
  onVendorCycle: () => void;
  period: string;
  reportTypes: string[];
  vendorFilter: string;
  vendorOptions: string[];
}) {
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const handleDownloadCsv = async () => {
    await onDownload("csv");
    setDownloadMenuOpen(false);
  };
  const handleDownloadPdf = async () => {
    await onDownload("pdf");
    setDownloadMenuOpen(false);
  };
  return (
    <div className="management-toolbar reports-toolbar">
      <div className="management-filter-group reports-filter-group">
        <button className="management-filter date" onClick={onPeriodCycle} type="button">
          {period}
          <Calendar size={18} />
        </button>
        <button className="management-filter" onClick={onDepartmentCycle} title={`${departmentOptions.length}개 부서 필터`} type="button">
          {departmentFilter}
          <ChevronDown size={16} />
        </button>
        <button className="management-filter" onClick={onVendorCycle} title={`${vendorOptions.length}개 거래처 필터`} type="button">
          {vendorFilter}
          <ChevronDown size={16} />
        </button>
        <div className="report-type-tabs">
          {reportTypes.map((item) => (
            <button className={activeType === item ? "active" : undefined} key={item} onClick={() => onTypeChange(item)} type="button">
              {item}
            </button>
          ))}
        </div>
        <button className="management-filter compact" onClick={() => setFilterOpen((current) => !current)} type="button">
          <Filter size={18} />
          필터
        </button>
      </div>
      <div className="management-toolbar-actions">
        <button className="management-primary-button" disabled={isBusy} onClick={() => void onGenerate()} type="button">보고서 생성</button>
        <button className="management-icon-button" aria-expanded={downloadMenuOpen} aria-label="다운로드" onClick={() => setDownloadMenuOpen((current) => !current)} type="button">
          <Download size={18} />
        </button>
      </div>
      {filterOpen && (
        <DetailFilterPanel
          title="보고서 상세 필터"
          fields={[
            { label: "기간", value: period },
            { label: "부서", value: departmentFilter },
            { label: "거래처", value: vendorFilter },
            { label: "유형", value: activeType },
            { label: "건수", value: `${rows.length}개` },
          ]}
          onApply={() => {
            onMessage(`${period}, ${departmentFilter}, ${vendorFilter}, ${activeType} 보고서 필터를 적용했습니다.`);
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
          onReset={() => {
            onResetFilters();
          }}
        />
      )}
      {downloadMenuOpen && (
        <div className="download-menu" aria-label="보고서 다운로드 메뉴">
          <button onClick={handleDownloadCsv} type="button">CSV 다운로드</button>
          <button onClick={handleDownloadPdf} type="button">PDF 다운로드</button>
        </div>
      )}
    </div>
  );
}

function ReportsLineChart({ onDrilldown, values }: { values: number[]; onDrilldown: (label: string) => void }) {
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${54 + index * 74},${220 - (value / max) * 160}`);
  return (
    <section className="erp-card reports-chart-card">
      <CardHeader title="월별 지급 추이 (단위: 원)" action="월별" onAction={() => onDrilldown("전체 월별 지급 추이")} />
      <svg className="reports-line-svg" viewBox="0 0 470 250" role="img" aria-label="월별 지급 추이">
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <line className="grid-line" key={line} x1="42" x2="450" y1={38 + line * 38} y2={38 + line * 38} />
        ))}
        <polyline className="report-line" points={points.join(" ")} />
        {points.map((point, index) => {
          const [cx, cy] = point.split(",");
          return <circle className="report-dot" cx={cx} cy={cy} key={point} onClick={() => onDrilldown(`${index + 1}월 지급 추이`)} r="5" />;
        })}
      </svg>
      <div className="reports-axis-labels">
        {["12월", "1월", "2월", "3월", "4월", "5월"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}

function ReportsDepartmentBars({ items, onDrilldown }: { items: Array<[string, string, number]>; onDrilldown: (label: string) => void }) {
  return (
    <section className="erp-card reports-chart-card">
      <CardHeader title="부서별 지출 (단위: 원)" action="상위 6개" onAction={() => onDrilldown("상위 6개 부서")} />
      <div className="reports-bar-list">
        {items.map(([name, value, width]) => (
          <button key={name} onClick={() => onDrilldown(name)} type="button">
            <span>{name}</span>
            <i style={{ width: `${width}%` }} />
            <b>{value}</b>
          </button>
        ))}
      </div>
      <div className="reports-bar-axis">
        {["0", "20M", "40M", "60M"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}

function ReportsDonutCard({ items, onDrilldown }: { items: Array<[string, string, string]>; onDrilldown: (label: string) => void }) {
  return (
    <section className="erp-card reports-chart-card reports-donut-card">
      <CardHeader title="승인 상태 (단위: 건)" />
      <div className="reports-donut-wrap">
        <div className="reports-donut">
          <span>총 {approvalRows.length}건</span>
        </div>
        <div className="reports-donut-legend">
          {items.map(([label, value, color]) => (
            <button key={label} onClick={() => onDrilldown(label)} type="button">
              <i className={color} />
              <span>{label}</span>
              <b>{value}</b>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReportDrilldownPanel({ drilldown, onClose }: { drilldown: ReportDrilldownState; onClose: () => void }) {
  return (
    <section className="erp-card report-drilldown-panel" aria-label="보고서 원천 데이터">
      <header>
        <div>
          <strong>{drilldown.title}</strong>
          <span>{drilldown.source} · {drilldown.rows.length}건</span>
        </div>
        <button aria-label="원천 데이터 닫기" onClick={onClose} type="button">
          <X size={17} />
        </button>
      </header>
      <div>
        <table>
          <thead>
            <tr>
              {drilldown.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drilldown.rows.map((row, rowIndex) => (
              <tr key={`${drilldown.title}-${rowIndex}`}>
                {drilldown.columns.map((column) => (
                  <td key={column}>{isStatusColumn(column) ? <StatusPill value={row[column] ?? ""} /> : row[column] ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportsTable({
  isLoading,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
  onSelectReport,
  onSortChange,
  page,
  pageSize,
  rows,
  searchTerm,
  selectedReportName,
  sortMode,
  total,
}: {
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSearchChange: (value: string) => void;
  onSelectReport: (report: TableRow) => void;
  onSortChange: () => void;
  page: number;
  pageSize: number;
  rows: TableRow[];
  searchTerm: string;
  selectedReportName: string;
  sortMode: "latest" | "name";
  total: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows;
  return (
    <section className="erp-card reports-table-card">
      <header className="reports-table-head">
        <strong>보고서 목록</strong>
        <div>
          <button onClick={onSortChange} type="button">{sortMode === "latest" ? "최신순" : "보고서명순"} <ChevronDown size={15} /></button>
          <label className="report-search-inline">
            <input aria-label="보고서명 검색" onChange={(event) => onSearchChange(event.currentTarget.value)} placeholder="보고서명 검색" value={searchTerm} />
            <Search size={16} />
          </label>
        </div>
      </header>
      <table className="reports-table">
        <thead>
          <tr>
            {["보고서명", "유형", "기간", "생성일시", "생성자", "요약", "상세 보기"].map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={7}>{isLoading ? "보고서를 조회 중입니다." : "조건에 맞는 보고서가 없습니다."}</td>
            </tr>
          ) : pageRows.map((row) => (
            <tr className={row.보고서명 === selectedReportName ? "selected" : undefined} key={row.보고서명}>
              <td>
                <FileText size={15} />
                {row.보고서명}
              </td>
              <td>{row.유형}</td>
              <td>{row.기간}</td>
              <td>{row.생성일시}</td>
              <td>{row.생성자}</td>
              <td>{row.요약}</td>
              <td>
                <button onClick={() => onSelectReport(row)} type="button">상세 보기</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="management-table-footer">
        <span>{isLoading ? "조회 중" : `전체 ${total}개`}</span>
        <div>
          <button disabled={page <= 1 || isLoading} onClick={() => onPageChange(1)} type="button">≪</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 4).map((pageNumber) => (
            <button className={pageNumber === page ? "active" : undefined} disabled={isLoading} key={pageNumber} onClick={() => onPageChange(pageNumber)} type="button">{pageNumber}</button>
          ))}
          <button disabled={page >= pageCount || isLoading} onClick={() => onPageChange(pageCount)} type="button">≫</button>
        </div>
        <button className="rows-select" disabled={isLoading} onClick={() => onPageSizeChange(pageSize === 10 ? 20 : 10)} type="button">{pageSize}개씩</button>
      </footer>
    </section>
  );
}

function AuditLogSearchCard({
  isLoading,
  onRefresh,
  onSearchChange,
  result,
  search,
}: {
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onSearchChange: (value: string) => void;
  result: AuditLogSearchResult | null;
  search: string;
}) {
  const rows = result?.rows ?? [];
  return (
    <section className="erp-card audit-log-search-card">
      <header>
        <div>
          <strong>감사 로그 조회</strong>
          <span>{result?.accessScope === "external_auditor_read_only" ? "외부 감사 읽기 전용" : "관리자 감사 조회"}</span>
        </div>
        <button aria-label="감사 로그 새로고침" disabled={isLoading} onClick={() => void onRefresh()} type="button">
          <RefreshCw size={16} />
        </button>
      </header>
      <div className="audit-log-search-controls">
        <label>
          검색
          <input aria-label="감사 로그 검색어" onChange={(event) => onSearchChange(event.currentTarget.value)} value={search} />
        </label>
        <button aria-label="감사 로그 검색" disabled={isLoading} onClick={() => void onRefresh()} type="button">
          <Search size={16} />
        </button>
      </div>
      <div className="audit-log-retention">
        <span>{result?.retention.disposition ?? "감사 로그 보관 정책"}</span>
        <span>{result?.rawValuePolicy ?? "원문 변경 값은 응답에서 제외됩니다."}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>일시</th>
            <th>액션</th>
            <th>대상</th>
            <th>작업자</th>
            <th>requestId</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>{isLoading ? "조회 중입니다." : "감사 로그가 없습니다."}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.id}>
              <td>{row.time.slice(0, 16).replace("T", " ")}</td>
              <td>
                <b>{row.action}</b>
                <small>{row.summary}</small>
              </td>
              <td>{row.entityType}</td>
              <td>{row.actor}<small>{row.actorDepartment}</small></td>
              <td>{row.requestId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ReportsSideColumn({
  activeType,
  currentUser,
  onDeleteReport,
  onDownload,
  onUpdateReport,
  reports,
  selectedReport,
}: {
  activeType: string;
  currentUser: AuthUser;
  onDeleteReport: (reportName: string) => Promise<boolean>;
  onDownload: (format: ReportDownloadFormat) => Promise<boolean>;
  onUpdateReport: (reportName: string, patch: TableRow) => Promise<boolean>;
  reports: TableRow[];
  selectedReport: TableRow | null;
}) {
  const [exportMessage, setExportMessage] = useState("");
  const [showAllReports, setShowAllReports] = useState(false);
  const [favoriteReportNames, setFavoriteReportNames] = useState<Set<string>>(new Set());
  const [favoriteReportRows, setFavoriteReportRows] = useState<Record<string, TableRow>>({});
  const [favoriteBusyReportName, setFavoriteBusyReportName] = useState("");
  const [favoriteReportsLoading, setFavoriteReportsLoading] = useState(false);
  const [reportMenuName, setReportMenuName] = useState("");
  const [reportActionDraft, setReportActionDraft] = useState({
    name: "",
    access: "부서 공유",
  });
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({
    recipient: "재무팀",
    cycle: "매주 금요일",
    time: "17:00",
    format: "PDF",
  });
  const [schedules, setSchedules] = useState<ReportScheduleDto[]>([]);
  useEffect(() => {
    let active = true;
    erpApi.listReportSchedules()
      .then((response) => {
        if (!active) return;
        setSchedules(response.data);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setExportMessage(`예약 발송 목록 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setFavoriteReportsLoading(true);
    erpApi.listPageRows("favorites", { page: 1, pageSize: 100, sort: "순서:asc" })
      .then((response) => {
        if (!active) return;
        const reportFavorites = response.data.rows.filter((row) => row.유형 === "보고서" || row.대상화면 === "reports");
        setFavoriteReportRows(Object.fromEntries(reportFavorites.map((row) => [row.항목명, row])));
        setFavoriteReportNames(new Set(reportFavorites.filter((row) => row.상태 !== "비활성").map((row) => row.항목명)));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setExportMessage(`보고서 즐겨찾기 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      })
      .finally(() => {
        if (active) setFavoriteReportsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser.name]);
  const handleCsvDownload = async () => {
    const ok = await onDownload("csv");
    setExportMessage(ok ? "엑셀 호환 파일을 backend에서 생성했습니다." : "엑셀 파일 생성에 실패했습니다.");
  };
  const handlePdfDownload = async () => {
    const ok = await onDownload("pdf");
    setExportMessage(ok ? "PDF 파일을 backend에서 생성했습니다." : "PDF 파일 생성에 실패했습니다.");
  };
  const scheduleRecipients = () =>
    scheduleDraft.recipient
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const saveSchedule = async () => {
    const recipients = scheduleRecipients();
    if (recipients.length === 0) {
      setExportMessage("예약 수신자는 1개 이상 필요합니다.");
      return;
    }
    const editingSchedule = schedules.find((schedule) => schedule.id === editingScheduleId) ?? null;
    const input = {
      reportName: selectedReport?.보고서명 ?? `${activeType} 보고서`,
      reportType: selectedReport?.유형 ?? activeType,
      cycle: scheduleDraft.cycle,
      time: scheduleDraft.time,
      format: scheduleDraft.format,
      recipients,
      isActive: true,
      ...(editingSchedule ? { rowVersion: editingSchedule.rowVersion } : {}),
      idempotencyKey: reportScheduleMutationKey(editingSchedule ? "update" : "create", editingSchedule),
    };
    setScheduleBusy(true);
    try {
      const response = editingScheduleId ? await erpApi.updateReportSchedule(editingScheduleId, input) : await erpApi.createReportSchedule(input);
      const saved = response.data;
      if (saved) {
        setSchedules((current) => {
          const withoutCurrent = current.filter((schedule) => schedule.id !== saved.id);
          return [saved, ...withoutCurrent].slice(0, 10);
        });
      }
      setEditingScheduleId("");
      setExportMessage(`${input.reportType} 보고서 예약 발송이 ${editingScheduleId ? "수정" : "추가"}되었습니다.`);
    } catch (error) {
      setExportMessage(`예약 발송 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setScheduleBusy(false);
    }
  };
  const editSchedule = (schedule: ReportScheduleDto) => {
    setEditingScheduleId(schedule.id);
    setScheduleDraft({
      recipient: schedule.recipients.join(", "),
      cycle: schedule.cycle,
      time: schedule.time,
      format: schedule.format,
    });
    setExportMessage(`${schedule.reportName} 예약 편집값을 불러왔습니다.`);
  };
  const toggleSchedule = async (schedule: ReportScheduleDto) => {
    setScheduleBusy(true);
    try {
      const response = await erpApi.updateReportSchedule(schedule.id, {
        isActive: !schedule.isActive,
        rowVersion: schedule.rowVersion,
        idempotencyKey: reportScheduleMutationKey(schedule.isActive ? "pause" : "resume", schedule),
      });
      if (response.data) {
        setSchedules((current) => current.map((item) => (item.id === response.data?.id ? response.data : item)));
      }
      setExportMessage(`${schedule.reportName} 예약 발송을 ${schedule.isActive ? "중지" : "재개"}했습니다.`);
    } catch (error) {
      setExportMessage(`예약 발송 상태 변경 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setScheduleBusy(false);
    }
  };
  const toggleReportFavorite = async (report: TableRow) => {
    if (favoriteReportsLoading) {
      setExportMessage("보고서 즐겨찾기를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    const reportName = report.보고서명;
    const existingFavorite = favoriteReportRows[reportName];
    const isFavorite = favoriteReportNames.has(reportName);
    const version = favoriteRowVersion(existingFavorite);
    setFavoriteBusyReportName(reportName);
    try {
      if (isFavorite) {
        const response = await erpApi.deletePageRow("favorites", reportName, {
          rowVersion: version,
          즐겨찾기RowVersion: version,
          idempotencyKey: favoriteMutationKey("delete-report", reportName, version),
        });
        setFavoriteReportNames((current) => {
          const next = new Set(current);
          next.delete(reportName);
          return next;
        });
        if (response.data) {
          setFavoriteReportRows((current) => ({ ...current, [reportName]: response.data as TableRow }));
        }
        setExportMessage(`${reportName} 보고서 즐겨찾기를 해제하고 backend FavoriteItem을 비활성화했습니다.`);
        return;
      }

      const favoritePayload: TableRow = {
        항목명: reportName,
        유형: "보고서",
        설명: "#reports",
        대상화면: "reports",
        최근사용: report.생성일시 ?? "-",
        소유자: currentUser.name,
        상태: "활성",
        순서: String(Object.keys(favoriteReportRows).length + 1),
        필터: [`보고서: ${reportName}`, report.유형 ? `유형: ${report.유형}` : "", report.기간 ? `기간: ${report.기간}` : ""].filter(Boolean).join(", "),
        필터JSON: JSON.stringify({ reportName, reportType: report.유형 ?? activeType, period: report.기간 ?? "" }),
        공유: report.공유권한 ?? report.공유 ?? "개인",
      };
      const response = existingFavorite
        ? await erpApi.updatePageRow("favorites", reportName, {
            ...favoritePayload,
            rowVersion: version,
            즐겨찾기RowVersion: version,
            idempotencyKey: favoriteMutationKey("restore-report", reportName, version),
          })
        : await erpApi.createPageRow("favorites", {
            ...favoritePayload,
            idempotencyKey: favoriteMutationKey("create-report", reportName),
          });
      if (response.data) {
        setFavoriteReportRows((current) => ({ ...current, [reportName]: response.data as TableRow }));
      }
      setFavoriteReportNames((current) => {
        const next = new Set(current);
        next.add(reportName);
        return next;
      });
      setExportMessage(`${reportName} 보고서를 ${currentUser.name} 사용자 즐겨찾기에 저장했습니다.`);
    } catch (error) {
      setExportMessage(`보고서 즐겨찾기 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoriteBusyReportName("");
    }
  };
  const openSavedReportMenu = (reportName: string) => {
    const target = reports.find((report) => report.보고서명 === reportName);
    setReportMenuName(reportName);
    setReportActionDraft({
      name: target?.보고서명 ?? reportName,
      access: target?.공유권한 ?? target?.공유 ?? "부서 공유",
    });
    setExportMessage(`${reportName} 이름 변경, 삭제, 권한 변경 메뉴를 열었습니다.`);
  };
  const saveReportMenu = async () => {
    if (!reportMenuName) return;
    const ok = await onUpdateReport(reportMenuName, {
      보고서명: reportActionDraft.name.trim(),
      공유권한: reportActionDraft.access,
    });
    if (ok) {
      setExportMessage(`${reportActionDraft.name.trim()} 보고서 이름/공유 권한을 저장했습니다.`);
      setReportMenuName("");
    }
  };
  const deleteReportFromMenu = async () => {
    if (!reportMenuName) return;
    const ok = await onDeleteReport(reportMenuName);
    if (ok) {
      setExportMessage(`${reportMenuName} 보고서를 삭제했습니다.`);
      setReportMenuName("");
    }
  };
  const visibleReports = showAllReports ? reports : reports.slice(0, 5);

  return (
    <aside className="reports-side-column">
      <section className="erp-card schedule-card">
        <header>
          <strong>예약 발송</strong>
          <button disabled={scheduleBusy} onClick={() => void saveSchedule()} type="button">
            <Plus size={16} />
            {editingScheduleId ? "수정 저장" : "추가"}
          </button>
        </header>
        <div className="schedule-draft-grid">
          <input aria-label="예약 수신자 입력" onChange={(event) => setScheduleDraft({ ...scheduleDraft, recipient: event.currentTarget.value })} value={scheduleDraft.recipient} />
          <select aria-label="예약 주기 선택" onChange={(event) => setScheduleDraft({ ...scheduleDraft, cycle: event.currentTarget.value })} value={scheduleDraft.cycle}>
            {["매일", "매주 금요일", "매월 1일", "매월 말일"].map((cycle) => (
              <option key={cycle} value={cycle}>{cycle}</option>
            ))}
          </select>
          <input aria-label="예약 시간 입력" onChange={(event) => setScheduleDraft({ ...scheduleDraft, time: event.currentTarget.value })} type="time" value={scheduleDraft.time} />
          <select aria-label="예약 형식 선택" onChange={(event) => setScheduleDraft({ ...scheduleDraft, format: event.currentTarget.value })} value={scheduleDraft.format}>
            {["PDF", "CSV", "PDF+CSV"].map((format) => (
              <option key={format} value={format}>{format}</option>
            ))}
          </select>
        </div>
        {schedules.map((schedule) => (
          <article key={schedule.id}>
            <Clock3 size={16} />
            <p>
              <b>{schedule.title}</b>
              <span>{schedule.cycle} {schedule.time} · {schedule.format}</span>
              <small>{schedule.recipientLabel}</small>
            </p>
            <div className="schedule-actions">
              <button onClick={() => editSchedule(schedule)} type="button">수정</button>
              <button onClick={() => void toggleSchedule(schedule)} type="button">{schedule.isActive ? "중지" : "재개"}</button>
            </div>
            <i className={schedule.isActive ? "on" : ""} />
          </article>
        ))}
      </section>
      <section className="erp-card export-card">
        <strong>내보내기</strong>
        <button onClick={() => void handleCsvDownload()} type="button"><Database size={20} />엑셀 다운로드</button>
        <button onClick={() => void handlePdfDownload()} type="button"><FileText size={20} />PDF 다운로드</button>
        {exportMessage && <small className="export-message">{exportMessage}</small>}
      </section>
      <section className="erp-card saved-report-card">
        <header>
          <strong>저장된 보고서</strong>
          <button onClick={() => setShowAllReports((current) => !current)} type="button">{showAllReports ? "접기" : "전체 보기"}</button>
        </header>
        {visibleReports.map((report) => (
          <article key={`${report.보고서명}-${report.생성일시}`}>
            <span>{report.보고서명}</span>
            <button
              aria-label={`${report.보고서명} 즐겨찾기`}
              disabled={favoriteReportsLoading || favoriteBusyReportName === report.보고서명}
              onClick={() => void toggleReportFavorite(report)}
              type="button"
            >
              <Star className={favoriteReportNames.has(report.보고서명) ? "filled" : undefined} size={16} />
            </button>
            <button aria-label={`${report.보고서명} 더보기`} onClick={() => openSavedReportMenu(report.보고서명)} type="button">⋮</button>
          </article>
        ))}
        {reportMenuName && (
          <div className="saved-report-actions" aria-label="보고서 작업 메뉴">
            <label>
              보고서명
              <input
                aria-label="보고서명 수정"
                onChange={(event) => setReportActionDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                value={reportActionDraft.name}
              />
            </label>
            <label>
              공유 권한
              <select
                aria-label="보고서 공유 권한 선택"
                onChange={(event) => setReportActionDraft((current) => ({ ...current, access: event.currentTarget.value }))}
                value={reportActionDraft.access}
              >
                {["개인", "부서 공유", "재무팀 공유", "관리자 전체"].map((access) => (
                  <option key={access} value={access}>{access}</option>
                ))}
              </select>
            </label>
            <div>
              <button onClick={() => void saveReportMenu()} type="button">
                <CheckCircle2 size={14} />
                저장
              </button>
              <button className="danger" onClick={() => void deleteReportFromMenu()} type="button">
                <Trash2 size={14} />
                삭제
              </button>
              <button onClick={() => setReportMenuName("")} type="button">닫기</button>
            </div>
          </div>
        )}
      </section>
      {selectedReport && <ReportPreviewCard report={selectedReport} />}
    </aside>
  );
}

function ReportPreviewCard({ report }: { report: TableRow }) {
  return (
    <section className="erp-card report-preview-card" aria-label="보고서 상세 미리보기">
      <strong>보고서 미리보기</strong>
      <dl>
        <dt>보고서명</dt>
        <dd>{report.보고서명}</dd>
        <dt>유형</dt>
        <dd>{report.유형}</dd>
        <dt>기간</dt>
        <dd>{report.기간}</dd>
        <dt>생성자</dt>
        <dd>{report.생성자}</dd>
      </dl>
      <p>{report.요약}</p>
    </section>
  );
}

function SettingsBody({ currentUser, page }: { currentUser: AuthUser; page: PageDefinition }) {
  const [activeTab, setActiveTab] = useState("결재 정책");
  const [approvalLimits, setApprovalLimits] = useState<ApprovalLimitRow[]>(initialApprovalLimits);
  const [approvalRules, setApprovalRules] = useState<ApprovalRuleSettings>(initialApprovalRules);
  const [departmentSettings, setDepartmentSettings] = useState<TableRow[]>(() => getInitialDepartmentSettings(budgetRows, initialRoleGroups));
  const [roleGroups, setRoleGroups] = useState<RolePermissionGroup[]>(initialRoleGroups);
  const [roleDraft, setRoleDraft] = useState<RoleGroupDraft>({
    name: "프로젝트 결재자",
    tag: "그룹",
    template: "승인 중심",
  });
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>(initialAssignedUsers);
  const [userDraft, setUserDraft] = useState<UserPermissionDraft>({
    groupId: initialRoleGroups[0].id,
    user: "정산담당자",
    role: "요청자",
  });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSetting[]>(initialNotificationSettings);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSetting[]>(initialIntegrationSettings);
  const [settingsHistory, setSettingsHistory] = useState<SettingsHistoryItem[]>(initialSettingsHistory);
  const [settingsMessage, setSettingsMessage] = useState("결재 정책, 권한, 알림, 연동 설정은 저장 즉시 신규 작업에 반영됩니다.");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [dataQualityRuns, setDataQualityRuns] = useState<DataQualityRunList | null>(null);
  const [dataQualityLoading, setDataQualityLoading] = useState(false);
  const [retentionSummary, setRetentionSummary] = useState<RetentionPolicySummary | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [accountLifecycleSummary, setAccountLifecycleSummary] = useState<AccountLifecycleSummary | null>(null);
  const [accountLifecycleLoading, setAccountLifecycleLoading] = useState(false);
  const [accountLifecycleReason, setAccountLifecycleReason] = useState("휴면/퇴사자 계정 운영 비활성화");
  const [financialReconciliationSummary, setFinancialReconciliationSummary] = useState<FinancialReconciliationSummary | null>(null);
  const [financialReconciliationLoading, setFinancialReconciliationLoading] = useState(false);
  const [manualRecoverySummary, setManualRecoverySummary] = useState<ManualRecoverySummary | null>(null);
  const [manualRecoveryLoading, setManualRecoveryLoading] = useState(false);
  const [financialControlReport, setFinancialControlReport] = useState<FinancialControlReport | null>(null);
  const [financialControlLoading, setFinancialControlLoading] = useState(false);
  const [permissionReviewReport, setPermissionReviewReport] = useState<PermissionReviewReport | null>(null);
  const [permissionReviewLoading, setPermissionReviewLoading] = useState(false);
  const [privacyAccessReport, setPrivacyAccessReport] = useState<PrivacyAccessReport | null>(null);
  const [privacyAccessLoading, setPrivacyAccessLoading] = useState(false);
  const [auditIntegrityReport, setAuditIntegrityReport] = useState<AuditIntegrityReport | null>(null);
  const [auditIntegrityLoading, setAuditIntegrityLoading] = useState(false);
  const [operationModeStatus, setOperationModeStatus] = useState<OperationModeStatus | null>(null);
  const [operationModeLoading, setOperationModeLoading] = useState(false);
  const [reportJobStatus, setReportJobStatus] = useState<ReportJobRunResult | null>(null);
  const [reportJobLoading, setReportJobLoading] = useState(false);
  const [performancePolicy, setPerformancePolicy] = useState<PerformancePolicyStatus | null>(null);
  const [performancePolicyLoading, setPerformancePolicyLoading] = useState(false);
  const [manualRecoveryDraft, setManualRecoveryDraft] = useState({
    targetCode: "",
    nextStatus: "오류",
    accountStatus: "확인 완료",
    scheduledDate: "",
    reason: "지급 상태 수동 복구",
    reviewReason: "수동 복구 2차 검토 승인",
  });
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicySummary | null>(null);
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [systemSettingVersions, setSystemSettingVersions] = useState<Partial<Record<SystemSettingKey, SystemSettingSnapshotMeta>>>({});
  const [settingsServerSnapshot, setSettingsServerSnapshot] = useState<SettingsServerSnapshot | null>(null);

  const currentSettingsSnapshot = (): SettingsServerSnapshot => cloneSettingsServerSnapshot({
    approvalLimits,
    approvalRules,
    departmentSettings,
    roleGroups,
    assignedUsers,
    notificationSettings,
    integrationSettings,
  });

  const updateSettingsServerSnapshot = (patch: Partial<SettingsServerSnapshot>) => {
    setSettingsServerSnapshot((current) => cloneSettingsServerSnapshot({ ...(current ?? currentSettingsSnapshot()), ...patch }));
  };

  const recordChange = (desc: string, tag: string) => {
    setSettingsHistory((current) => [
      {
        id: `history-${Date.now()}-${current.length}`,
        time: getSettingsTimestamp(),
        user: `${currentUser.name} (${currentUser.departmentName})`,
        desc,
        tag,
      },
      ...current,
    ]);
  };

  const refreshSettingsHistory = async (fallbackDesc?: string, fallbackTag?: string) => {
    try {
      const response = await erpApi.listSystemSettingHistory();
      if (response.data.length > 0) {
        setSettingsHistory(response.data);
        return;
      }
    } catch {
      // Fall back to an in-session history row so the operator still gets immediate feedback.
    }
    if (fallbackDesc && fallbackTag) recordChange(fallbackDesc, fallbackTag);
  };

  const refreshDataQualityRuns = async (showMessage = true) => {
    setDataQualityLoading(true);
    try {
      const response = await erpApi.listDataQualityRuns();
      setDataQualityRuns(response.data);
      if (showMessage) {
        const latest = response.data.runs[0];
        setSettingsMessage(
          latest
            ? "데이터 품질 이력 조회 완료: 최근 실행 critical " + latest.criticalCount + "건, warning " + latest.warningCount + "건."
            : "데이터 품질 실행 이력이 없습니다. 지금 실행으로 첫 리포트를 생성하세요.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage("데이터 품질 이력 조회 실패: " + (error instanceof Error ? error.message : "실행 이력을 불러오지 못했습니다."));
    } finally {
      setDataQualityLoading(false);
    }
  };

  const runDataQualityBatch = async () => {
    setDataQualityLoading(true);
    try {
      const response = await erpApi.runDataQualityJob();
      const refreshed = await erpApi.listDataQualityRuns();
      setDataQualityRuns(refreshed.data);
      setSettingsMessage(
        "데이터 품질 배치 완료: critical " + response.data.run.criticalCount + "건, warning " + response.data.run.warningCount + "건, 관리자 알림 " + response.data.notificationsCreated + "건.",
      );
      await refreshSettingsHistory("데이터 품질 정합성 배치 실행", "운영 변경");
    } catch (error) {
      setSettingsMessage("데이터 품질 배치 실패: " + (error instanceof Error ? error.message : "배치를 실행하지 못했습니다."));
    } finally {
      setDataQualityLoading(false);
    }
  };

  const downloadDataQualityReport = async (runId: string) => {
    setDataQualityLoading(true);
    try {
      const response = await erpApi.downloadDataQualityRun(runId);
      triggerBase64Download(response.data.fileName, response.data.contentType, response.data.contentBase64);
      setSettingsMessage("데이터 품질 리포트 다운로드 완료: " + response.data.fileName);
    } catch (error) {
      setSettingsMessage("데이터 품질 리포트 다운로드 실패: " + (error instanceof Error ? error.message : "리포트를 내려받지 못했습니다."));
    } finally {
      setDataQualityLoading(false);
    }
  };

  const refreshRetentionPolicy = async (showMessage = true) => {
    setRetentionLoading(true);
    try {
      const response = await erpApi.getRetentionPolicySummary();
      setRetentionSummary(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.actionRequired
            ? `보관 정책 점검 완료: ${response.data.summary.triggeredChecks}개 정리/전환 대상이 있습니다.`
            : "보관 정책 점검 완료: 즉시 조치 대상이 없습니다.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`보관 정책 조회 실패: ${error instanceof Error ? error.message : "운영 정책을 불러오지 못했습니다."}`);
    } finally {
      setRetentionLoading(false);
    }
  };

  const refreshAccountLifecycle = async (showMessage = true) => {
    setAccountLifecycleLoading(true);
    try {
      const response = await erpApi.getAccountLifecycleSummary();
      setAccountLifecycleSummary(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.actionRequired
            ? `계정 수명주기 점검 완료: ${response.data.summary.totalCandidates}개 비활성화 후보가 있습니다.`
            : "계정 수명주기 점검 완료: 비활성화 후보가 없습니다.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`계정 수명주기 조회 실패: ${error instanceof Error ? error.message : "운영 계정 후보를 불러오지 못했습니다."}`);
    } finally {
      setAccountLifecycleLoading(false);
    }
  };

  const runAccountLifecycleDeactivation = async () => {
    const reason = accountLifecycleReason.trim();
    if (!reason) {
      setSettingsMessage("계정 비활성화 배치 사유를 입력하세요.");
      return;
    }
    setAccountLifecycleLoading(true);
    try {
      const response = await erpApi.deactivateAccountLifecycle({
        scope: "all",
        reason,
        idempotencyKey: `account-lifecycle-deactivate-${Date.now()}-${stableJsonHash(reason)}`,
      });
      setSettingsMessage(`계정 비활성화 배치 완료: ${response.data.deactivatedCount}명 비활성화, ${response.data.sessionsRevoked}개 세션 종료.`);
      await refreshAccountLifecycle(false);
      await refreshSettingsHistory("계정 수명주기 비활성화 배치 실행", "사용자 변경");
    } catch (error) {
      setSettingsMessage(`계정 비활성화 배치 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setAccountLifecycleLoading(false);
    }
  };

  const refreshFinancialReconciliation = async (showMessage = true) => {
    setFinancialReconciliationLoading(true);
    try {
      const response = await erpApi.getFinancialReconciliationSummary();
      setFinancialReconciliationSummary(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.actionRequired
            ? `재무 대사 완료: ${response.data.summary.mismatchCount}개 불일치가 있습니다.`
            : "재무 대사 완료: 예산/지급/보고서 원장 불일치가 없습니다.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`재무 대사 조회 실패: ${error instanceof Error ? error.message : "재무 원장 대사 결과를 불러오지 못했습니다."}`);
    } finally {
      setFinancialReconciliationLoading(false);
    }
  };

  const runFinancialReconciliationNotify = async () => {
    setFinancialReconciliationLoading(true);
    try {
      const response = await erpApi.notifyFinancialReconciliation();
      setFinancialReconciliationSummary(response.data.summary);
      setSettingsMessage(`재무 대사 알림 발송 완료: 담당자 ${response.data.recipientCount}명, 신규 알림 ${response.data.notificationsCreated}건.`);
      await refreshSettingsHistory("재무 대사 불일치 알림 발송", "알림 변경");
    } catch (error) {
      setSettingsMessage(`재무 대사 알림 발송 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFinancialReconciliationLoading(false);
    }
  };

  const refreshManualRecoveries = async (showMessage = true) => {
    setManualRecoveryLoading(true);
    try {
      const response = await erpApi.listManualRecoveries();
      setManualRecoverySummary(response.data);
      if (showMessage) {
        setSettingsMessage(`수동 복구 조회 완료: 대기 ${response.data.summary.pending}건, 승인 ${response.data.summary.approved}건, 반려 ${response.data.summary.rejected}건.`);
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`수동 복구 조회 실패: ${error instanceof Error ? error.message : "복구 요청을 불러오지 못했습니다."}`);
    } finally {
      setManualRecoveryLoading(false);
    }
  };

  const requestManualRecovery = async () => {
    const targetCode = manualRecoveryDraft.targetCode.trim();
    const reason = manualRecoveryDraft.reason.trim();
    if (!targetCode || !reason) {
      setSettingsMessage("수동 복구 지급번호와 요청 사유를 입력하세요.");
      return;
    }
    setManualRecoveryLoading(true);
    try {
      const response = await erpApi.requestManualRecovery({
        targetType: "disbursement",
        targetCode,
        nextStatus: manualRecoveryDraft.nextStatus,
        accountStatus: manualRecoveryDraft.accountStatus,
        scheduledDate: manualRecoveryDraft.scheduledDate || undefined,
        reason,
        idempotencyKey: `manual-recovery-request-${Date.now()}-${stableJsonHash({ targetCode, reason, nextStatus: manualRecoveryDraft.nextStatus })}`,
      });
      setManualRecoverySummary(response.data.summary);
      await refreshFinancialControlReport(false);
      setSettingsMessage(`수동 복구 요청 생성 완료: ${targetCode}. 다른 관리자의 2차 승인이 필요합니다.`);
      await refreshSettingsHistory(`수동 복구 요청 (${targetCode})`, "운영 변경");
    } catch (error) {
      setSettingsMessage(`수동 복구 요청 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setManualRecoveryLoading(false);
    }
  };

  const reviewManualRecovery = async (recoveryId: string, decision: "approve" | "reject") => {
    const reason = manualRecoveryDraft.reviewReason.trim();
    if (!reason) {
      setSettingsMessage("수동 복구 검토 사유를 입력하세요.");
      return;
    }
    setManualRecoveryLoading(true);
    try {
      const input = {
        reason,
        idempotencyKey: `manual-recovery-${decision}-${recoveryId}-${Date.now()}-${stableJsonHash(reason)}`,
      };
      const response = decision === "approve"
        ? await erpApi.approveManualRecovery(recoveryId, input)
        : await erpApi.rejectManualRecovery(recoveryId, input);
      setManualRecoverySummary(response.data.summary);
      await refreshFinancialControlReport(false);
      setSettingsMessage(`수동 복구 ${decision === "approve" ? "승인" : "반려"} 완료: ${recoveryId}`);
      await refreshSettingsHistory(`수동 복구 ${decision === "approve" ? "승인" : "반려"}`, "운영 변경");
    } catch (error) {
      setSettingsMessage(`수동 복구 검토 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setManualRecoveryLoading(false);
    }
  };

  const refreshFinancialControlReport = async (showMessage = true) => {
    setFinancialControlLoading(true);
    try {
      const response = await erpApi.getFinancialControlReport();
      setFinancialControlReport(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.ok
            ? `재무 통제 리포트 조회 완료: ${response.data.summary.checklistPassed}/${response.data.summary.checklistTotal}개 점검 통과.`
            : `재무 통제 리포트 조회 완료: 예외 ${response.data.summary.exceptions}건, 미통과 점검 ${response.data.summary.checklistTotal - response.data.summary.checklistPassed}건.`,
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`재무 통제 리포트 조회 실패: ${error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."}`);
    } finally {
      setFinancialControlLoading(false);
    }
  };

  const refreshPermissionReviewReport = async (showMessage = true) => {
    setPermissionReviewLoading(true);
    try {
      const response = await erpApi.getPermissionReviewReport();
      setPermissionReviewReport(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.ok
            ? `권한 검토 리포트 조회 완료: ${response.data.summary.checklistPassed}/${response.data.summary.checklistTotal}개 점검 통과.`
            : `권한 검토 리포트 조회 완료: 예외 ${response.data.summary.exceptions}건, 특권 사용자 ${response.data.summary.privilegedUsers}명.`,
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`권한 검토 리포트 조회 실패: ${error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."}`);
    } finally {
      setPermissionReviewLoading(false);
    }
  };
  const refreshPrivacyAccessReport = async (showMessage = true) => {
    setPrivacyAccessLoading(true);
    try {
      const response = await erpApi.getPrivacyAccessReport();
      setPrivacyAccessReport(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.ok
            ? `개인정보 접근 리포트 조회 완료: 점검 ${response.data.summary.checklistPassed}/${response.data.summary.checklistTotal}개 통과.`
            : `개인정보 접근 리포트 조회 완료: 다운로드 사유 누락 ${response.data.summary.missingDownloadReasons}건.`,
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`개인정보 접근 리포트 조회 실패: ${error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."}`);
    } finally {
      setPrivacyAccessLoading(false);
    }
  };
  const refreshAuditIntegrityReport = async (showMessage = true) => {
    setAuditIntegrityLoading(true);
    try {
      const response = await erpApi.getAuditIntegrityReport();
      setAuditIntegrityReport(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.ok
            ? `감사 로그 무결성 리포트 조회 완료: 체인 ${response.data.summary.chainLength}건, tail ${response.data.summary.tailHash.slice(0, 12)}...`
            : `감사 로그 무결성 리포트 조회 완료: 점검 ${response.data.summary.checkpointsPassed}/${response.data.summary.checkpointsTotal}개 통과.`,
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`감사 로그 무결성 리포트 조회 실패: ${error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."}`);
    } finally {
      setAuditIntegrityLoading(false);
    }
  };
  const refreshOperationMode = async (showMessage = true) => {
    setOperationModeLoading(true);
    try {
      const response = await erpApi.getOperationMode();
      setOperationModeStatus(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.active
            ? `운영 모드 조회 완료: ${response.data.label} 상태로 ${response.data.restrictions.length}개 제한이 적용 중입니다.`
            : "운영 모드 조회 완료: 정상 운영 상태입니다.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`운영 모드 조회 실패: ${error instanceof Error ? error.message : "상태를 불러오지 못했습니다."}`);
    } finally {
      setOperationModeLoading(false);
    }
  };

  const refreshReportJobs = async (showMessage = true) => {
    setReportJobLoading(true);
    try {
      const response = await erpApi.getReportJobStatus();
      setReportJobStatus(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.circuitBreaker.open
            ? `보고서 예약 job 회로 차단: 최근 실패 ${response.data.circuitBreaker.recentFailures}건으로 실행이 보류됩니다.`
            : `보고서 예약 job 조회 완료: 대기 ${response.data.summary.due}건, 최근 dead-letter ${response.data.summary.deadLetter}건.`,
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`보고서 예약 job 조회 실패: ${error instanceof Error ? error.message : "job 상태를 불러오지 못했습니다."}`);
    } finally {
      setReportJobLoading(false);
    }
  };

  const runReportJobs = async () => {
    setReportJobLoading(true);
    try {
      const response = await erpApi.runReportJobs({ dryRun: false });
      setReportJobStatus(response.data);
      setSettingsMessage(
        `보고서 예약 job 실행 완료: 처리 ${response.data.summary.processed}건, 발송 ${response.data.summary.delivered}건, 재시도 ${response.data.summary.retryScheduled}건, dead-letter ${response.data.summary.deadLetter}건.`,
      );
      await refreshSettingsHistory("보고서 예약 job 실행", "운영 변경");
    } catch (error) {
      setSettingsMessage(`보고서 예약 job 실행 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setReportJobLoading(false);
    }
  };

  const refreshPerformancePolicy = async (showMessage = true) => {
    setPerformancePolicyLoading(true);
    try {
      const response = await erpApi.getPerformancePolicy();
      setPerformancePolicy(response.data);
      if (showMessage) {
        setSettingsMessage(
          response.data.ok
            ? `성능/용량 기준 조회 완료: p95 ${response.data.latency.p95TargetMs}ms, p99 ${response.data.latency.p99TargetMs}ms 목표입니다.`
            : "성능/용량 기준 조회 완료: 현재 latency가 목표를 초과했습니다.",
        );
      }
    } catch (error) {
      if (showMessage) setSettingsMessage(`성능/용량 기준 조회 실패: ${error instanceof Error ? error.message : "정책을 불러오지 못했습니다."}`);
    } finally {
      setPerformancePolicyLoading(false);
    }
  };

  const refreshOperationPolicies = async () => {
    await Promise.allSettled([
      refreshOperationMode(false),
      refreshReportJobs(false),
      refreshPerformancePolicy(false),
      refreshDataQualityRuns(false),
      refreshRetentionPolicy(false),
      refreshAccountLifecycle(false),
      refreshFinancialReconciliation(false),
      refreshManualRecoveries(false),
      refreshFinancialControlReport(false),
      refreshPermissionReviewReport(false),
      refreshPrivacyAccessReport(false),
      refreshAuditIntegrityReport(false),
    ]);
    setSettingsMessage("운영 모드, 보고서 예약 job, 성능/용량 기준, 데이터 품질 배치, 보관 정책, 계정 수명주기, 재무 대사, 수동 복구, 권한 검토, 개인정보 접근, 감사 로그 무결성 리포트를 새로고침했습니다.");
  };

  const refreshPasswordPolicy = async (showMessage = true) => {
    try {
      const response = await erpApi.getPasswordPolicy();
      setPasswordPolicy(response.data);
      if (showMessage) setSettingsMessage(`비밀번호 정책 조회 완료: 최소 ${response.data.minLength}자, ${response.data.maxAgeDays}일 만료.`);
    } catch (error) {
      if (showMessage) setSettingsMessage(`비밀번호 정책 조회 실패: ${error instanceof Error ? error.message : "정책을 불러오지 못했습니다."}`);
    }
  };

  const runPasswordChange = async () => {
    if (!passwordDraft.currentPassword || !passwordDraft.newPassword || !passwordDraft.confirmPassword) {
      setSettingsMessage("현재 비밀번호와 새 비밀번호를 모두 입력하세요.");
      return;
    }
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      setSettingsMessage("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setPasswordChanging(true);
    try {
      const response = await erpApi.changePassword({
        currentPassword: passwordDraft.currentPassword,
        newPassword: passwordDraft.newPassword,
      });
      setPasswordDraft({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordPolicy(response.data.policy);
      setSettingsMessage(`비밀번호가 변경되었습니다. 다른 활성 세션 ${response.data.sessionsRevoked}개를 종료했고, ${response.data.expiresAt.slice(0, 10)}까지 사용할 수 있습니다.`);
      await refreshSettingsHistory("비밀번호 변경", "사용자 변경");
    } catch (error) {
      setSettingsMessage(`비밀번호 변경 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setPasswordChanging(false);
    }
  };

  useEffect(() => {
    let active = true;
    setSettingsLoading(true);
    Promise.all([
      erpApi.listRoleSettings(),
      erpApi.getSystemSettings(),
      erpApi.listPageRows("settings", { page: 1, pageSize: 100, sort: encodeSort("사용자", "asc") }),
      erpApi.listPageRows("budget", { page: 1, pageSize: 100, sort: encodeSort("부서", "asc") }),
    ])
      .then(([roleResponse, settingsResponse, userResponse, budgetResponse]) => {
        if (!active) return;
        let nextRoles = roleGroups;
        let nextAssignedUsers = assignedUsers;
        if (roleResponse.data.length > 0) {
          nextRoles = roleResponse.data.map(roleDtoToGroup);
          setRoleGroups(nextRoles);
          setUserDraft((current) => (nextRoles.some((role) => role.id === current.groupId) ? current : { ...current, groupId: nextRoles[0]?.id ?? current.groupId }));
        }
        if (userResponse.data.rows.length > 0) {
          nextAssignedUsers = userResponse.data.rows.map(settingRowToAssignedUser);
          setAssignedUsers(nextAssignedUsers);
          nextRoles = withRoleUserCounts(nextRoles, nextAssignedUsers);
          setRoleGroups(nextRoles);
        }

        setSystemSettingVersions(settingsResponse.data.__meta ?? {});

        let nextLimits = approvalLimits;
        let nextRules = approvalRules;
        let nextDepartments = getInitialDepartmentSettings(budgetResponse.data.rows, nextRoles);
        let nextNotifications = notificationSettings;
        let nextIntegrations = integrationSettings;
        const policy = restoreApprovalPolicySnapshot(settingsResponse.data.approvalPolicy);
        if (policy?.limits) {
          nextLimits = policy.limits;
          setApprovalLimits(nextLimits);
        }
        if (policy?.rules) {
          nextRules = policy.rules;
          setApprovalRules(nextRules);
        }
        if (policy?.departmentSettings) {
          nextDepartments = getInitialDepartmentSettings(policy.departmentSettings, nextRoles);
          setDepartmentSettings(nextDepartments);
        } else {
          setDepartmentSettings(nextDepartments);
        }

        const notifications = restoreNotificationSettingsSnapshot(settingsResponse.data.notifications);
        if (notifications) {
          nextNotifications = notifications;
          setNotificationSettings(nextNotifications);
        }

        const integrations = restoreIntegrationSettingsSnapshot(settingsResponse.data.integrations);
        if (integrations) {
          nextIntegrations = integrations;
          setIntegrationSettings(nextIntegrations);
        }

        setSettingsServerSnapshot(cloneSettingsServerSnapshot({
          approvalLimits: nextLimits,
          approvalRules: nextRules,
          departmentSettings: nextDepartments,
          roleGroups: nextRoles,
          assignedUsers: nextAssignedUsers,
          notificationSettings: nextNotifications,
          integrationSettings: nextIntegrations,
        }));

        setSettingsMessage("권한 그룹, 사용자 권한, 시스템 설정 스냅샷을 backend에서 불러왔습니다.");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSettingsMessage(`시스템 설정 조회 실패: ${error instanceof Error ? error.message : "로컬 설정으로 표시합니다."}`);
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });

    erpApi.listSystemSettingHistory()
      .then((response) => {
        if (active && response.data.length > 0) setSettingsHistory(response.data);
      })
      .catch(() => {
        if (active) setSettingsMessage("설정 변경 이력 조회 실패: 로컬 기본 이력을 표시합니다.");
      });

    erpApi.listDataQualityRuns()
      .then((response) => {
        if (active) setDataQualityRuns(response.data);
      })
      .catch(() => {
        if (active) setDataQualityRuns(null);
      });

    erpApi.getRetentionPolicySummary()
      .then((response) => {
        if (active) setRetentionSummary(response.data);
      })
      .catch(() => {
        if (active) setRetentionSummary(null);
      });

    erpApi.getAccountLifecycleSummary()
      .then((response) => {
        if (active) setAccountLifecycleSummary(response.data);
      })
      .catch(() => {
        if (active) setAccountLifecycleSummary(null);
      });

    erpApi.getFinancialReconciliationSummary()
      .then((response) => {
        if (active) setFinancialReconciliationSummary(response.data);
      })
      .catch(() => {
        if (active) setFinancialReconciliationSummary(null);
      });

    erpApi.listManualRecoveries()
      .then((response) => {
        if (active) setManualRecoverySummary(response.data);
      })
      .catch(() => {
        if (active) setManualRecoverySummary(null);
      });

    erpApi.getFinancialControlReport()
      .then((response) => {
        if (active) setFinancialControlReport(response.data);
      })
      .catch(() => {
        if (active) setFinancialControlReport(null);
      });
    erpApi.getPermissionReviewReport()
      .then((response) => {
        if (active) setPermissionReviewReport(response.data);
      })
      .catch(() => {
        if (active) setPermissionReviewReport(null);
      });
    erpApi.getPrivacyAccessReport()
      .then((response) => {
        if (active) setPrivacyAccessReport(response.data);
      })
      .catch(() => {
        if (active) setPrivacyAccessReport(null);
      });

    erpApi.getAuditIntegrityReport()
      .then((response) => {
        if (active) setAuditIntegrityReport(response.data);
      })
      .catch(() => {
        if (active) setAuditIntegrityReport(null);
      });
    erpApi.getOperationMode()
      .then((response) => {
        if (active) setOperationModeStatus(response.data);
      })
      .catch(() => {
        if (active) setOperationModeStatus(null);
      });

    erpApi.getReportJobStatus()
      .then((response) => {
        if (active) setReportJobStatus(response.data);
      })
      .catch(() => {
        if (active) setReportJobStatus(null);
      });

    erpApi.getPerformancePolicy()
      .then((response) => {
        if (active) setPerformancePolicy(response.data);
      })
      .catch(() => {
        if (active) setPerformancePolicy(null);
      });

    erpApi.getPasswordPolicy()
      .then((response) => {
        if (active) setPasswordPolicy(response.data);
      })
      .catch(() => {
        if (active) setPasswordPolicy(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const saveSystemSettingValue = async (key: SystemSettingKey, value: unknown, reason: string) => {
    const expectedAuditLogId = systemSettingVersions[key]?.auditLogId ?? null;
    const response = await erpApi.saveSystemSetting(key, value, {
      expectedAuditLogId,
      idempotencyKey: systemSettingMutationKey(key, expectedAuditLogId, value),
      reason,
    });
    const auditLogId = typeof response.meta?.auditLogId === "string" ? response.meta.auditLogId : "";
    if (auditLogId) {
      setSystemSettingVersions((current) => ({
        ...current,
        [key]: {
          auditLogId,
          updatedAt: new Date().toISOString(),
        },
      }));
    }
    return response;
  };

  const refreshSystemSettingVersions = async () => {
    const response = await erpApi.getSystemSettings();
    setSystemSettingVersions(response.data.__meta ?? {});
    return response.data;
  };

  const saveSystemSettingSnapshot = async (key: SystemSettingKey, value: unknown, successMessage: string, historyDesc: string, historyTag: string) => {
    try {
      await saveSystemSettingValue(key, value, historyTag);
      if (key === "approvalPolicy") {
        const policy = restoreApprovalPolicySnapshot(value);
        updateSettingsServerSnapshot({
          approvalLimits: policy?.limits ?? approvalLimits,
          approvalRules: policy?.rules ?? approvalRules,
          departmentSettings: policy?.departmentSettings ?? departmentSettings,
        });
      }
      if (key === "notifications") {
        updateSettingsServerSnapshot({ notificationSettings: restoreNotificationSettingsSnapshot(value) ?? notificationSettings });
      }
      if (key === "integrations") {
        updateSettingsServerSnapshot({ integrationSettings: restoreIntegrationSettingsSnapshot(value) ?? integrationSettings });
      }
      setSettingsMessage(successMessage);
      await refreshSettingsHistory(historyDesc, historyTag);
    } catch (error) {
      setSettingsMessage(`설정 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const approvalPolicyPayload = (
    nextLimits = approvalLimits,
    nextRules = approvalRules,
    nextDepartments = departmentSettings,
  ) => ({
    approvalLimits: nextLimits,
    approvalRules: nextRules,
    departmentSettings: nextDepartments,
  });

  const handleAddApprovalLimit = () => {
    const nextLimits = [...approvalLimits, getNextApprovalLimit(approvalLimits)];
    setApprovalLimits(nextLimits);
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(nextLimits),
      "승인 한도 구간이 추가되었습니다. backend 설정 스냅샷에 반영되었습니다.",
      "승인 한도 구간 추가",
      "정책 변경",
    );
  };

  const handleEditApprovalLimit = (limitId: string) => {
    const targetLimit = approvalLimits.find((limit) => limit.id === limitId);
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(),
      "승인 한도 구간이 수정되었습니다. backend 설정 스냅샷에 반영되었습니다.",
      `승인 한도 구간 수정 (${targetLimit ? formatApprovalLimitRange(targetLimit) : "선택"})`,
      "정책 변경",
    );
  };

  const handleChangeApprovalLimit = (limitId: string, patch: Partial<ApprovalLimitRow>) => {
    setApprovalLimits((current) => current.map((limit) => (limit.id === limitId ? { ...limit, ...patch } : limit)));
    setSettingsMessage("승인 한도 구간 편집값이 반영되었습니다. 저장 버튼으로 변경 이력을 남기세요.");
  };

  const handleDeleteApprovalLimit = (limitId: string) => {
    if (approvalLimits.length <= 1) {
      setSettingsMessage("승인 한도 구간은 최소 1개 이상 필요합니다.");
      return;
    }
    const targetLimit = approvalLimits.find((limit) => limit.id === limitId);
    const nextLimits = approvalLimits.filter((limit) => limit.id !== limitId);
    setApprovalLimits(nextLimits);
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(nextLimits),
      `${targetLimit ? formatApprovalLimitRange(targetLimit) : "선택"} 승인 한도 구간이 삭제되었습니다. 진행 중 결재 건은 기존 스냅샷을 유지합니다. backend 설정 스냅샷에 반영되었습니다.`,
      `승인 한도 구간 삭제 (${targetLimit ? formatApprovalLimitRange(targetLimit) : "선택"})`,
      "정책 변경",
    );
  };

  const handleCopyDefaultLimits = () => {
    setApprovalLimits(initialApprovalLimits);
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(initialApprovalLimits),
      "기본 승인 한도 정책을 복사했습니다. backend 설정 스냅샷에 반영되었습니다.",
      "승인 한도 기본 정책 복사",
      "정책 변경",
    );
  };

  const handleCycleLineMode = () => {
    const modes = ["금액 기준 결재선 사용", "부서 기준 결재선 사용", "거래처 예외 포함"];
    setApprovalRules((current) => ({
      ...current,
      lineMode: modes[(modes.indexOf(current.lineMode) + 1) % modes.length],
    }));
    setSettingsMessage("기본 결재선 규칙이 변경되었습니다.");
  };

  const handleToggleApprovalRule = (key: keyof Pick<ApprovalRuleSettings, "allowParallel" | "allowDelegate" | "vacationFallback" | "vendorException">) => {
    setApprovalRules((current) => ({ ...current, [key]: !current[key] }));
    setSettingsMessage("결재선 예외 규칙이 변경되었습니다.");
  };

  const handleSaveApprovalRules = () => {
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(),
      "결재선 규칙이 저장되었습니다. backend 설정 스냅샷에 반영되었습니다.",
      "결재선 규칙 저장",
      "정책 변경",
    );
  };

  const handleSavePolicy = () => {
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(),
      "결재 정책이 저장되었습니다. 신규 요청과 신규 결재선 선택에 즉시 적용됩니다. backend 설정 스냅샷에 반영되었습니다.",
      "결재 정책 저장",
      "정책 변경",
    );
  };

  const handleAddDepartment = (draft: DepartmentSettingDraft) => {
    const departmentName = draft.department.trim();
    if (!departmentName) {
      setSettingsMessage("부서명을 입력하세요.");
      return;
    }
    if (departmentSettings.some((row) => row.부서 === departmentName)) {
      setSettingsMessage(`${departmentName} 부서가 이미 등록되어 있습니다.`);
      return;
    }
    const nextDepartment: TableRow = {
      부서: departmentName,
      기본권한그룹: draft.defaultRoleGroup,
      "배정 예산": draft.budgetAmount || "0",
      사용률: "0%",
      상태: "정상",
      승인라우팅: draft.routing,
      예산담당자: draft.owner.trim() || currentUser.name,
    };
    const nextDepartments = [...departmentSettings, nextDepartment];
    setDepartmentSettings(nextDepartments);
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(approvalLimits, approvalRules, nextDepartments),
      `${departmentName} 부서가 기본 권한/승인 라우팅과 함께 저장되었습니다.`,
      `부서 설정 추가 (${departmentName})`,
      "정책 변경",
    );
  };

  const handleChangeDepartmentSetting = (department: string, patch: TableRow) => {
    setDepartmentSettings((current) => current.map((row) => (row.부서 === department ? { ...row, ...patch } : row)));
    setSettingsMessage(`${department} 부서 설정 편집값이 반영되었습니다. 부서 설정 저장으로 backend 스냅샷을 갱신하세요.`);
  };

  const handleSaveDepartmentSettings = () => {
    void saveSystemSettingSnapshot(
      "approvalPolicy",
      approvalPolicyPayload(approvalLimits, approvalRules, departmentSettings),
      "부서별 기본 권한, 승인 라우팅, 예산 담당자 설정이 backend 설정 스냅샷에 저장되었습니다.",
      "부서 설정 저장",
      "정책 변경",
    );
  };

  const handleAddRoleGroup = async () => {
    const roleName = roleDraft.name.trim();
    if (!roleName) {
      setSettingsMessage("권한 그룹명을 입력하세요.");
      return;
    }
    if (roleGroups.some((group) => group.name === roleName)) {
      setSettingsMessage(`${roleName} 권한 그룹이 이미 있습니다.`);
      return;
    }
    const templatePermissionCodes = getRoleTemplatePermissionCodes(roleDraft.template);
    const nextGroup: RolePermissionGroup = {
      id: `role-${Date.now()}`,
      name: roleName,
      tag: roleDraft.tag.trim() || "그룹",
      userCount: 0,
      permissions: rolePermissionsToColumns(templatePermissionCodes),
      permissionCodes: templatePermissionCodes,
      status: "활성",
      rowVersion: 1,
    };
    try {
      const response = await erpApi.createRoleSettings({ ...roleGroupToInput(nextGroup), idempotencyKey: roleMutationKey("create", nextGroup) });
      const savedGroup = roleDtoToGroup(response.data);
      const nextRoleGroups = [...roleGroups, savedGroup];
      setRoleGroups(nextRoleGroups);
      updateSettingsServerSnapshot({ roleGroups: nextRoleGroups });
      setUserDraft((current) => ({ ...current, groupId: savedGroup.id }));
      setSettingsMessage(`${roleName} 권한 그룹이 backend 역할 설정에 추가되었습니다.`);
      await refreshSettingsHistory(`권한 그룹 추가 (${roleName})`, "권한 변경");
    } catch (error) {
      setSettingsMessage(`권한 그룹 추가 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleTogglePermission = async (groupId: string, permission: PermissionColumn) => {
    const currentGroup = roleGroups.find((group) => group.id === groupId);
    if (!currentGroup) return;
    const currentCodes = expandedPermissionCodes(currentGroup.permissionCodes);
    const columnCodes = permissionCodesByColumn[permission];
    const nextColumnEnabled = !currentGroup.permissions[permission];
    const nextPermissionCodes = normalizePermissionCodes(
      nextColumnEnabled
        ? [...currentCodes, ...columnCodes]
        : currentCodes.filter((permissionCode) => !columnCodes.includes(permissionCode)),
    );
    const nextGroup: RolePermissionGroup = {
      ...currentGroup,
      permissions: rolePermissionsToColumns(nextPermissionCodes),
      permissionCodes: nextPermissionCodes,
    };
    setRoleGroups((current) => current.map((group) => (group.id === groupId ? nextGroup : group)));
    try {
      const response = await erpApi.updateRoleSettings(groupId, { ...roleGroupToInput(nextGroup), rowVersion: currentGroup.rowVersion, idempotencyKey: roleMutationKey("permission", currentGroup) });
      if (response.data) {
        const savedGroup = roleDtoToGroup(response.data);
        const nextRoleGroups = roleGroups.map((group) => (group.id === groupId ? savedGroup : group));
        setRoleGroups(nextRoleGroups);
        updateSettingsServerSnapshot({ roleGroups: nextRoleGroups });
      }
      setSettingsMessage(`${nextGroup.name}의 ${permission} 권한이 backend 권한 코드로 저장되었습니다.${sessionRevocationNotice(response.meta)}`);
      await refreshSettingsHistory(`사용자 권한 수정 (${nextGroup.name} - ${permission})`, "권한 변경");
    } catch (error) {
      setRoleGroups((current) => current.map((group) => (group.id === groupId ? currentGroup : group)));
      setSettingsMessage(`권한 변경 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleTogglePermissionCode = async (groupId: string, permissionCode: string) => {
    const currentGroup = roleGroups.find((group) => group.id === groupId);
    if (!currentGroup) return;
    const currentCodes = expandedPermissionCodes(currentGroup.permissionCodes);
    const nextPermissionCodes = normalizePermissionCodes(
      roleHasPermissionCode(currentGroup, permissionCode)
        ? currentCodes.filter((code) => code !== permissionCode)
        : [...currentCodes, permissionCode],
    );
    const nextGroup: RolePermissionGroup = {
      ...currentGroup,
      permissions: rolePermissionsToColumns(nextPermissionCodes),
      permissionCodes: nextPermissionCodes,
    };
    setRoleGroups((current) => current.map((group) => (group.id === groupId ? nextGroup : group)));
    try {
      const response = await erpApi.updateRoleSettings(groupId, { ...roleGroupToInput(nextGroup), rowVersion: currentGroup.rowVersion, idempotencyKey: roleMutationKey("permission-code", currentGroup) });
      if (response.data) {
        const savedGroup = roleDtoToGroup(response.data);
        const nextRoleGroups = roleGroups.map((group) => (group.id === groupId ? savedGroup : group));
        setRoleGroups(nextRoleGroups);
        updateSettingsServerSnapshot({ roleGroups: nextRoleGroups });
      }
      setSettingsMessage(`${nextGroup.name}의 ${permissionCode} 세부 권한이 backend 권한 코드로 저장되었습니다.${sessionRevocationNotice(response.meta)}`);
      await refreshSettingsHistory(`권한 코드 수정 (${nextGroup.name} - ${permissionCode})`, "권한 변경");
    } catch (error) {
      setRoleGroups((current) => current.map((group) => (group.id === groupId ? currentGroup : group)));
      setSettingsMessage(`세부 권한 변경 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleToggleRoleStatus = async (groupId: string) => {
    const currentGroup = roleGroups.find((group) => group.id === groupId);
    if (!currentGroup) return;
    const nextGroup: RolePermissionGroup = { ...currentGroup, status: currentGroup.status === "활성" ? "비활성" : "활성" };
    setRoleGroups((current) => current.map((group) => (group.id === groupId ? nextGroup : group)));
    try {
      const response = await erpApi.updateRoleSettings(groupId, { ...roleGroupToInput(nextGroup), rowVersion: currentGroup.rowVersion, idempotencyKey: roleMutationKey("status", currentGroup) });
      if (response.data) {
        const savedGroup = roleDtoToGroup(response.data);
        const nextRoleGroups = roleGroups.map((group) => (group.id === groupId ? savedGroup : group));
        setRoleGroups(nextRoleGroups);
        updateSettingsServerSnapshot({ roleGroups: nextRoleGroups });
      }
      setSettingsMessage(`${nextGroup.name} 상태가 backend 역할 상태로 저장되었습니다.${sessionRevocationNotice(response.meta)}`);
      await refreshSettingsHistory(`권한 그룹 상태 변경 (${nextGroup.name})`, "권한 변경");
    } catch (error) {
      setRoleGroups((current) => current.map((group) => (group.id === groupId ? currentGroup : group)));
      setSettingsMessage(`권한 그룹 상태 변경 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleDeleteRoleGroup = async (groupId: string) => {
    const currentGroup = roleGroups.find((group) => group.id === groupId);
    if (!currentGroup) return;
    if (currentGroup.userCount > 0) {
      setSettingsMessage("사용자가 배정된 권한 그룹은 삭제할 수 없습니다. 먼저 사용자 권한을 이동하거나 그룹을 비활성화하세요.");
      return;
    }
    try {
      await erpApi.deleteRoleSettings(groupId, { rowVersion: currentGroup.rowVersion, idempotencyKey: roleMutationKey("delete", currentGroup) });
      const nextRoleGroups = roleGroups.filter((group) => group.id !== groupId);
      setRoleGroups(nextRoleGroups);
      updateSettingsServerSnapshot({ roleGroups: nextRoleGroups });
      setSettingsMessage(`${currentGroup.name} 권한 그룹이 backend 역할 설정에서 삭제되었습니다.`);
      await refreshSettingsHistory(`권한 그룹 삭제 (${currentGroup.name})`, "권한 변경");
    } catch (error) {
      setSettingsMessage(`권한 그룹 삭제 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleAddUserPermission = async () => {
    const targetGroup = roleGroups.find((group) => group.id === userDraft.groupId);
    const userName = userDraft.user.trim();
    if (!targetGroup || !userName) {
      setSettingsMessage("사용자와 권한 그룹을 확인하세요.");
      return;
    }
    const departmentMatch = userName.match(/\(([^)]+)\)/);
    const normalizedUserName = userName.replace(/\s*\([^)]*\)\s*/g, "").trim();
    const existingAssignment = assignedUsers.find((assigned) => assignedUserName(assigned.user) === normalizedUserName);
    const userRow: TableRow = {
      사용자: normalizedUserName,
      부서: departmentMatch?.[1] ?? currentUser.departmentName,
      역할: userDraft.role,
      권한그룹: targetGroup.name,
      상태: "활성",
      idempotencyKey: userPermissionMutationKey(existingAssignment ? "update" : "create", normalizedUserName, existingAssignment?.rowVersion),
      ...(existingAssignment?.rowVersion ? { rowVersion: existingAssignment.rowVersion, 사용자RowVersion: existingAssignment.rowVersion } : {}),
    };
    try {
      const response = existingAssignment
        ? await erpApi.updatePageRow("settings", normalizedUserName, userRow)
        : await erpApi.createPageRow("settings", userRow);
      const savedUser = settingRowToAssignedUser(response.data ?? userRow, Date.now());
      const nextAssignedUsers = [savedUser, ...assignedUsers.filter((assigned) => assignedUserName(assigned.user) !== normalizedUserName)];
      const nextRoleGroups = withRoleUserCounts(roleGroups, nextAssignedUsers);
      setAssignedUsers(nextAssignedUsers);
      setRoleGroups(nextRoleGroups);
      updateSettingsServerSnapshot({ assignedUsers: nextAssignedUsers, roleGroups: nextRoleGroups });
      setSettingsMessage(`${normalizedUserName} 사용자 권한이 ${existingAssignment ? "수정" : "추가"}되어 backend 사용자 역할에 저장되었습니다.${sessionRevocationNotice(response.meta)}`);
      await refreshSettingsHistory(`사용자 권한 ${existingAssignment ? "수정" : "추가"} (${normalizedUserName} - ${targetGroup.name})`, "사용자 변경");
    } catch (error) {
      setSettingsMessage(`사용자 권한 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleChangeAssignedUser = (assignmentId: string, patch: Partial<AssignedUser>) => {
    const nextAssignedUsers = assignedUsers.map((assigned) => (assigned.id === assignmentId ? { ...assigned, ...patch } : assigned));
    setAssignedUsers(nextAssignedUsers);
    setRoleGroups((current) => withRoleUserCounts(current, nextAssignedUsers));
    const target = nextAssignedUsers.find((assigned) => assigned.id === assignmentId);
    setSettingsMessage(`${target?.user ?? "선택 사용자"} 권한 편집값이 반영되었습니다. 행 저장 버튼으로 backend 사용자 권한을 갱신하세요.`);
  };

  const saveAssignedUserRow = async (assignment: AssignedUser, patch: Partial<AssignedUser> = {}) => {
    const nextAssignment = { ...assignment, ...patch };
    const userName = assignedUserName(nextAssignment.user);
    if (!userName || !nextAssignment.department.trim() || !nextAssignment.groupName.trim() || !nextAssignment.role.trim()) {
      setSettingsMessage("사용자명, 부서, 권한 그룹, 역할은 필수입니다.");
      return;
    }
    const userRow: TableRow = {
      사용자: userName,
      부서: nextAssignment.department.trim(),
      역할: nextAssignment.role,
      권한그룹: nextAssignment.groupName,
      상태: nextAssignment.status,
      idempotencyKey: userPermissionMutationKey("update", userName, nextAssignment.rowVersion),
      ...(nextAssignment.rowVersion ? { rowVersion: nextAssignment.rowVersion, 사용자RowVersion: nextAssignment.rowVersion } : {}),
    };
    try {
      const response = await erpApi.updatePageRow("settings", userName, userRow);
      const savedUser = settingRowToAssignedUser(response.data ?? userRow, assignment.id);
      const nextAssignedUsers = assignedUsers.map((assigned) => (assigned.id === assignment.id ? savedUser : assigned));
      const nextRoleGroups = withRoleUserCounts(roleGroups, nextAssignedUsers);
      setAssignedUsers(nextAssignedUsers);
      setRoleGroups(nextRoleGroups);
      updateSettingsServerSnapshot({ assignedUsers: nextAssignedUsers, roleGroups: nextRoleGroups });
      setSettingsMessage(`${savedUser.user} 사용자 권한이 backend 사용자 역할에 저장되었습니다.${sessionRevocationNotice(response.meta)}`);
      await refreshSettingsHistory(`사용자 권한 수정 (${savedUser.user} - ${savedUser.groupName})`, "사용자 변경");
    } catch (error) {
      setSettingsMessage(`사용자 권한 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleSaveAssignedUser = (assignmentId: string) => {
    const assignment = assignedUsers.find((assigned) => assigned.id === assignmentId);
    if (!assignment) return;
    void saveAssignedUserRow(assignment);
  };

  const handleToggleAssignedUserStatus = (assignmentId: string) => {
    const assignment = assignedUsers.find((assigned) => assigned.id === assignmentId);
    if (!assignment) return;
    const nextStatus = assignment.status === "활성" ? "비활성" : "활성";
    const nextAssignedUsers = assignedUsers.map((assigned) => (assigned.id === assignmentId ? { ...assigned, status: nextStatus } : assigned));
    setAssignedUsers(nextAssignedUsers);
    setRoleGroups((current) => withRoleUserCounts(current, nextAssignedUsers));
    void saveAssignedUserRow(assignment, { status: nextStatus });
  };

  const handleToggleNotification = (settingId: string) => {
    setNotificationSettings((current) =>
      current.map((setting) => (setting.id === settingId ? { ...setting, enabled: !setting.enabled } : setting)),
    );
    setSettingsMessage("알림 설정이 변경되었습니다.");
  };

  const handleSaveNotifications = () => {
    const enabledCount = notificationSettings.filter((setting) => setting.enabled).length;
    void saveSystemSettingSnapshot(
      "notifications",
      notificationSettings,
      `알림 설정이 저장되었습니다. ${enabledCount}개 알림이 연동되며 관리자 테스트 알림을 발송했습니다. backend 설정 스냅샷에 반영되었습니다.`,
      "알림 설정 저장",
      "알림 변경",
    );
  };

  const handleCycleIntegrationStatus = (settingId: string) => {
    const statuses: IntegrationSetting["status"][] = ["연동", "대기", "점검"];
    setIntegrationSettings((current) =>
      current.map((setting) =>
        setting.id === settingId
          ? { ...setting, status: statuses[(statuses.indexOf(setting.status) + 1) % statuses.length] }
          : setting,
      ),
    );
    setSettingsMessage("외부 연동 상태가 변경되었습니다.");
  };

  const handleChangeIntegration = (settingId: string, patch: Partial<IntegrationSetting>) => {
    setIntegrationSettings((current) => current.map((setting) => (setting.id === settingId ? { ...setting, ...patch } : setting)));
    setSettingsMessage("외부 연동 credential reference 또는 테스트 endpoint가 변경되었습니다.");
  };

  const handleTestIntegration = async (settingId: string) => {
    const target = integrationSettings.find((setting) => setting.id === settingId);
    if (!target) return;
    try {
      setSettingsMessage(`${target.name} 연동 설정을 저장하고 테스트를 호출하는 중입니다.`);
      await saveSystemSettingValue("integrations", integrationSettings, "연동 테스트 전 저장");
      const response = await erpApi.testIntegrationSetting(settingId, {
        idempotencyKey: systemSettingMutationKey("integrations", systemSettingVersions.integrations?.auditLogId ?? null, {
          action: "testIntegration",
          settingId,
          credentialRef: target.credentialRef,
          testEndpoint: target.testEndpoint,
        }),
      });
      const refreshedSettings = await refreshSystemSettingVersions();
      const refreshedIntegrations = restoreIntegrationSettingsSnapshot(refreshedSettings.integrations);
      const updatedSetting = response.data.setting as Partial<IntegrationSetting> | undefined;
      const nextIntegrationSettings = (refreshedIntegrations ?? integrationSettings).map((setting) =>
          setting.id === settingId
            ? {
                ...setting,
                ...updatedSetting,
                status: response.data.status,
                lastSynced: response.data.lastSynced,
                lastFailureReason: response.data.failureReason,
                lastTestedAt: response.data.testedAt,
              }
            : setting,
      );
      setIntegrationSettings(nextIntegrationSettings);
      updateSettingsServerSnapshot({ integrationSettings: nextIntegrationSettings });
      setSettingsMessage(
        response.data.success
          ? `${target.name} 연동 테스트를 통과했습니다. 마지막 동기화 시각이 갱신되었습니다.`
          : `${target.name} 연동 테스트 실패: ${response.data.failureReason}`,
      );
      await refreshSettingsHistory(`외부 연동 테스트 (${target.name})`, "연동 변경");
    } catch (error) {
      setSettingsMessage(`외부 연동 테스트 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    }
  };

  const handleSaveIntegrations = () => {
    const checkedCount = integrationSettings.filter((setting) => setting.status === "연동").length;
    void saveSystemSettingSnapshot(
      "integrations",
      integrationSettings,
      `외부 연동 설정 구조가 저장되었습니다. ${checkedCount}개 항목이 연동 상태이며 credential reference와 테스트 endpoint가 backend 설정 스냅샷에 반영되었습니다.`,
      "외부 연동 설정 저장",
      "연동 변경",
    );
  };

  const handleCancelSettings = () => {
    const restored = cloneSettingsServerSnapshot(settingsServerSnapshot ?? {
      approvalLimits: initialApprovalLimits,
      approvalRules: initialApprovalRules,
      departmentSettings: getInitialDepartmentSettings(budgetRows, initialRoleGroups),
      roleGroups: initialRoleGroups,
      assignedUsers: initialAssignedUsers,
      notificationSettings: initialNotificationSettings,
      integrationSettings: initialIntegrationSettings,
    });
    setApprovalLimits(restored.approvalLimits);
    setApprovalRules(restored.approvalRules);
    setDepartmentSettings(restored.departmentSettings);
    setRoleGroups(restored.roleGroups);
    setAssignedUsers(restored.assignedUsers);
    setRoleDraft({ name: "프로젝트 결재자", tag: "그룹", template: "승인 중심" });
    setNotificationSettings(restored.notificationSettings);
    setIntegrationSettings(restored.integrationSettings);
    setSettingsMessage(settingsServerSnapshot ? "저장 전 편집값을 마지막 backend 설정 원본으로 되돌렸습니다." : "저장 전 편집값을 로컬 기본 설정으로 되돌렸습니다.");
    setCancelConfirmOpen(false);
  };

  const settingsTabTitles: Record<string, string> = {
    "결재 정책": "결재 정책 설정",
    "사용자 권한": "사용자 권한 설정",
    "부서 관리": "부서 관리 설정",
    "알림": "알림 설정",
    "연동": "외부 연동 설정",
    "보안": "계정 보안 설정",
    "보관 정책": "보관 정책 설정",
  };
  const settingsFooterAction: { label: string; Icon: typeof CheckCircle2; onClick: () => void } | null =
    activeTab === "결재 정책"
      ? { label: "결재 정책 저장", Icon: CheckCircle2, onClick: handleSavePolicy }
      : activeTab === "부서 관리"
        ? { label: "부서 설정 저장", Icon: CheckCircle2, onClick: handleSaveDepartmentSettings }
        : activeTab === "알림"
          ? { label: "알림 설정 저장", Icon: CheckCircle2, onClick: handleSaveNotifications }
          : activeTab === "연동"
            ? { label: "연동 설정 저장", Icon: CheckCircle2, onClick: handleSaveIntegrations }
            : activeTab === "보관 정책"
              ? { label: "운영 점검 새로고침", Icon: RefreshCw, onClick: () => void refreshOperationPolicies() }
              : null;
  const FooterActionIcon = settingsFooterAction?.Icon;
  const settingsFeedback = settingsLoading ? "권한 그룹을 backend 역할 설정에서 불러오는 중입니다." : settingsMessage;

  return (
    <div className="settings-management-page">
      <section className="settings-main-column">
        <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="settings-section-head">
          <div>
            <h2>{settingsTabTitles[activeTab] ?? "시스템 설정"}</h2>
            <p>{page.subtitle}</p>
          </div>
          <StatusPill value={activeTab} />
        </div>
        <p className="settings-message" aria-live="polite">{settingsFeedback}</p>
        {activeTab === "결재 정책" && (
          <>
            <div className="settings-policy-grid">
              <ApprovalLimitCard
                limits={approvalLimits}
                onAdd={handleAddApprovalLimit}
                onChange={handleChangeApprovalLimit}
                onCopyDefault={handleCopyDefaultLimits}
                onDelete={handleDeleteApprovalLimit}
                onEdit={handleEditApprovalLimit}
              />
              <ApprovalRuleCard
                rules={approvalRules}
                onCycleLineMode={handleCycleLineMode}
                onSave={handleSaveApprovalRules}
                onToggle={handleToggleApprovalRule}
              />
            </div>
            <SettingsScopeCard rules={approvalRules} />
          </>
        )}
        {activeTab === "사용자 권한" && (
          <>
            <div className="settings-role-grid">
              <RolePermissionCard
                draft={roleDraft}
                roles={roleGroups}
                onAddGroup={handleAddRoleGroup}
                onDeleteGroup={handleDeleteRoleGroup}
                onDraftChange={setRoleDraft}
                onTogglePermission={handleTogglePermission}
                onTogglePermissionCode={handleTogglePermissionCode}
                onToggleStatus={handleToggleRoleStatus}
              />
              <UserAddCard
                assignedUsers={assignedUsers}
                draft={userDraft}
                roles={roleGroups}
                onAdd={handleAddUserPermission}
                onDraftChange={setUserDraft}
              />
            </div>
            <UserPermissionManagementCard
              assignedUsers={assignedUsers}
              roles={roleGroups}
              onChangeUser={handleChangeAssignedUser}
              onSaveUser={handleSaveAssignedUser}
              onToggleUserStatus={handleToggleAssignedUserStatus}
            />
          </>
        )}
        {activeTab === "부서 관리" && (
          <DepartmentSettingsCard
            departments={departmentSettings}
            roles={roleGroups}
            onAddDepartment={handleAddDepartment}
            onChangeDepartment={handleChangeDepartmentSetting}
            onSave={handleSaveDepartmentSettings}
          />
        )}
        {activeTab === "알림" && (
          <NotificationSettingsCard
            settings={notificationSettings}
            onSave={handleSaveNotifications}
            onToggle={handleToggleNotification}
          />
        )}
        {activeTab === "연동" && (
          <div className="settings-system-grid two-column">
            <IntegrationSettingsCard
              settings={integrationSettings}
              onChange={handleChangeIntegration}
              onSave={handleSaveIntegrations}
              onTest={handleTestIntegration}
              onToggleStatus={handleCycleIntegrationStatus}
            />
            <SettingsScopeCard rules={approvalRules} />
          </div>
        )}
        {activeTab === "보안" && (
          <PasswordSecurityCard
            currentUser={currentUser}
            draft={passwordDraft}
            loading={passwordChanging}
            policy={passwordPolicy}
            onChangeDraft={setPasswordDraft}
            onRefreshPolicy={() => void refreshPasswordPolicy()}
            onSubmit={() => void runPasswordChange()}
          />
        )}
        {activeTab === "보관 정책" && (
          <>
            <OperationModeCard
              loading={operationModeLoading}
              status={operationModeStatus}
              onRefresh={() => void refreshOperationMode()}
            />
            <ReportJobWorkerCard
              loading={reportJobLoading}
              status={reportJobStatus}
              onRefresh={() => void refreshReportJobs()}
              onRun={() => void runReportJobs()}
            />
            <PerformancePolicyCard
              loading={performancePolicyLoading}
              status={performancePolicy}
              onRefresh={() => void refreshPerformancePolicy()}
            />            <DataQualityRunCard
              data={dataQualityRuns}
              loading={dataQualityLoading}
              onDownload={(runId) => void downloadDataQualityReport(runId)}
              onRefresh={() => void refreshDataQualityRuns()}
              onRun={() => void runDataQualityBatch()}
            />
            <RetentionPolicyCard
              loading={retentionLoading}
              summary={retentionSummary}
              onRefresh={() => void refreshRetentionPolicy()}
            />
            <AccountLifecycleCard
              loading={accountLifecycleLoading}
              reason={accountLifecycleReason}
              summary={accountLifecycleSummary}
              onDeactivate={() => void runAccountLifecycleDeactivation()}
              onReasonChange={setAccountLifecycleReason}
              onRefresh={() => void refreshAccountLifecycle()}
            />
            <PermissionReviewReportCard
              loading={permissionReviewLoading}
              report={permissionReviewReport}
              onRefresh={() => void refreshPermissionReviewReport()}
            />
            <PrivacyAccessReportCard
              loading={privacyAccessLoading}
              report={privacyAccessReport}
              onRefresh={() => void refreshPrivacyAccessReport()}
            />
            <AuditIntegrityReportCard
              loading={auditIntegrityLoading}
              report={auditIntegrityReport}
              onRefresh={() => void refreshAuditIntegrityReport()}
            />
            <FinancialReconciliationCard
              loading={financialReconciliationLoading}
              summary={financialReconciliationSummary}
              onNotify={() => void runFinancialReconciliationNotify()}
              onRefresh={() => void refreshFinancialReconciliation()}
            />
            <ManualRecoveryCard
              draft={manualRecoveryDraft}
              loading={manualRecoveryLoading}
              summary={manualRecoverySummary}
              onDraftChange={setManualRecoveryDraft}
              onRefresh={() => void refreshManualRecoveries()}
              onRequest={() => void requestManualRecovery()}
              onReview={(recoveryId, decision) => void reviewManualRecovery(recoveryId, decision)}
            />
            <FinancialControlReportCard
              loading={financialControlLoading}
              report={financialControlReport}
              onRefresh={() => void refreshFinancialControlReport()}
            />
          </>
        )}
        <footer className="settings-actions">
          {settingsFooterAction && FooterActionIcon && (
            <button className="save" onClick={settingsFooterAction.onClick} type="button">
              <FooterActionIcon size={17} />
              {settingsFooterAction.label}
            </button>
          )}
          <button onClick={() => setCancelConfirmOpen(true)} type="button">취소</button>
        </footer>
        {cancelConfirmOpen && (
          <section className="settings-cancel-confirm" aria-label="설정 취소 확인">
            <strong>저장 전 변경 내용을 되돌릴까요?</strong>
            <span>현재 편집값을 마지막으로 불러오거나 저장한 backend 설정 원본으로 복구합니다.</span>
            <button onClick={handleCancelSettings} type="button">되돌리기</button>
            <button onClick={() => setCancelConfirmOpen(false)} type="button">계속 편집</button>
          </section>
        )}
      </section>
      <SettingsHistoryPanel history={settingsHistory} />
    </div>
  );
}

function SettingsTabs({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  const tabs = [
    ["결재 정책", ShieldCheck],
    ["사용자 권한", Users],
    ["부서 관리", Building2],
    ["알림", Bell],
    ["연동", Database],
    ["보안", ShieldCheck],
    ["보관 정책", FileText],
  ] as Array<[string, typeof ShieldCheck]>;
  return (
    <nav className="settings-top-tabs" aria-label="설정 탭">
      {tabs.map(([label, Icon]) => (
        <button className={activeTab === label ? "active" : undefined} key={label} onClick={() => onTabChange(label)} type="button">
          <Icon size={17} />
          {label}
        </button>
      ))}
    </nav>
  );
}

function ApprovalLimitCard({
  limits,
  onAdd,
  onChange,
  onCopyDefault,
  onDelete,
  onEdit,
}: {
  limits: ApprovalLimitRow[];
  onAdd: () => void;
  onChange: (limitId: string, patch: Partial<ApprovalLimitRow>) => void;
  onCopyDefault: () => void;
  onDelete: (limitId: string) => void;
  onEdit: (limitId: string) => void;
}) {
  return (
    <section className="erp-card approval-limit-card">
      <header>
        <div>
          <strong>승인 한도</strong>
          <span>금액 구간별 결재 단계 및 필수 승인자 수를 설정합니다.</span>
        </div>
        <button onClick={onCopyDefault} type="button">
          <Copy size={15} />
          기본 정책 복사
        </button>
      </header>
      <table>
        <thead>
          <tr>
            {["금액 구간", "결재 단계", "필수 승인자 수", "상태", "작업"].map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limits.map((limit) => {
            const range = formatApprovalLimitRange(limit);
            return (
              <tr key={limit.id}>
                <td>
                  <div className="approval-limit-edit">
                    <input
                      aria-label={`${range} 시작 금액`}
                      min={0}
                      onChange={(event) => onChange(limit.id, { min: Number(event.currentTarget.value) })}
                      type="number"
                      value={limit.min}
                    />
                    <span>~</span>
                    <input
                      aria-label={`${range} 종료 금액`}
                      min={0}
                      onChange={(event) => onChange(limit.id, { max: event.currentTarget.value ? Number(event.currentTarget.value) : null })}
                      placeholder="무제한"
                      type="number"
                      value={limit.max ?? ""}
                    />
                  </div>
                </td>
                <td>
                  <select aria-label={`${range} 결재 단계`} onChange={(event) => onChange(limit.id, { step: event.currentTarget.value })} value={limit.step}>
                    {["1단계", "2단계", "3단계", "4단계", "5단계"].map((step) => (
                      <option key={step} value={step}>{step}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`${range} 필수 승인자 수`}
                    max={6}
                    min={1}
                    onChange={(event) => onChange(limit.id, { requiredApprovers: Number(event.currentTarget.value) })}
                    type="number"
                    value={limit.requiredApprovers}
                  />명
                </td>
                <td>
                  <select aria-label={`${range} 상태`} onChange={(event) => onChange(limit.id, { status: event.currentTarget.value as ApprovalLimitRow["status"] })} value={limit.status}>
                    <option value="활성">활성</option>
                    <option value="비활성">비활성</option>
                  </select>
                </td>
                <td className="settings-row-actions">
                  <button aria-label={`${range} 승인 한도 수정`} onClick={() => onEdit(limit.id)} type="button">
                    <Pencil size={14} />
                    저장
                  </button>
                  <button aria-label={`${range} 승인 한도 삭제`} onClick={() => onDelete(limit.id)} type="button">
                    <Trash2 size={14} />
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="add-row-button" onClick={onAdd} type="button">
        <Plus size={15} />
        구간 추가
      </button>
    </section>
  );
}

function ApprovalRuleCard({
  rules,
  onCycleLineMode,
  onSave,
  onToggle,
}: {
  rules: ApprovalRuleSettings;
  onCycleLineMode: () => void;
  onSave: () => void;
  onToggle: (key: keyof Pick<ApprovalRuleSettings, "allowParallel" | "allowDelegate" | "vacationFallback" | "vendorException">) => void;
}) {
  const toggleRows: Array<[keyof Pick<ApprovalRuleSettings, "allowParallel" | "allowDelegate" | "vacationFallback" | "vendorException">, string, string]> = [
    ["allowParallel", "병렬 결재 허용", "동일 단계 승인자는 병렬 결재를 허용합니다."],
    ["allowDelegate", "대리 결재 허용", "결재자 부재 시 대리 결재를 허용합니다."],
    ["vacationFallback", "휴가/부재 예외", "부재 등록 시 대리 결재자를 자동 지정합니다."],
    ["vendorException", "거래처 예외 결재선", "특정 거래처는 별도 결재선을 사용합니다."],
  ];
  return (
    <section className="erp-card approval-rule-card">
      <strong>결재선 규칙</strong>
      <span>결재선 선택 및 예외 규칙을 설정합니다.</span>
      <label>
        기본 결재선
        <button aria-label="기본 결재선 변경" onClick={onCycleLineMode} type="button">
          {rules.lineMode}
          <ChevronDown size={15} />
        </button>
      </label>
      {toggleRows.map(([key, title, desc]) => (
        <button className="toggle-row" key={key} onClick={() => onToggle(key)} type="button">
          <b>{title}</b>
          <i className={rules[key] ? "on" : undefined} />
          <span>{desc}</span>
        </button>
      ))}
      <button className="settings-card-save" onClick={onSave} type="button">
        <CheckCircle2 size={16} />
        결재선 규칙 저장
      </button>
    </section>
  );
}

function RolePermissionCard({
  draft,
  roles,
  onAddGroup,
  onDeleteGroup,
  onDraftChange,
  onTogglePermission,
  onTogglePermissionCode,
  onToggleStatus,
}: {
  draft: RoleGroupDraft;
  roles: RolePermissionGroup[];
  onAddGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onDraftChange: (draft: RoleGroupDraft) => void;
  onTogglePermission: (groupId: string, permission: PermissionColumn) => void;
  onTogglePermissionCode: (groupId: string, permissionCode: string) => void;
  onToggleStatus: (groupId: string) => void;
}) {
  return (
    <section className="erp-card role-permission-card">
      <header>
        <div>
          <strong>권한 그룹 및 역할 설정</strong>
          <span>권한 그룹별 시스템 접근 권한과 세부 권한 코드를 설정합니다.</span>
        </div>
        <button onClick={onAddGroup} type="button">
          <Plus size={15} />
          권한 그룹 추가
        </button>
      </header>
      <div className="role-group-draft">
        <label>
          그룹명
          <input
            aria-label="권한 그룹명 입력"
            onChange={(event) => onDraftChange({ ...draft, name: event.currentTarget.value })}
            value={draft.name}
          />
        </label>
        <label>
          유형
          <input
            aria-label="권한 그룹 유형 입력"
            onChange={(event) => onDraftChange({ ...draft, tag: event.currentTarget.value })}
            value={draft.tag}
          />
        </label>
        <label>
          권한 템플릿
          <select
            aria-label="권한 템플릿 선택"
            onChange={(event) => onDraftChange({ ...draft, template: event.currentTarget.value as RoleGroupDraft["template"] })}
            value={draft.template}
          >
            {["요청 중심", "승인 중심", "조회 중심", "관리 중심"].map((template) => (
              <option key={template} value={template}>{template}</option>
            ))}
          </select>
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>권한 그룹</th>
            <th>사용자 수</th>
            {permissionColumns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id}>
              <td>
                {role.name} <span>{role.tag}</span>
                <small className="role-permission-code-count">
                  {role.permissionCodes.includes("*") ? "전체 권한" : `${rolePermissionCodeCount(role)}개 코드`}
                </small>
              </td>
              <td>{role.userCount}명</td>
              {permissionColumns.map((permission) => (
                <td key={`${role.id}-${permission}`}>
                  <button
                    aria-label={`${role.name} ${permission} 권한 전환`}
                    className={role.permissions[permission] ? "permission-check checked" : "permission-check"}
                    onClick={() => onTogglePermission(role.id, permission)}
                    type="button"
                  />
                </td>
              ))}
              <td><StatusPill value={role.status} /></td>
              <td className="settings-row-actions">
                <button onClick={() => onToggleStatus(role.id)} type="button">{role.status === "활성" ? "비활성" : "활성"}</button>
                <button disabled={role.userCount > 0} onClick={() => onDeleteGroup(role.id)} type="button">삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="role-permission-detail-list" aria-label="세부 권한 코드 설정">
        {roles.map((role) => (
          <article key={`${role.id}-detail`}>
            <header>
              <strong>{role.name}</strong>
              <span>{role.permissionCodes.includes("*") ? "전체 권한" : `${rolePermissionCodeCount(role)}개 권한 코드`}</span>
            </header>
            <div className="role-permission-code-grid">
              {permissionCatalog.map((permission) => {
                const checked = roleHasPermissionCode(role, permission.code);
                return (
                  <button
                    aria-pressed={checked}
                    className={checked ? "permission-code-toggle checked" : "permission-code-toggle"}
                    key={`${role.id}-${permission.code}`}
                    onClick={() => onTogglePermissionCode(role.id, permission.code)}
                    title={permission.description}
                    type="button"
                  >
                    <b>{permission.label}</b>
                    <small>{permission.code}</small>
                    <span>{permission.group}</span>
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      <p><i className="checked" /> 권한 있음 <i /> 권한 없음</p>
    </section>
  );
}

function UserAddCard({
  assignedUsers,
  draft,
  roles,
  onAdd,
  onDraftChange,
}: {
  assignedUsers: AssignedUser[];
  draft: UserPermissionDraft;
  roles: RolePermissionGroup[];
  onAdd: () => void;
  onDraftChange: (draft: UserPermissionDraft) => void;
}) {
  const searchTerm = draft.user.trim();
  const userMatches = assignedUsers
    .filter((user) => user.user.includes(searchTerm) || user.department.includes(searchTerm) || searchTerm.length === 0)
    .slice(0, 4);
  return (
    <section className="erp-card user-add-card">
      <strong>사용자 추가</strong>
      <label>
        권한 그룹
        <select
          aria-label="권한 그룹 선택"
          value={draft.groupId}
          onChange={(event) => onDraftChange({ ...draft, groupId: event.target.value })}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      </label>
      <label>
        사용자
        <span className="settings-input-with-icon">
          <input
            aria-label="사용자 입력"
            value={draft.user}
            onChange={(event) => onDraftChange({ ...draft, user: event.target.value })}
            placeholder="사용자명 또는 이메일"
          />
          <Search size={15} />
        </span>
      </label>
      <div className="settings-user-search-results" aria-label="사용자 검색 결과">
        {userMatches.map((user) => (
          <button key={user.id} onClick={() => onDraftChange({ ...draft, user: `${user.user} (${user.department})`, role: user.role })} type="button">
            {user.user} · {user.department} · {user.role}
          </button>
        ))}
      </div>
      <label>
        역할
        <select
          aria-label="역할 선택"
          value={draft.role}
          onChange={(event) => onDraftChange({ ...draft, role: event.target.value })}
        >
          {["요청자", "1차 승인자", "최종 승인자", "정산 담당자", "감사 조회"].map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
      </label>
      <button className="add-row-button" onClick={onAdd} type="button">
        <Plus size={15} />
        추가
      </button>
      <div className="settings-user-list">
        <b>최근 사용자</b>
        {assignedUsers.slice(0, 4).map((user) => (
          <span key={user.id}>{user.user} · {user.department} · {user.groupName} · {user.role}</span>
        ))}
      </div>
    </section>
  );
}

function UserPermissionManagementCard({
  assignedUsers,
  roles,
  onChangeUser,
  onSaveUser,
  onToggleUserStatus,
}: {
  assignedUsers: AssignedUser[];
  roles: RolePermissionGroup[];
  onChangeUser: (assignmentId: string, patch: Partial<AssignedUser>) => void;
  onSaveUser: (assignmentId: string) => void;
  onToggleUserStatus: (assignmentId: string) => void;
}) {
  const activeRoleNames = roles.filter((role) => role.status === "활성").map((role) => role.name);
  const allRoleNames = roles.map((role) => role.name);
  const groupNames = Array.from(new Set([...activeRoleNames, ...assignedUsers.map((user) => user.groupName), ...allRoleNames].filter(Boolean)));
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("전체 그룹");
  const [statusFilter, setStatusFilter] = useState("전체 상태");
  const filteredUsers = assignedUsers.filter((user) => {
    const keyword = searchTerm.trim().toLowerCase();
    const matchesSearch =
      keyword.length === 0 ||
      [user.user, user.department, user.groupName, user.role].some((value) => value.toLowerCase().includes(keyword));
    const matchesGroup = groupFilter === "전체 그룹" || user.groupName === groupFilter;
    const matchesStatus = statusFilter === "전체 상태" || user.status === statusFilter;
    return matchesSearch && matchesGroup && matchesStatus;
  });
  return (
    <section className="erp-card user-permission-card">
      <header>
        <div>
          <strong>사용자별 권한 상세</strong>
          <span>사용자별 부서, 역할, 권한 그룹, 활성 상태를 행 단위로 저장합니다.</span>
        </div>
        <b>{filteredUsers.length}명</b>
      </header>
      <div className="user-permission-controls">
        <label>
          <input
            aria-label="사용자 권한 검색"
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            placeholder="사용자, 부서, 역할 검색"
            value={searchTerm}
          />
          <Search size={16} />
        </label>
        <select aria-label="권한 그룹 필터" onChange={(event) => setGroupFilter(event.currentTarget.value)} value={groupFilter}>
          <option value="전체 그룹">전체 그룹</option>
          {groupNames.map((groupName) => (
            <option key={groupName} value={groupName}>{groupName}</option>
          ))}
        </select>
        <select aria-label="사용자 상태 필터" onChange={(event) => setStatusFilter(event.currentTarget.value)} value={statusFilter}>
          {["전체 상태", "활성", "비활성"].map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setSearchTerm("");
            setGroupFilter("전체 그룹");
            setStatusFilter("전체 상태");
          }}
          type="button"
        >
          필터 초기화
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>사용자</th>
            <th>부서</th>
            <th>권한 그룹</th>
            <th>역할</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map((user) => {
            const userGroupOptions = Array.from(new Set([...groupNames, user.groupName].filter(Boolean)));
            return (
              <tr key={user.id}>
                <td>
                  <b>{user.user}</b>
                  <small>v{user.rowVersion ?? "1"}</small>
                </td>
                <td>
                  <input
                    aria-label={`${user.user} 부서 입력`}
                    onChange={(event) => onChangeUser(user.id, { department: event.currentTarget.value })}
                    value={user.department}
                  />
                </td>
                <td>
                  <select aria-label={`${user.user} 권한 그룹 선택`} onChange={(event) => onChangeUser(user.id, { groupName: event.currentTarget.value })} value={user.groupName}>
                    {userGroupOptions.map((groupName) => (
                      <option key={groupName} value={groupName}>{groupName}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select aria-label={`${user.user} 역할 선택`} onChange={(event) => onChangeUser(user.id, { role: event.currentTarget.value })} value={user.role}>
                    {["요청자", "1차 승인자", "최종 승인자", "정산 담당자", "감사 조회"].map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select aria-label={`${user.user} 상태 선택`} onChange={(event) => onChangeUser(user.id, { status: event.currentTarget.value })} value={user.status}>
                    {["활성", "비활성"].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </td>
                <td className="settings-row-actions">
                  <button onClick={() => onSaveUser(user.id)} type="button">
                    <CheckCircle2 size={14} />
                    저장
                  </button>
                  <button onClick={() => onToggleUserStatus(user.id)} type="button">{user.status === "활성" ? "비활성" : "활성"}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filteredUsers.length === 0 && <p>조건에 맞는 사용자가 없습니다. 필터를 초기화하거나 사용자 추가에서 새 배정을 저장하세요.</p>}
    </section>
  );
}

function DepartmentSettingsCard({
  departments,
  roles,
  onAddDepartment,
  onChangeDepartment,
  onSave,
}: {
  departments: TableRow[];
  roles: RolePermissionGroup[];
  onAddDepartment: (draft: DepartmentSettingDraft) => void;
  onChangeDepartment: (department: string, patch: TableRow) => void;
  onSave: () => void;
}) {
  const activeRoleNames = roles.filter((role) => role.status === "활성").map((role) => role.name);
  const roleOptions = activeRoleNames.length > 0 ? activeRoleNames : roles.map((role) => role.name);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<DepartmentSettingDraft>({
    department: "",
    defaultRoleGroup: roleOptions[0] ?? "일반 사용자",
    budgetAmount: "0",
    routing: "금액 기준",
    owner: "",
  });
  const updateDraft = (patch: Partial<DepartmentSettingDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const submitDepartment = () => {
    onAddDepartment({
      ...draft,
      defaultRoleGroup: draft.defaultRoleGroup || roleOptions[0] || "일반 사용자",
      routing: draft.routing || "금액 기준",
    });
    setDraft({
      department: "",
      defaultRoleGroup: roleOptions[0] ?? "일반 사용자",
      budgetAmount: "0",
      routing: "금액 기준",
      owner: "",
    });
    setFormOpen(false);
  };
  return (
    <section className="erp-card department-settings-card">
      <header>
        <div>
          <strong>부서 관리</strong>
          <span>부서별 예산, 기본 권한 그룹, 승인 라우팅 기준을 설정합니다.</span>
        </div>
        <button onClick={() => setFormOpen((current) => !current)} type="button">
          <Plus size={15} />
          부서 추가
        </button>
      </header>
      {formOpen && (
        <div className="department-add-form" aria-label="부서 추가 폼">
          <label>
            부서명
            <input aria-label="부서명 입력" onChange={(event) => updateDraft({ department: event.currentTarget.value })} value={draft.department} />
          </label>
          <label>
            기본 권한
            <select aria-label="부서 기본 권한 선택" onChange={(event) => updateDraft({ defaultRoleGroup: event.currentTarget.value })} value={draft.defaultRoleGroup}>
              {roleOptions.map((roleName) => (
                <option key={roleName} value={roleName}>{roleName}</option>
              ))}
            </select>
          </label>
          <label>
            배정 예산
            <input aria-label="부서 배정 예산 입력" inputMode="numeric" onChange={(event) => updateDraft({ budgetAmount: event.currentTarget.value })} value={draft.budgetAmount} />
          </label>
          <label>
            승인 라우팅
            <select aria-label="부서 승인 라우팅 선택" onChange={(event) => updateDraft({ routing: event.currentTarget.value })} value={draft.routing}>
              {["금액 기준", "부서장 우선", "재무팀 우선", "관리자 승인"].map((routing) => (
                <option key={routing} value={routing}>{routing}</option>
              ))}
            </select>
          </label>
          <label>
            예산 담당자
            <input aria-label="예산 담당자 입력" onChange={(event) => updateDraft({ owner: event.currentTarget.value })} value={draft.owner} />
          </label>
          <button className="add-row-button" onClick={submitDepartment} type="button">
            <CheckCircle2 size={15} />
            추가 저장
          </button>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>부서</th>
            <th>기본 권한</th>
            <th>배정 예산</th>
            <th>사용률</th>
            <th>승인 라우팅</th>
            <th>예산 담당자</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department, index) => (
            <tr key={department.부서}>
              <td>{department.부서}</td>
              <td>
                <select
                  aria-label={`${department.부서} 기본 권한 선택`}
                  onChange={(event) => onChangeDepartment(department.부서, { 기본권한그룹: event.currentTarget.value })}
                  value={department.기본권한그룹 ?? roleOptions[index % Math.max(roleOptions.length, 1)] ?? "일반 사용자"}
                >
                  {roleOptions.map((roleName) => (
                    <option key={roleName} value={roleName}>{roleName}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  aria-label={`${department.부서} 배정 예산 입력`}
                  inputMode="numeric"
                  onChange={(event) => onChangeDepartment(department.부서, { "배정 예산": event.currentTarget.value })}
                  value={department["배정 예산"] ?? "0"}
                />
              </td>
              <td>{department.사용률}</td>
              <td>
                <select
                  aria-label={`${department.부서} 승인 라우팅 선택`}
                  onChange={(event) => onChangeDepartment(department.부서, { 승인라우팅: event.currentTarget.value })}
                  value={department.승인라우팅 ?? "금액 기준"}
                >
                  {["금액 기준", "부서장 우선", "재무팀 우선", "관리자 승인"].map((routing) => (
                    <option key={routing} value={routing}>{routing}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  aria-label={`${department.부서} 예산 담당자 입력`}
                  onChange={(event) => onChangeDepartment(department.부서, { 예산담당자: event.currentTarget.value })}
                  value={department.예산담당자 ?? ""}
                />
              </td>
              <td>
                <button onClick={() => onChangeDepartment(department.부서, { 상태: department.상태 === "정상" ? "점검" : "정상" })} type="button">
                  <StatusPill value={department.상태 ?? "정상"} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {departments.length === 0 && <p>등록된 부서가 없습니다. 부서 추가로 기본 권한과 승인 라우팅을 저장하세요.</p>}
      <button className="settings-card-save" onClick={onSave} type="button">
        <CheckCircle2 size={16} />
        부서 설정 저장
      </button>
    </section>
  );
}

function NotificationSettingsCard({
  settings,
  onSave,
  onToggle,
}: {
  settings: NotificationSetting[];
  onSave: () => void;
  onToggle: (settingId: string) => void;
}) {
  return (
    <section className="erp-card settings-notification-card">
      <header>
        <div>
          <strong>알림 설정 연동</strong>
          <span>결재, 지급, 정책 변경 알림의 연동 여부를 관리합니다.</span>
        </div>
      </header>
      {settings.map((setting) => (
        <button className="settings-toggle-button" key={setting.id} onClick={() => onToggle(setting.id)} type="button">
          <i className={setting.enabled ? "on" : undefined} />
          <span>
            <b>{setting.label}</b>
            <small>{setting.description}</small>
          </span>
          <StatusPill value={setting.enabled ? "연동" : "대기"} />
        </button>
      ))}
      <button className="settings-card-save" onClick={onSave} type="button">
        <CheckCircle2 size={16} />
        알림 설정 저장
      </button>
    </section>
  );
}

function IntegrationSettingsCard({
  settings,
  onChange,
  onSave,
  onTest,
  onToggleStatus,
}: {
  settings: IntegrationSetting[];
  onChange: (settingId: string, patch: Partial<IntegrationSetting>) => void;
  onSave: () => void;
  onTest: (settingId: string) => void | Promise<void>;
  onToggleStatus: (settingId: string) => void;
}) {
  return (
    <section className="erp-card settings-integration-card">
      <header>
        <div>
          <strong>외부 연동 설정</strong>
          <span>회계, 세금계산서, 계좌 검증 endpoint와 credential reference를 저장하고 테스트합니다.</span>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>연동</th>
            <th>대상</th>
            <th>Credential Ref</th>
            <th>Test Endpoint</th>
            <th>상태</th>
            <th>최근 동기화</th>
            <th>검증 결과</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {settings.map((setting) => (
            <tr key={setting.id}>
              <td>{setting.name}</td>
              <td>{setting.target}</td>
              <td>
                <input
                  aria-label={`${setting.name} credential reference 입력`}
                  onChange={(event) => onChange(setting.id, { credentialRef: event.currentTarget.value })}
                  value={setting.credentialRef ?? ""}
                />
              </td>
              <td>
                <input
                  aria-label={`${setting.name} 테스트 endpoint 입력`}
                  onChange={(event) => onChange(setting.id, { testEndpoint: event.currentTarget.value })}
                  value={setting.testEndpoint ?? ""}
                />
              </td>
              <td>
                <button aria-label={`${setting.name} 연동 상태 변경`} onClick={() => onToggleStatus(setting.id)} type="button">
                  <StatusPill value={setting.status} />
                </button>
              </td>
              <td>{setting.lastSynced}</td>
              <td>{setting.status === "연동" ? "연동 테스트 통과" : setting.lastFailureReason || (setting.status === "대기" ? "인증 정보 입력 대기" : "최근 점검 실패, 재시도 필요")}</td>
              <td>
                <button onClick={() => void onTest(setting.id)} type="button">테스트</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="settings-card-save" onClick={onSave} type="button">
        <CheckCircle2 size={16} />
        연동 설정 저장
      </button>
    </section>
  );
}

function SettingsScopeCard({ rules }: { rules: ApprovalRuleSettings }) {
  return (
    <section className="erp-card settings-scope-card">
      <header>
        <strong>설정 적용 범위</strong>
        <span>정책 저장 시 즉시 적용 범위와 기존 결재 건 영향 범위를 정의합니다.</span>
      </header>
      <dl>
        <dt>즉시 적용</dt>
        <dd>{rules.immediateEffect}</dd>
        <dt>기존 결재 건</dt>
        <dd>{rules.existingApprovalImpact}</dd>
        <dt>비활성 정책 처리</dt>
        <dd>비활성 권한 그룹은 신규 배정에서 제외하고, 기존 배정 사용자는 조회 권한만 유지합니다.</dd>
      </dl>
    </section>
  );
}

function PasswordSecurityCard({
  currentUser,
  draft,
  loading,
  policy,
  onChangeDraft,
  onRefreshPolicy,
  onSubmit,
}: {
  currentUser: AuthUser;
  draft: { currentPassword: string; newPassword: string; confirmPassword: string };
  loading: boolean;
  policy: PasswordPolicySummary | null;
  onChangeDraft: (draft: { currentPassword: string; newPassword: string; confirmPassword: string }) => void;
  onRefreshPolicy: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = Boolean(draft.currentPassword && draft.newPassword && draft.confirmPassword && draft.newPassword === draft.confirmPassword);
  return (
    <section className="erp-card password-security-card">
      <header>
        <div>
          <strong>비밀번호 정책</strong>
          <span>{policy ? `최소 ${policy.minLength}자 · ${policy.maxAgeDays}일 만료` : "정책 조회 대기"}</span>
        </div>
        <button onClick={onRefreshPolicy} type="button">
          <RefreshCw size={15} />
          정책 조회
        </button>
      </header>
      <div className="password-policy-summary">
        <article>
          <span>사용자</span>
          <strong>{currentUser.name}</strong>
          <small>{currentUser.email}</small>
        </article>
        <article>
          <span>만료 주기</span>
          <strong>{policy ? `${policy.maxAgeDays}일` : "-"}</strong>
          <small>{policy?.requirements.join(" · ") ?? "정책 정보를 불러오세요."}</small>
        </article>
      </div>
      <div className="password-change-grid">
        <label>
          현재 비밀번호
          <input
            autoComplete="current-password"
            onChange={(event) => onChangeDraft({ ...draft, currentPassword: event.currentTarget.value })}
            type="password"
            value={draft.currentPassword}
          />
        </label>
        <label>
          새 비밀번호
          <input
            autoComplete="new-password"
            onChange={(event) => onChangeDraft({ ...draft, newPassword: event.currentTarget.value })}
            type="password"
            value={draft.newPassword}
          />
        </label>
        <label>
          새 비밀번호 확인
          <input
            autoComplete="new-password"
            onChange={(event) => onChangeDraft({ ...draft, confirmPassword: event.currentTarget.value })}
            type="password"
            value={draft.confirmPassword}
          />
        </label>
      </div>
      <button className="settings-card-save" disabled={loading || !canSubmit} onClick={onSubmit} type="button">
        <ShieldCheck size={16} />
        {loading ? "변경 중" : "비밀번호 변경"}
      </button>
    </section>
  );
}

function OperationModeCard({
  loading,
  status,
  onRefresh,
}: {
  loading: boolean;
  status: OperationModeStatus | null;
  onRefresh: () => void;
}) {
  const activeRestrictionCount = status?.restrictions.length ?? 0;
  return (
    <section className={status?.active ? "erp-card operation-mode-card attention" : "erp-card operation-mode-card"}>
      <header>
        <div>
          <strong>장애 기능 제한 모드</strong>
          <span>{status ? `${status.label} · ${status.generatedAt.slice(0, 16).replace("T", " ")}` : "운영 모드 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>운영 제한 모드를 조회하는 중입니다.</p>}
      {!loading && !status && <p>운영 제한 모드 정보를 불러오지 못했습니다.</p>}
      {status && (
        <>
          <div className="operation-mode-summary">
            <article>
              <span>현재 모드</span>
              <strong>{status.label}</strong>
            </article>
            <article>
              <span>제한 수</span>
              <strong>{activeRestrictionCount}개</strong>
            </article>
            <article>
              <span>읽기 전용</span>
              <strong>{status.readOnly ? "적용" : "해제"}</strong>
            </article>
          </div>
          <div className="operation-mode-source">
            <span>{status.source.operationMode}</span>
            <span>{status.source.disabledCapabilities}</span>
          </div>
          <div className="retention-check-grid">
            {status.restrictions.length === 0 ? (
              <article>
                <header>
                  <strong>제한 없음</strong>
                  <StatusPill value="정상" />
                </header>
                <span>지급, 파일 업로드, 업무 변경 API가 정상 처리됩니다.</span>
              </article>
            ) : status.restrictions.map((restriction) => (
              <article className="attention" key={restriction.capability}>
                <header>
                  <strong>{restriction.label}</strong>
                  <StatusPill value="차단" />
                </header>
                <span>{restriction.summary}</span>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function formatReportJobTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function reportJobResultLabel(status: ReportJobRunResult["results"][number]["status"]) {
  if (status === "delivered") return "완료";
  if (status === "retry_scheduled") return "재시도";
  return "중지";
}

function ReportJobWorkerCard({
  loading,
  status,
  onRefresh,
  onRun,
}: {
  loading: boolean;
  status: ReportJobRunResult | null;
  onRefresh: () => void;
  onRun: () => void;
}) {
  const summary = status?.summary;
  const circuitOpen = Boolean(status?.circuitBreaker.open);
  const canRun = Boolean(status && !loading && !circuitOpen && summary && summary.due > 0);
  return (
    <section className={circuitOpen ? "erp-card report-job-worker-card attention" : "erp-card report-job-worker-card"}>
      <header>
        <div>
          <strong>보고서 예약 job</strong>
          <span>{status ? `${formatReportJobTime(status.generatedAt)} · ${status.policy.deliveryMode} delivery · 최대 ${status.policy.maxAttempts}회` : "예약 job 조회 대기"}</span>
        </div>
        <div className="report-job-actions">
          <button onClick={onRefresh} type="button">
            <RefreshCw size={15} />
            대기 확인
          </button>
          <button disabled={!canRun} onClick={onRun} type="button">
            <CheckCircle2 size={15} />
            예약 job 실행
          </button>
        </div>
      </header>
      {loading && <p>보고서 예약 job 상태를 확인하는 중입니다.</p>}
      {!loading && !status && <p>보고서 예약 job 정보를 불러오지 못했습니다.</p>}
      {status && summary && (
        <>
          <div className="report-job-summary">
            <article>
              <span>대기</span>
              <strong>{summary.due}건</strong>
            </article>
            <article>
              <span>처리</span>
              <strong>{summary.processed}건</strong>
            </article>
            <article>
              <span>발송</span>
              <strong>{summary.delivered}건</strong>
            </article>
            <article>
              <span>재시도</span>
              <strong>{summary.retryScheduled}건</strong>
            </article>
            <article>
              <span>dead-letter</span>
              <strong>{summary.deadLetter}건</strong>
            </article>
            <article>
              <span>차단</span>
              <strong>{summary.skipped}건</strong>
            </article>
          </div>
          <div className="report-job-policy">
            <span>timeout {Math.round(status.policy.timeoutMs / 1000)}초</span>
            <span>retry {status.policy.retryBaseSeconds}s~{status.policy.retryMaxSeconds}s</span>
            <span>circuit {status.circuitBreaker.recentFailures}/{status.circuitBreaker.threshold}</span>
            <span>{status.policy.webhookConfigured ? "webhook 설정됨" : "internal delivery"}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>대기 보고서</th>
                <th>소유자</th>
                <th>예정 시각</th>
              </tr>
            </thead>
            <tbody>
              {status.dueSchedules.length === 0 ? (
                <tr>
                  <td colSpan={3}>실행 대기 중인 예약 보고서가 없습니다.</td>
                </tr>
              ) : status.dueSchedules.slice(0, 8).map((schedule) => (
                <tr key={schedule.id}>
                  <td>{schedule.reportName}</td>
                  <td>{schedule.owner}</td>
                  <td>{formatReportJobTime(schedule.nextRunAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>실행 결과</th>
                <th>시도</th>
                <th>다음 실행</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {status.results.length === 0 ? (
                <tr>
                  <td colSpan={4}>{status.dryRun ? "대기 확인 결과입니다. 실행 버튼으로 처리할 수 있습니다." : "이번 실행 결과가 없습니다."}</td>
                </tr>
              ) : status.results.slice(0, 8).map((result) => (
                <tr key={result.scheduleId}>
                  <td>
                    <b>{result.reportName}</b>
                    {result.errorMessage && <small>{result.errorMessage}</small>}
                  </td>
                  <td>{result.attempt}회</td>
                  <td>{formatReportJobTime(result.nextRunAt)}</td>
                  <td><StatusPill value={reportJobResultLabel(result.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {circuitOpen && <p>최근 실패가 circuit breaker 기준을 넘어 신규 실행이 보류됩니다. 실패 원인을 조치한 뒤 다시 확인하세요.</p>}
        </>
      )}
    </section>
  );
}

function formatPolicyMs(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")} ms` : "-";
}

function PerformancePolicyCard({
  loading,
  status,
  onRefresh,
}: {
  loading: boolean;
  status: PerformancePolicyStatus | null;
  onRefresh: () => void;
}) {
  return (
    <section className={status && !status.ok ? "erp-card performance-policy-card attention" : "erp-card performance-policy-card"}>
      <header>
        <div>
          <strong>성능/용량 기준</strong>
          <span>{status ? `${status.generatedAt.slice(0, 16).replace("T", " ")} · p95 ${formatPolicyMs(status.latency.p95TargetMs)} 목표` : "성능 기준 조회 대기"}</span>
        </div>
        <button disabled={loading} onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          {loading ? "조회 중" : "새로고침"}
        </button>
      </header>
      {loading && <p>성능/용량 기준을 조회하는 중입니다.</p>}
      {!loading && !status && <p>성능/용량 기준을 불러오지 못했습니다.</p>}
      {status && (
        <>
          <div className="performance-policy-grid">
            <article>
              <span>p95 목표</span>
              <strong>{formatPolicyMs(status.latency.p95TargetMs)}</strong>
              <small>현재 {formatPolicyMs(status.latency.currentP95Ms)} · {status.latency.p95Ok ? "정상" : "초과"}</small>
            </article>
            <article>
              <span>p99 목표</span>
              <strong>{formatPolicyMs(status.latency.p99TargetMs)}</strong>
              <small>현재 {formatPolicyMs(status.latency.currentP99Ms)} · {status.latency.p99Ok ? "정상" : "초과"}</small>
            </article>
            <article>
              <span>job 최대 처리</span>
              <strong>{formatPolicyMs(status.reportJob.maxProcessingMs)}</strong>
              <small>worker timeout {formatPolicyMs(status.reportJob.workerTimeoutMs)}</small>
            </article>
            <article>
              <span>다운로드 행 제한</span>
              <strong>{status.largeDownload.maxReportRows.toLocaleString("ko-KR")}행</strong>
              <small>직접 다운로드 상한</small>
            </article>
            <article>
              <span>다운로드 크기 제한</span>
              <strong>{formatFileSize(status.largeDownload.maxReportBytes)}</strong>
              <small>base64 payload 기준</small>
            </article>
            <article>
              <span>latency sample</span>
              <strong>{status.latency.sampleSize.toLocaleString("ko-KR")}건</strong>
              <small>{status.latency.source}</small>
            </article>
          </div>
          <div className="report-job-policy">
            <span>batch {status.reportJob.batchSize}건</span>
            <span>attempt {status.reportJob.maxAttempts}회</span>
            <span>{status.reportJob.source}</span>
            <span>{status.largeDownload.source}</span>
          </div>
        </>
      )}
    </section>
  );
}

function RetentionPolicyCard({
  loading,
  summary,
  onRefresh,
}: {
  loading: boolean;
  summary: RetentionPolicySummary | null;
  onRefresh: () => void;
}) {
  const totals = summary?.summary;
  const totalRows = totals
    ? [
        ["감사 로그", totals.auditLogs],
        ["알림", totals.notifications],
        ["첨부 metadata", totals.attachments],
        ["보고서 실행", totals.reportRuns],
      ]
    : [];
  return (
    <section className="erp-card retention-policy-card">
      <header>
        <div>
          <strong>보관/불변성 정책</strong>
          <span>{summary ? `정책 버전 ${summary.policyVersion} · ${summary.generatedAt.slice(0, 16).replace("T", " ")}` : "운영 정책 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>보관 정책을 불러오는 중입니다.</p>}
      {!loading && !summary && <p>보관 정책 정보를 불러오지 못했습니다. 새로고침으로 다시 조회하세요.</p>}
      {summary && (
        <>
          <div className="retention-summary-grid">
            {totalRows.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{Number(value).toLocaleString("ko-KR")}</strong>
              </article>
            ))}
            <article>
              <span>불변 정책</span>
              <strong>{summary.summary.immutablePolicies}개</strong>
            </article>
            <article>
              <span>조치 대상</span>
              <strong>{summary.summary.triggeredChecks}개</strong>
            </article>
          </div>
          <table>
            <thead>
              <tr>
                <th>대상</th>
                <th>보관 기준</th>
                <th>불변</th>
                <th>삭제 정책</th>
                <th>보호 필드</th>
                <th>운영 조치</th>
              </tr>
            </thead>
            <tbody>
              {summary.policies.map((policy) => (
                <tr key={policy.entityType}>
                  <td>
                    <b>{policy.label}</b>
                    <small>{policy.clockField}</small>
                  </td>
                  <td>{policy.retentionLabel}</td>
                  <td><StatusPill value={policy.immutable ? "불변" : "변경가능"} /></td>
                  <td>{policy.deletionPolicy}</td>
                  <td>{policy.protectedFields.slice(0, 4).join(", ")}{policy.protectedFields.length > 4 ? " ..." : ""}</td>
                  <td>{policy.operatorAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="retention-check-grid">
            {summary.checks.map((check) => (
              <article key={check.id} className={check.ok ? undefined : "attention"}>
                <header>
                  <strong>{check.label}</strong>
                  <StatusPill value={check.ok ? "정상" : check.severity === "critical" ? "위험" : "점검"} />
                </header>
                <b>{check.count.toLocaleString("ko-KR")}건</b>
                <span>{check.detail}</span>
                <small>{check.action}</small>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AccountLifecycleCard({
  loading,
  reason,
  summary,
  onDeactivate,
  onReasonChange,
  onRefresh,
}: {
  loading: boolean;
  reason: string;
  summary: AccountLifecycleSummary | null;
  onDeactivate: () => void;
  onReasonChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const candidates = summary?.candidates ?? [];
  return (
    <section className="erp-card account-lifecycle-card">
      <header>
        <div>
          <strong>계정 수명주기</strong>
          <span>{summary ? `휴면 ${summary.summary.dormantCount}명 · 퇴사자 ${summary.summary.offboardingCount}명 · 기준 ${summary.dormantAccountDays}일` : "계정 후보 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>계정 수명주기를 조회하는 중입니다.</p>}
      {!loading && !summary && <p>계정 수명주기 정보를 불러오지 못했습니다.</p>}
      {summary && (
        <>
          <div className="account-lifecycle-summary">
            <article>
              <span>전체 후보</span>
              <strong>{summary.summary.totalCandidates}명</strong>
            </article>
            <article>
              <span>휴면 기준일</span>
              <strong>{summary.dormantCutoff.slice(0, 10)}</strong>
            </article>
            <article>
              <span>퇴사자 원천</span>
              <strong>{summary.offboardingConfigured ? "설정됨" : "미설정"}</strong>
            </article>
          </div>
          <div className="account-lifecycle-actions">
            <label>
              실행 사유
              <input
                aria-label="계정 비활성화 배치 사유"
                onChange={(event) => onReasonChange(event.currentTarget.value)}
                value={reason}
              />
            </label>
            <button disabled={loading || candidates.length === 0 || !reason.trim()} onClick={onDeactivate} type="button">
              <UserCog size={15} />
              후보 비활성화
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>사용자</th>
                <th>이메일</th>
                <th>최근 로그인</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={4}>비활성화 후보가 없습니다.</td>
                </tr>
              ) : candidates.slice(0, 8).map((candidate) => (
                <tr key={candidate.id}>
                  <td>{candidate.name}</td>
                  <td>{candidate.email}</td>
                  <td>{candidate.lastLoginAt ? candidate.lastLoginAt.slice(0, 10) : `생성 ${candidate.createdAt.slice(0, 10)}`}</td>
                  <td>{candidate.reasons.map((item) => item === "dormant" ? "휴면" : "퇴사자").join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function DataQualityRunCard({
  data,
  loading,
  onDownload,
  onRefresh,
  onRun,
}: {
  data: DataQualityRunList | null;
  loading: boolean;
  onDownload: (runId: string) => void;
  onRefresh: () => void;
  onRun: () => void;
}) {
  const latest = data?.runs[0] ?? null;
  return (
    <section className="erp-card financial-reconciliation-card data-quality-run-card">
      <header>
        <div>
          <strong>데이터 품질 배치</strong>
          <span>
            {data
              ? (data.policy.enabled ? "자동 실행 " + data.policy.intervalMinutes + "분 주기" : "자동 실행 비활성") + " · 이력 " + data.runs.length + "건"
              : "배치 정책과 실행 이력 조회 대기"}
          </span>
        </div>
        <div className="financial-reconciliation-actions">
          <button disabled={loading} onClick={onRefresh} type="button" title="데이터 품질 실행 이력 새로고침">
            <RefreshCw size={15} />
            새로고침
          </button>
          <button disabled={loading} onClick={onRun} type="button">
            <Database size={15} />
            지금 실행
          </button>
          <button disabled={loading || !latest} onClick={() => latest && onDownload(latest.id)} type="button">
            <Download size={15} />
            리포트
          </button>
        </div>
      </header>
      {loading && <p>데이터 품질 정합성 배치를 처리하는 중입니다.</p>}
      {!loading && !data && <p>데이터 품질 실행 이력을 불러오지 못했습니다.</p>}
      {data && (
        <>
          <div className="financial-reconciliation-summary">
            <article>
              <span>최근 상태</span>
              <strong>{latest?.status ?? "미실행"}</strong>
            </article>
            <article>
              <span>Critical</span>
              <strong>{latest?.criticalCount ?? 0}건</strong>
            </article>
            <article>
              <span>Warning</span>
              <strong>{latest?.warningCount ?? 0}건</strong>
            </article>
            <article>
              <span>최근 실행</span>
              <strong>{latest ? latest.startedAt.slice(0, 16).replace("T", " ") : "-"}</strong>
            </article>
          </div>
          <table>
            <thead>
              <tr>
                <th>실행 시각</th>
                <th>구분</th>
                <th>상태</th>
                <th>Critical</th>
                <th>Warning</th>
                <th>리포트</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>실행 이력이 없습니다.</td>
                </tr>
              ) : data.runs.slice(0, 8).map((run) => (
                <tr key={run.id}>
                  <td>
                    <b>{run.startedAt.slice(0, 16).replace("T", " ")}</b>
                    <small>{run.requestId}</small>
                  </td>
                  <td>{run.source === "scheduled" ? "예약" : run.source === "startup" ? "시작 점검" : "수동"}</td>
                  <td><StatusPill value={run.status === "COMPLETED" ? (run.criticalCount > 0 ? "위험" : "완료") : run.status === "FAILED" ? "오류" : "진행"} /></td>
                  <td>{run.criticalCount}건</td>
                  <td>{run.warningCount}건</td>
                  <td>
                    <button disabled={loading || run.status !== "COMPLETED"} onClick={() => onDownload(run.id)} type="button" title="데이터 품질 JSON 리포트 다운로드">
                      <Download size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function FinancialReconciliationCard({
  loading,
  summary,
  onNotify,
  onRefresh,
}: {
  loading: boolean;
  summary: FinancialReconciliationSummary | null;
  onNotify: () => void;
  onRefresh: () => void;
}) {
  const totals = summary?.summary;
  const monthlyRows = summary?.monthly.slice(-6).reverse() ?? [];
  const mismatches = summary?.mismatches ?? [];
  return (
    <section className="erp-card financial-reconciliation-card">
      <header>
        <div>
          <strong>재무 대사</strong>
          <span>{summary ? `불일치 ${summary.summary.mismatchCount}건 · ${summary.generatedAt.slice(0, 16).replace("T", " ")}` : "예산/지급/보고서 대사 대기"}</span>
        </div>
        <div className="financial-reconciliation-actions">
          <button onClick={onRefresh} type="button">
            <RefreshCw size={15} />
            새로고침
          </button>
          <button disabled={loading || !summary?.actionRequired} onClick={onNotify} type="button">
            <Bell size={15} />
            알림 발송
          </button>
        </div>
      </header>
      {loading && <p>재무 원장을 대사하는 중입니다.</p>}
      {!loading && !summary && <p>재무 대사 결과를 불러오지 못했습니다.</p>}
      {summary && totals && (
        <>
          <div className="financial-reconciliation-summary">
            <article>
              <span>예산 사용액</span>
              <strong>{formatCurrencyWon(totals.totalBudgetUsed)}</strong>
            </article>
            <article>
              <span>승인 요청</span>
              <strong>{formatCurrencyWon(totals.approvedPaymentAmount)}</strong>
            </article>
            <article>
              <span>지급 완료</span>
              <strong>{formatCurrencyWon(totals.completedDisbursementAmount)}</strong>
            </article>
            <article>
              <span>보고서 행</span>
              <strong>{totals.reportRowsReviewed.toLocaleString("ko-KR")}건</strong>
            </article>
          </div>
          <div className="retention-check-grid">
            {summary.checks.map((check) => (
              <article key={check.id} className={check.ok ? undefined : "attention"}>
                <header>
                  <strong>{check.label}</strong>
                  <StatusPill value={check.ok ? "정상" : check.severity === "critical" ? "위험" : "점검"} />
                </header>
                <b>{check.count.toLocaleString("ko-KR")}건</b>
                <span>{check.detail}</span>
                <small>{check.action}</small>
              </article>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>월/부서</th>
                <th>승인 요청</th>
                <th>지급 완료</th>
                <th>차이</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>월별 대사 원장이 없습니다.</td>
                </tr>
              ) : monthlyRows.map((row) => (
                <tr key={`${row.period}-${row.departmentId}`}>
                  <td>
                    <b>{row.period}</b>
                    <small>{row.departmentName}</small>
                  </td>
                  <td>{formatCurrencyWon(row.approvedPaymentAmount)}</td>
                  <td>{formatCurrencyWon(row.completedDisbursementAmount)}</td>
                  <td>{formatCurrencyWon(row.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>범위</th>
                <th>기대</th>
                <th>실제</th>
                <th>차이</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.length === 0 ? (
                <tr>
                  <td colSpan={6}>불일치가 없습니다.</td>
                </tr>
              ) : mismatches.slice(0, 10).map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
                  </td>
                  <td>{item.scope}</td>
                  <td>{formatCurrencyWon(item.expected)}</td>
                  <td>{formatCurrencyWon(item.actual)}</td>
                  <td>{formatCurrencyWon(item.diff)}</td>
                  <td><StatusPill value={item.severity === "critical" ? "위험" : "점검"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.mismatchesTruncated && <p>불일치가 100건을 초과해 일부만 표시됩니다.</p>}
        </>
      )}
    </section>
  );
}

function ManualRecoveryCard({
  draft,
  loading,
  summary,
  onDraftChange,
  onRefresh,
  onRequest,
  onReview,
}: {
  draft: { targetCode: string; nextStatus: string; accountStatus: string; scheduledDate: string; reason: string; reviewReason: string };
  loading: boolean;
  summary: ManualRecoverySummary | null;
  onDraftChange: (draft: { targetCode: string; nextStatus: string; accountStatus: string; scheduledDate: string; reason: string; reviewReason: string }) => void;
  onRefresh: () => void;
  onRequest: () => void;
  onReview: (recoveryId: string, decision: "approve" | "reject") => void;
}) {
  const items = summary?.items ?? [];
  const pending = summary?.pending ?? [];
  const visibleItems = pending.length > 0 ? pending : items.slice(0, 8);
  const proposedText = (value: Record<string, unknown>) =>
    Object.entries(value)
      .map(([key, item]) => `${key}: ${String(item ?? "-")}`)
      .join(" · ");
  return (
    <section className="erp-card manual-recovery-card">
      <header>
        <div>
          <strong>수동 복구 2차 승인</strong>
          <span>{summary ? `대기 ${summary.summary.pending}건 · 승인 ${summary.summary.approved}건 · 반려 ${summary.summary.rejected}건` : "복구 요청 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      <div className="manual-recovery-grid">
        <label>
          지급번호
          <input
            onChange={(event) => onDraftChange({ ...draft, targetCode: event.currentTarget.value })}
            placeholder="PMT-2026-0001"
            value={draft.targetCode}
          />
        </label>
        <label>
          복구 상태
          <select onChange={(event) => onDraftChange({ ...draft, nextStatus: event.currentTarget.value })} value={draft.nextStatus}>
            <option>오류</option>
            <option>보류</option>
            <option>지급 예정</option>
            <option>오늘 지급</option>
          </select>
        </label>
        <label>
          계좌확인
          <select onChange={(event) => onDraftChange({ ...draft, accountStatus: event.currentTarget.value })} value={draft.accountStatus}>
            <option>확인 완료</option>
            <option>확인 대기</option>
            <option>계좌 불일치</option>
            <option>비활성</option>
          </select>
        </label>
        <label>
          지급예정일
          <input
            onChange={(event) => onDraftChange({ ...draft, scheduledDate: event.currentTarget.value })}
            type="date"
            value={draft.scheduledDate}
          />
        </label>
      </div>
      <div className="manual-recovery-actions">
        <label>
          요청 사유
          <input
            onChange={(event) => onDraftChange({ ...draft, reason: event.currentTarget.value })}
            value={draft.reason}
          />
        </label>
        <button disabled={loading || !draft.targetCode.trim() || !draft.reason.trim()} onClick={onRequest} type="button">
          <ShieldCheck size={15} />
          복구 요청
        </button>
      </div>
      <div className="manual-recovery-actions">
        <label>
          검토 사유
          <input
            onChange={(event) => onDraftChange({ ...draft, reviewReason: event.currentTarget.value })}
            value={draft.reviewReason}
          />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>대상</th>
            <th>제안</th>
            <th>요청자</th>
            <th>승인자</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {!summary ? (
            <tr>
              <td colSpan={6}>수동 복구 요청을 불러오지 못했습니다.</td>
            </tr>
          ) : visibleItems.length === 0 ? (
            <tr>
              <td colSpan={6}>수동 복구 요청이 없습니다.</td>
            </tr>
          ) : visibleItems.map((item) => (
            <tr key={item.id}>
              <td>
                <b>{item.targetCode}</b>
                <small>{item.reason}</small>
              </td>
              <td>{proposedText(item.proposed)}</td>
              <td>{item.reviewerName || "-"}</td>
              <td>{item.approverName || "-"}</td>
              <td><StatusPill value={item.status === "pending" ? "대기" : item.status === "approved" ? "승인" : "반려"} /></td>
              <td>
                {item.status === "pending" ? (
                  <div className="manual-recovery-row-actions">
                    <button disabled={loading || !draft.reviewReason.trim()} onClick={() => onReview(item.id, "approve")} type="button">승인</button>
                    <button disabled={loading || !draft.reviewReason.trim()} onClick={() => onReview(item.id, "reject")} type="button">반려</button>
                  </div>
                ) : item.reviewedAt ? item.reviewedAt.slice(0, 16).replace("T", " ") : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AuditIntegrityReportCard({
  loading,
  report,
  onRefresh,
}: {
  loading: boolean;
  report: AuditIntegrityReport | null;
  onRefresh: () => void;
}) {
  const sampledLinks = report?.sampledLinks ?? [];
  const tailHash = report?.summary.tailHash ?? "";
  return (
    <section className="erp-card audit-integrity-report-card">
      <header>
        <div>
          <strong>감사 로그 무결성 리포트</strong>
          <span>{report ? `${report.period.month} · 체인 ${report.summary.chainLength}건 · tail ${tailHash.slice(0, 12)}...` : "감사 로그 hash chain 생성 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>감사 로그 무결성 리포트를 생성하는 중입니다.</p>}
      {!loading && !report && <p>감사 로그 무결성 리포트를 불러오지 못했습니다.</p>}
      {report && (
        <>
          <div className="financial-control-summary">
            <article>
              <span>감사 로그</span>
              <strong>{report.summary.auditLogsReviewed}/{report.summary.totalAuditLogs}</strong>
            </article>
            <article>
              <span>체인 길이</span>
              <strong>{report.summary.chainLength}건</strong>
            </article>
            <article>
              <span>외부 보관</span>
              <strong>{report.externalArchive.configured ? "연계" : "미연계"}</strong>
            </article>
            <article>
              <span>점검</span>
              <strong>{report.summary.checkpointsPassed}/{report.summary.checkpointsTotal}</strong>
            </article>
          </div>
          <div className="retention-check-grid">
            {report.checkpoints.map((item) => (
              <article key={item.id} className={item.ok ? undefined : "attention"}>
                <header>
                  <strong>{item.label}</strong>
                  <StatusPill value={item.ok ? "통과" : item.severity === "critical" ? "차단" : "확인"} />
                </header>
                <b>{item.owner}</b>
                <span>{item.detail}</span>
                <small>{item.evidence}</small>
              </article>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>순서</th>
                <th>대상</th>
                <th>payload hash</th>
                <th>chain hash</th>
              </tr>
            </thead>
            <tbody>
              {sampledLinks.length === 0 ? (
                <tr>
                  <td colSpan={4}>이번 기간 감사 로그가 없어 genesis hash만 생성되었습니다.</td>
                </tr>
              ) : sampledLinks.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>#{item.position}</b>
                    <small>{item.time.slice(0, 16).replace("T", " ")}</small>
                  </td>
                  <td>
                    <b>{item.entityType}</b>
                    <small>{item.action} · {item.requestId}</small>
                  </td>
                  <td>{item.payloadHash.slice(0, 16)}...</td>
                  <td>{item.recordHash.slice(0, 16)}...</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{report.externalArchive.action}</p>
          <p>{report.rawValuePolicy}</p>
        </>
      )}
    </section>
  );
}
function PrivacyAccessReportCard({
  loading,
  report,
  onRefresh,
}: {
  loading: boolean;
  report: PrivacyAccessReport | null;
  onRefresh: () => void;
}) {
  const inventory = report?.inventory ?? [];
  const accessEvents = report?.accessEvents ?? [];
  const auditorEvents = report?.externalAuditorEvents ?? [];
  return (
    <section className="erp-card privacy-access-report-card">
      <header>
        <div>
          <strong>개인정보 접근 리포트</strong>
          <span>{report ? `${report.period.month} · 처리 ${report.summary.inventoryItems}개 · 다운로드 ${report.summary.downloadAccessEvents}건 · 외부 감사 ${report.summary.externalAuditorEvents}건` : "개인정보 처리 현황과 외부 감사 접근 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>개인정보 접근 리포트를 생성하는 중입니다.</p>}
      {!loading && !report && <p>개인정보 접근 리포트를 불러오지 못했습니다.</p>}
      {report && (
        <>
          <div className="financial-control-summary">
            <article>
              <span>처리 항목</span>
              <strong>{report.summary.inventoryItems}개</strong>
            </article>
            <article>
              <span>거래처 계좌</span>
              <strong>{report.summary.encryptedVendors}/{report.summary.vendors}</strong>
            </article>
            <article>
              <span>다운로드 접근</span>
              <strong>{report.summary.downloadAccessEvents}건</strong>
            </article>
            <article>
              <span>외부 감사</span>
              <strong>{report.summary.externalAuditorEvents}건</strong>
            </article>
          </div>
          <div className="retention-check-grid">
            {report.checklist.map((item) => (
              <article key={item.id} className={item.ok ? undefined : "attention"}>
                <header>
                  <strong>{item.label}</strong>
                  <StatusPill value={item.ok ? "통과" : "확인"} />
                </header>
                <b>{item.owner}</b>
                <span>{item.detail}</span>
                <small>{item.evidence}</small>
              </article>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>처리 항목</th>
                <th>건수</th>
                <th>보호 조치</th>
                <th>접근 통제</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.label}</b>
                    <small>{item.storage}</small>
                  </td>
                  <td>{item.count.toLocaleString()}건</td>
                  <td>{item.protection}</td>
                  <td>{item.accessControl}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>접근자</th>
                <th>대상</th>
                <th>사유</th>
                <th>범위</th>
              </tr>
            </thead>
            <tbody>
              {[...accessEvents, ...auditorEvents].slice(0, 8).length === 0 ? (
                <tr>
                  <td colSpan={4}>이번 기간 접근 리포트 대상 이력이 없습니다.</td>
                </tr>
              ) : [...accessEvents, ...auditorEvents].slice(0, 8).map((item) => (
                <tr key={`${item.scope}-${item.id}`}>
                  <td>
                    <b>{item.actorName}</b>
                    <small>{item.actorDepartment}</small>
                  </td>
                  <td>{item.entityType}</td>
                  <td>{item.reason || "사유 누락"}</td>
                  <td><StatusPill value={item.scope === "external_auditor" ? "외부 감사" : "파일 접근"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{report.rawValuePolicy}</p>
        </>
      )}
    </section>
  );
}
function PermissionReviewReportCard({
  loading,
  report,
  onRefresh,
}: {
  loading: boolean;
  report: PermissionReviewReport | null;
  onRefresh: () => void;
}) {
  const exceptions = report?.exceptions ?? [];
  const privilegedUsers = report?.privilegedUsers ?? [];
  const reviewDue = report ? report.period.reviewDueAt.slice(0, 10) : "-";
  return (
    <section className="erp-card permission-review-report-card">
      <header>
        <div>
          <strong>정기 권한 검토 리포트</strong>
          <span>{report ? `${report.period.month} · 특권 ${report.summary.privilegedUsers}명 · 예외 ${report.summary.exceptions}건 · 다음 검토 ${reviewDue}` : "특권 권한과 예외 만료일 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>권한 검토 리포트를 생성하는 중입니다.</p>}
      {!loading && !report && <p>권한 검토 리포트를 불러오지 못했습니다.</p>}
      {report && (
        <>
          <div className="financial-control-summary">
            <article>
              <span>특권 사용자</span>
              <strong>{report.summary.privilegedUsers}명</strong>
            </article>
            <article>
              <span>만료</span>
              <strong>{report.summary.expiredExceptions}건</strong>
            </article>
            <article>
              <span>30일 이내</span>
              <strong>{report.summary.expiringExceptions}건</strong>
            </article>
            <article>
              <span>만료일 없음</span>
              <strong>{report.summary.missingExpiryExceptions}건</strong>
            </article>
          </div>
          <div className="retention-check-grid">
            {report.checklist.map((item) => (
              <article key={item.id} className={item.ok ? undefined : "attention"}>
                <header>
                  <strong>{item.label}</strong>
                  <StatusPill value={item.ok ? "통과" : "확인"} />
                </header>
                <b>{item.owner}</b>
                <span>{item.detail}</span>
                <small>{item.evidence}</small>
              </article>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>사용자</th>
                <th>역할</th>
                <th>권한</th>
                <th>만료</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.length === 0 ? (
                <tr>
                  <td colSpan={5}>검토 대상 예외 권한이 없습니다.</td>
                </tr>
              ) : exceptions.slice(0, 8).map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.userName}</b>
                    <small>{item.departmentName}</small>
                  </td>
                  <td>{item.roleName}</td>
                  <td>
                    <b>{item.permission}</b>
                    <small>{item.action}</small>
                  </td>
                  <td>{item.expiresAt ? item.expiresAt.slice(0, 10) : "미지정"}</td>
                  <td><StatusPill value={item.severity === "critical" ? "위험" : item.severity === "warning" ? "점검" : "정상"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>특권 사용자</th>
                <th>역할</th>
                <th>고위험 권한</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {privilegedUsers.length === 0 ? (
                <tr>
                  <td colSpan={4}>특권 권한을 가진 사용자가 없습니다.</td>
                </tr>
              ) : privilegedUsers.slice(0, 8).map((item) => (
                <tr key={item.userId}>
                  <td>
                    <b>{item.userName}</b>
                    <small>{item.departmentName}</small>
                  </td>
                  <td>{item.roles.join(", ") || "-"}</td>
                  <td>{item.highRiskPermissions.join(", ")}</td>
                  <td><StatusPill value={item.reviewStatus === "blocked" ? "위험" : item.reviewStatus === "review" ? "점검" : "정상"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
function FinancialControlReportCard({
  loading,
  report,
  onRefresh,
}: {
  loading: boolean;
  report: FinancialControlReport | null;
  onRefresh: () => void;
}) {
  const exceptions = report?.exceptions ?? [];
  return (
    <section className="erp-card financial-control-report-card">
      <header>
        <div>
          <strong>재무 통제 리포트</strong>
          <span>{report ? `${report.period.month} · 점검 ${report.summary.checklistPassed}/${report.summary.checklistTotal}개 통과 · 예외 ${report.summary.exceptions}건` : "월말 결산 점검표 조회 대기"}</span>
        </div>
        <button onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          새로고침
        </button>
      </header>
      {loading && <p>재무 통제 리포트를 생성하는 중입니다.</p>}
      {!loading && !report && <p>재무 통제 리포트를 불러오지 못했습니다.</p>}
      {report && (
        <>
          <div className="financial-control-summary">
            <article>
              <span>예외</span>
              <strong>{report.summary.exceptions}건</strong>
            </article>
            <article>
              <span>위험</span>
              <strong>{report.summary.criticalExceptions}건</strong>
            </article>
            <article>
              <span>수동 복구 대기</span>
              <strong>{report.summary.manualRecoveryPending}건</strong>
            </article>
            <article>
              <span>은행 대사</span>
              <strong>{report.summary.bankReconcileCount}건</strong>
            </article>
          </div>
          <div className="retention-check-grid">
            {report.checklist.map((item) => (
              <article key={item.id} className={item.ok ? undefined : "attention"}>
                <header>
                  <strong>{item.label}</strong>
                  <StatusPill value={item.ok ? "통과" : "확인"} />
                </header>
                <b>{item.owner}</b>
                <span>{item.detail}</span>
                <small>{item.evidence}</small>
              </article>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>예외</th>
                <th>범위</th>
                <th>원천</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.length === 0 ? (
                <tr>
                  <td colSpan={4}>재무 통제 예외가 없습니다.</td>
                </tr>
              ) : exceptions.slice(0, 10).map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
                  </td>
                  <td>{item.scope}</td>
                  <td>{item.source}</td>
                  <td><StatusPill value={item.severity === "critical" ? "위험" : item.severity === "warning" ? "점검" : "정보"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SettingsHistoryPanel({ history }: { history: SettingsHistoryItem[] }) {
  const [filterIndex, setFilterIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(8);
  const filterOptions = ["전체", "정책 변경", "권한 변경", "사용자 변경", "알림 변경", "연동 변경", "운영 변경"];
  const activeFilter = filterOptions[filterIndex];
  const filteredHistory = activeFilter === "전체" ? history : history.filter((item) => item.tag === activeFilter);
  return (
    <aside className="settings-history-panel">
      <header>
        <strong>변경 이력</strong>
        <button onClick={() => setFilterIndex((current) => (current + 1) % filterOptions.length)} type="button">{activeFilter} <ChevronDown size={15} /></button>
      </header>
      <section>
        <b>최근 변경</b>
        {filteredHistory.slice(0, visibleCount).map((item, index) => (
          <article key={item.id}>
            <i className={index === 0 ? "active" : undefined} />
            <time>{item.time}</time>
            <strong>{item.user}</strong>
            <span>{item.desc}</span>
            <small>{item.tag}</small>
          </article>
        ))}
      </section>
      <button className="history-more" disabled={visibleCount >= filteredHistory.length} onClick={() => setVisibleCount((current) => current + 5)} type="button">더보기</button>
    </aside>
  );
}

function FavoritesBody({ currentUser, page }: { currentUser: AuthUser; page: PageDefinition }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>(initialFavoriteItems);
  const [selectedId, setSelectedId] = useState(initialFavoriteItems[0]?.id ?? "");
  const [typeFilter, setTypeFilter] = useState(favoriteTypeOptions[0]);
  const [favoriteMessage, setFavoriteMessage] = useState("자주 쓰는 메뉴, 저장 필터, 최근 사용 목록이 사용자별 즐겨찾기로 연결됩니다.");
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesMutating, setFavoritesMutating] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [lastDeleted, setLastDeleted] = useState<FavoriteItem | null>(null);
  const [showAllSavedFilters, setShowAllSavedFilters] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(true);
  const [favoriteSyncVersion, setFavoriteSyncVersion] = useState(0);
  const [favoriteSyncReason, setFavoriteSyncReason] = useState<"initial" | "manual" | "focus">("initial");
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft>({
    title: "예산 초과 알림",
    target: "budget",
    filters: "예산상태: 주의, 예산상태: 초과",
    shared: "개인",
  });

  useEffect(() => {
    let cancelled = false;
    async function loadFavorites() {
      setFavoritesLoading(true);
      try {
        const response = await erpApi.listPageRows("favorites", { page: 1, pageSize: 100, sort: "순서:asc" });
        if (cancelled) return;
        const loaded = response.data.rows.map((row, index) => favoriteFromRow(row, index, currentUser.name));
        setFavorites(loaded.length > 0 ? loaded : []);
        setSelectedId((current) => loaded.some((item) => item.id === current) ? current : loaded[0]?.id ?? "");
        setFavoriteMessage(
          favoriteSyncReason === "manual"
            ? "backend FavoriteItem에서 사용자 즐겨찾기와 저장 필터를 다시 동기화했습니다."
            : favoriteSyncReason === "focus"
              ? "다른 브라우저/탭 변경 가능성을 반영해 사용자 즐겨찾기를 다시 불러왔습니다."
              : "backend FavoriteItem 기준으로 사용자 즐겨찾기를 불러왔습니다.",
        );
      } catch (error) {
        if (cancelled) return;
        setFavoriteMessage(`즐겨찾기 조회 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }
    void loadFavorites();
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, currentUser.name, favoriteSyncReason, favoriteSyncVersion]);

  useEffect(() => {
    const syncFromFocus = () => {
      if (document.visibilityState !== "visible" || favoritesMutating) return;
      setFavoriteSyncReason("focus");
      setFavoriteSyncVersion((current) => current + 1);
    };
    window.addEventListener("focus", syncFromFocus);
    document.addEventListener("visibilitychange", syncFromFocus);
    return () => {
      window.removeEventListener("focus", syncFromFocus);
      document.removeEventListener("visibilitychange", syncFromFocus);
    };
  }, [favoritesMutating]);

  const handleSyncFavorites = () => {
    setFavoriteSyncReason("manual");
    setFavoriteSyncVersion((current) => current + 1);
  };

  const selectedFavorite = favorites.find((item) => item.id === selectedId) ?? favorites[0] ?? null;
  const visibleFavorites = favorites.filter((item) => {
    if (typeFilter === "전체 유형") return true;
    if (typeFilter === "비활성") return item.status === "비활성";
    return item.type === typeFilter;
  });
  const menuFavorites = favorites.filter((item) => item.type !== "필터" && item.status === "활성").slice(0, 6);
  const savedFilters = favorites.filter((item) => item.type === "필터");
  const visibleSavedFilters = showAllSavedFilters ? savedFilters : savedFilters.slice(0, 4);
  const recentFavorites = sortFavoritesByRecentUse(visibleFavorites);
  const visibleRecentFavorites = showAllRecent ? recentFavorites : recentFavorites.slice(0, 10);

  const handleSelectFavorite = (favoriteId: string) => {
    setSelectedId(favoriteId);
    setDetailOpen(true);
  };

  const handleCycleTypeFilter = () => {
    const nextFilter = favoriteTypeOptions[(favoriteTypeOptions.indexOf(typeFilter) + 1) % favoriteTypeOptions.length];
    setTypeFilter(nextFilter);
    setFavoriteMessage(`${nextFilter} 기준으로 즐겨찾기 목록을 표시합니다.`);
  };

  const handleAddShortcut = async () => {
    const shortcutTitle = shortcutDraft.title.trim() || "새 바로가기";
    const existing = favorites.find((item) => item.title === shortcutTitle);
    if (existing) {
      setSelectedId(existing.id);
      setFavoriteMessage("이미 추가된 즐겨찾기입니다.");
      return;
    }
    setFavoritesMutating(true);
    try {
      const draftFilters = favoriteFiltersFromTags(splitFavoriteTags(shortcutDraft.filters), shortcutDraft.target);
      const response = await erpApi.createPageRow("favorites", {
        항목명: shortcutTitle,
        유형: "메뉴",
        설명: `#${shortcutDraft.target}`,
        대상화면: shortcutDraft.target,
        상태: "활성",
        순서: String(favorites.length + 1),
        필터: shortcutDraft.filters,
        필터JSON: JSON.stringify(draftFilters),
        공유: shortcutDraft.shared.trim() || "개인",
        idempotencyKey: favoriteMutationKey("create", shortcutTitle),
      });
      const newFavorite = favoriteFromRow(response.data, favorites.length, currentUser.name);
      setFavorites((current) => [...current, newFavorite]);
      setSelectedId(newFavorite.id);
      setDetailOpen(true);
      setFavoriteMessage(`${currentUser.name} 사용자 즐겨찾기에 바로가기가 추가되어 backend FavoriteItem으로 저장되었습니다.`);
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 추가 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoritesMutating(false);
    }
  };

  const handleReorderFavorite = async () => {
    if (!selectedFavorite || favorites.length <= 1) return;
    const currentIndex = favorites.findIndex((item) => item.id === selectedFavorite.id);
    const reordered = [...favorites];
    const [target] = reordered.splice(currentIndex, 1);
    if (currentIndex <= 0) {
      reordered.push(target);
    } else {
      reordered.splice(currentIndex - 1, 0, target);
    }
    setFavoritesMutating(true);
    try {
      const responses = await Promise.all(reordered.map((item, index) => erpApi.updatePageRow("favorites", item.title, {
        순서: String(index + 1),
        rowVersion: item.rowVersion ?? "1",
        즐겨찾기RowVersion: item.rowVersion ?? "1",
        idempotencyKey: favoriteMutationKey("reorder", item),
      })));
      const updatedRows = responses.flatMap((response) => response.data ? [response.data] : []);
      setFavorites(reordered.map((item, index) => {
        const updated = updatedRows.find((row) => row.ID === item.id || row.항목명 === item.title);
        return updated ? favoriteFromRow(updated, index, currentUser.name) : item;
      }));
      setFavoriteMessage(`${selectedFavorite.title} 순서를 편집하고 backend FavoriteItem.sortOrder에 저장했습니다.`);
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 순서 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoritesMutating(false);
    }
  };

  const handleDeleteFavorite = async () => {
    if (!selectedFavorite) return;
    setFavoritesMutating(true);
    try {
      await erpApi.deletePageRow("favorites", selectedFavorite.title, {
        rowVersion: selectedFavorite.rowVersion ?? "1",
        즐겨찾기RowVersion: selectedFavorite.rowVersion ?? "1",
        idempotencyKey: favoriteMutationKey("delete", selectedFavorite),
      });
      const remaining = favorites.filter((item) => item.id !== selectedFavorite.id);
      setFavorites(remaining);
      setLastDeleted(selectedFavorite);
      setSelectedId(remaining[0]?.id ?? "");
      setFavoriteMessage(`${selectedFavorite.title} 즐겨찾기를 삭제하고 backend에서 비활성화했습니다. undo로 복구할 수 있습니다.`);
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 삭제 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoritesMutating(false);
    }
  };

  const handleOpenFavorite = async () => {
    if (!selectedFavorite) return;
    if (selectedFavorite.status === "비활성") {
      setFavoriteMessage("비활성 메뉴는 열기와 신규 바로가기 추가를 차단하고 조회와 삭제만 허용합니다.");
      return;
    }
    const route = favoritePageForItem(selectedFavorite);
    if (!canAccessPage(currentUser, route)) {
      const fallbackPage = getDefaultPage(currentUser);
      setFavoriteMessage(`${selectedFavorite.title} 대상 화면 권한이 회수되어 ${pages[fallbackPage].title} 화면으로 이동합니다.`);
      goToPage(fallbackPage);
      return;
    }
    const unsupportedFilterFields = favoriteUnsupportedFilterFields(selectedFavorite);
    try {
      const response = await erpApi.updatePageRow("favorites", selectedFavorite.title, {
        최근사용: new Date().toISOString(),
        rowVersion: selectedFavorite.rowVersion ?? "1",
        즐겨찾기RowVersion: selectedFavorite.rowVersion ?? "1",
        idempotencyKey: favoriteMutationKey("open", selectedFavorite),
      });
      if (response.data) {
        const updated = favoriteFromRow(response.data, favorites.findIndex((item) => item.id === selectedFavorite.id), currentUser.name);
        setFavorites((current) => current.map((item) => (item.id === selectedFavorite.id ? updated : item)));
      }
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 사용 기록 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
      return;
    }
    applyFavoriteRouteState(selectedFavorite);
    setFavoriteMessage(unsupportedFilterFields.length > 0
      ? `${selectedFavorite.title} 바로가기를 열었습니다. 삭제되었거나 현재 화면에서 지원하지 않는 필터 ${unsupportedFilterFields.join(", ")} 조건은 제외했습니다.`
      : `${selectedFavorite.title} 바로가기를 열고 서버 저장 라우트, 필터, 정렬 조건을 적용했습니다.`);
    goToPage(route);
  };

  const restoreDeletedFavorite = async () => {
    if (!lastDeleted) return;
    setFavoritesMutating(true);
    try {
      const response = await erpApi.updatePageRow("favorites", lastDeleted.title, {
        상태: "활성",
        순서: "1",
        rowVersion: lastDeleted.rowVersion ?? "1",
        즐겨찾기RowVersion: lastDeleted.rowVersion ?? "1",
        idempotencyKey: favoriteMutationKey("restore", lastDeleted),
      });
      const restored = response.data ? favoriteFromRow(response.data, 0, currentUser.name) : lastDeleted;
      setFavorites((current) => [restored, ...current]);
      setSelectedId(restored.id);
      setLastDeleted(null);
      setFavoriteMessage(`${lastDeleted.title} 즐겨찾기를 복구하고 backend에서 활성화했습니다.`);
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 복구 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoritesMutating(false);
    }
  };

  const handleSaveUserFavorites = async () => {
    setFavoritesMutating(true);
    try {
      const responses = await Promise.all(favorites.map((item, index) => erpApi.updatePageRow("favorites", item.title, {
        ...favoriteToRow(item, index),
        idempotencyKey: favoriteMutationKey("save", item),
      })));
      const updatedRows = responses.flatMap((response) => response.data ? [response.data] : []);
      setFavorites((current) => current.map((item, index) => {
        const updated = updatedRows.find((row) => row.ID === item.id || row.항목명 === item.title);
        return updated ? favoriteFromRow(updated, index, currentUser.name) : item;
      }));
      setFavoriteMessage(`${currentUser.name} 사용자별 즐겨찾기를 backend FavoriteItem API에 저장했습니다.`);
    } catch (error) {
      setFavoriteMessage(`즐겨찾기 저장 실패: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setFavoritesMutating(false);
    }
  };

  return (
    <div className="favorites-management-page">
      <section className="management-main-column">
        <FavoritesToolbar
          filterLabel={typeFilter}
          isSyncing={favoritesLoading}
          message={favoritesLoading ? "backend FavoriteItem에서 즐겨찾기를 불러오는 중입니다." : favoritesMutating ? "즐겨찾기 변경 사항을 backend에 저장하는 중입니다." : favoriteMessage}
          page={page}
          onAddShortcut={handleAddShortcut}
          onCycleFilter={handleCycleTypeFilter}
          onReorder={handleReorderFavorite}
          onSaveUserFavorites={handleSaveUserFavorites}
          onSyncFavorites={handleSyncFavorites}
        />
        <ShortcutDraftPanel draft={shortcutDraft} onDraftChange={setShortcutDraft} />
        {lastDeleted && (
          <div className="favorite-undo-bar">
            <span>{lastDeleted.title} 삭제됨</span>
            <button onClick={restoreDeletedFavorite} type="button">undo</button>
          </div>
        )}
        <FavoriteMenuCards items={menuFavorites} selectedId={selectedId} onSelect={handleSelectFavorite} />
        <SavedFilterCards
          filters={visibleSavedFilters}
          selectedId={selectedId}
          showAll={showAllSavedFilters}
          totalCount={savedFilters.length}
          onSelect={handleSelectFavorite}
          onShowAll={() => {
            setShowAllSavedFilters((current) => !current);
            setFavoriteMessage(showAllSavedFilters ? "저장된 필터 일부를 표시합니다." : "저장된 필터 전체 목록을 표시합니다.");
          }}
        />
        <FavoriteRecentTable
          rows={visibleRecentFavorites}
          selectedId={selectedId}
          showAll={showAllRecent}
          totalCount={visibleFavorites.length}
          onSelect={handleSelectFavorite}
          onShowAll={() => {
            setShowAllRecent((current) => !current);
            setFavoriteMessage(showAllRecent ? "최근 사용 일부를 표시합니다." : "최근 사용 전체 이력을 표시합니다.");
          }}
        />
      </section>
      {detailOpen ? (
        <FavoriteDetailPanel
          favorite={selectedFavorite}
          onAddShortcut={handleAddShortcut}
          onClose={() => setDetailOpen(false)}
          onDelete={handleDeleteFavorite}
          onOpen={handleOpenFavorite}
          onReorder={handleReorderFavorite}
        />
      ) : (
        <ClosedDetailPanel title="즐겨찾기 상세" onOpen={() => setDetailOpen(true)} />
      )}
    </div>
  );
}

function ShortcutDraftPanel({ draft, onDraftChange }: { draft: ShortcutDraft; onDraftChange: (draft: ShortcutDraft) => void }) {
  return (
    <section className="shortcut-draft-panel" aria-label="바로가기 추가 입력">
      <label>
        이름
        <input aria-label="바로가기 이름 입력" onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} value={draft.title} />
      </label>
      <label>
        대상 화면
        <select aria-label="바로가기 대상 화면 선택" onChange={(event) => onDraftChange({ ...draft, target: event.currentTarget.value as PageKey })} value={draft.target}>
          {pageOrder.map((pageKey) => (
            <option key={pageKey} value={pageKey}>{pages[pageKey].title}</option>
          ))}
        </select>
      </label>
      <label>
        필터 조건
        <input aria-label="바로가기 필터 조건 입력" onChange={(event) => onDraftChange({ ...draft, filters: event.currentTarget.value })} value={draft.filters} />
      </label>
      <label>
        공유 범위
        <select aria-label="바로가기 공유 범위 선택" onChange={(event) => onDraftChange({ ...draft, shared: event.currentTarget.value })} value={draft.shared}>
          {["개인", "재무팀", "팀", "관리자"].map((scope) => (
            <option key={scope} value={scope}>{scope}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

function FavoritesToolbar({
  filterLabel,
  isSyncing,
  message,
  page,
  onAddShortcut,
  onCycleFilter,
  onReorder,
  onSaveUserFavorites,
  onSyncFavorites,
}: {
  filterLabel: string;
  isSyncing: boolean;
  message: string;
  page: PageDefinition;
  onAddShortcut: () => void;
  onCycleFilter: () => void;
  onReorder: () => void;
  onSaveUserFavorites: () => void;
  onSyncFavorites: () => void;
}) {
  return (
    <div className="favorites-toolbar-wrap">
      <div className="favorites-toolbar">
        <button className="management-filter" onClick={onCycleFilter} type="button">
          {filterLabel}
          <ChevronDown size={16} />
        </button>
        <div>
          <button className="management-primary-button" onClick={onAddShortcut} type="button">바로가기 추가</button>
          <button className="management-secondary-button" onClick={onReorder} type="button">순서 편집</button>
          <button className="management-secondary-button" disabled={isSyncing} onClick={onSyncFavorites} type="button">
            <RefreshCw size={15} />
            동기화
          </button>
          <button className="management-secondary-button" onClick={onSaveUserFavorites} type="button">사용자 저장</button>
        </div>
      </div>
      <p className="favorites-message" aria-live="polite">
        <b>{page.title}</b>
        {message}
      </p>
    </div>
  );
}

function FavoriteMenuCards({ items, selectedId, onSelect }: { items: FavoriteItem[]; selectedId: string; onSelect: (favoriteId: string) => void }) {
  return (
    <section className="favorites-section">
      <h2>자주 쓰는 메뉴</h2>
      <div className="favorite-card-grid">
        {items.map((item) => {
          const Icon = favoriteIconMap[item.iconKey];
          return (
            <button className={selectedId === item.id ? "selected" : undefined} key={item.id} onClick={() => onSelect(item.id)} type="button">
              <b className="drag-handle">⋮⋮</b>
              <span className={`favorite-icon ${item.tone}`}>
                <Icon size={23} />
              </span>
              <Star className="filled" size={18} />
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SavedFilterCards({
  filters,
  showAll,
  selectedId,
  totalCount,
  onSelect,
  onShowAll,
}: {
  filters: FavoriteItem[];
  showAll: boolean;
  selectedId: string;
  totalCount: number;
  onSelect: (favoriteId: string) => void;
  onShowAll: () => void;
}) {
  return (
    <section className="favorites-section">
      <header>
        <h2>저장된 필터</h2>
        <button onClick={onShowAll} type="button">{showAll ? "접기" : "전체 보기"} ({totalCount}) <ChevronRight size={15} /></button>
      </header>
      <div className="saved-filter-grid">
        {filters.map((item) => (
          <button className={selectedId === item.id ? "selected" : undefined} key={item.id} onClick={() => onSelect(item.id)} type="button">
            <b className="drag-handle">⋮⋮</b>
            <Star className="filled" size={17} />
            <strong>{item.title}</strong>
            <span>{item.description}</span>
            <p>
              {item.filterTags.map((tag) => (
                <small key={tag}>{tag}</small>
              ))}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function FavoriteRecentTable({
  showAll,
  rows,
  selectedId,
  totalCount,
  onSelect,
  onShowAll,
}: {
  showAll: boolean;
  rows: FavoriteItem[];
  selectedId: string;
  totalCount: number;
  onSelect: (favoriteId: string) => void;
  onShowAll: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);
  return (
    <section className="erp-card favorite-table-card">
      <header>
        <strong>최근 사용</strong>
        <button onClick={onShowAll} type="button">{showAll ? "접기" : "전체 보기"} ({totalCount}) <ChevronRight size={15} /></button>
      </header>
      <table className="favorite-table">
        <thead>
          <tr>
            {["", "항목명", "유형", "설명", "최근 사용", "소유자", "상태", ""].map((column, index) => (
              <th key={`${column}-${index}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, index) => {
            const Icon = favoriteIconMap[row.iconKey];
            return (
              <tr className={selectedId === row.id ? "selected" : undefined} key={row.id} onClick={() => onSelect(row.id)}>
                <td>⋮⋮ <Star className={row.status === "활성" ? "filled" : undefined} size={16} /></td>
                <td><span className={`favorite-row-icon tone-${index % 5}`}><Icon size={15} /></span>{row.title}</td>
                <td>{row.type}</td>
                <td>{row.description}</td>
                <td>{row.recentUsed}</td>
                <td>{row.owner}</td>
                <td><StatusPill value={row.status} /></td>
                <td>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row.id);
                    }}
                    type="button"
                  >
                    선택
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer className="management-table-footer">
        <span>전체 {rows.length}개</span>
        <div>
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">‹</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button className={pageNumber === page ? "active" : undefined} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>
          ))}
          <button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">›</button>
        </div>
        <button className="rows-select" onClick={() => setPageSize((current) => (current === 20 ? 10 : 20))} type="button">{pageSize}개씩</button>
      </footer>
    </section>
  );
}

function FavoriteDetailPanel({
  favorite,
  onAddShortcut,
  onClose,
  onDelete,
  onOpen,
  onReorder,
}: {
  favorite: FavoriteItem | null;
  onAddShortcut: () => void;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onReorder: () => void;
}) {
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  if (!favorite) {
    return (
      <aside className="management-detail-panel favorite-detail-panel" aria-label="상세 정보">
        <header className="management-detail-head">
          <strong>상세 정보</strong>
        </header>
        <section className="favorite-detail-hero">
          <h2>선택된 즐겨찾기 없음</h2>
          <p>바로가기를 추가하면 상세 정보가 표시됩니다.</p>
        </section>
      </aside>
    );
  }

  const Icon = favoriteIconMap[favorite.iconKey];

  return (
    <aside className="management-detail-panel favorite-detail-panel" aria-label="상세 정보">
      <header className="management-detail-head">
        <strong>상세 정보</strong>
        <button aria-label="닫기" onClick={onClose} type="button">
          <X size={20} />
        </button>
      </header>
      <section className="favorite-detail-hero">
        <Star className={favorite.status === "활성" ? "filled" : undefined} size={22} />
        <span className={`favorite-icon ${favorite.tone}`}>
          <Icon size={31} />
        </span>
        <h2>{favorite.title}</h2>
        <small>{favorite.type}</small>
        <p>{favorite.description}</p>
        <dl>
          <dt>소유자</dt>
          <dd>{favorite.owner}</dd>
          <dt>상태</dt>
          <dd>{favorite.status}</dd>
          <dt>최근 사용</dt>
          <dd>{favorite.recentUsed}</dd>
          <dt>사용 횟수</dt>
          <dd>{favorite.usageCount}회</dd>
          <dt>공유</dt>
          <dd>{favorite.shared}</dd>
        </dl>
      </section>
      <section className="favorite-related-actions">
        <strong>관련 작업</strong>
        <button disabled={favorite.status === "비활성"} onClick={onOpen} type="button">
          열기
          <span>↗</span>
        </button>
        <button disabled={favorite.status === "비활성"} onClick={onAddShortcut} type="button">
          바로가기 추가
          <span>+</span>
        </button>
        <button onClick={onReorder} type="button">
          순서 편집
          <span>↕</span>
        </button>
        <button className="delete" onClick={() => setDeleteConfirmOpen(true)} type="button">
          삭제
          <span>⌫</span>
        </button>
        {deleteConfirmOpen && (
          <div className="favorite-delete-confirm">
            <span>삭제 후 undo로 복구할 수 있습니다.</span>
            <button onClick={onDelete} type="button">삭제 확인</button>
            <button onClick={() => setDeleteConfirmOpen(false)} type="button">취소</button>
          </div>
        )}
      </section>
      <section className="panel-card connected-filter-card">
        <strong>연결된 필터</strong>
        {(showAllFilters ? favorite.filterTags : favorite.filterTags.slice(0, 2)).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
        <button onClick={() => setShowAllFilters((current) => !current)} type="button">
          {showAllFilters ? "접기" : "더보기"} ({favorite.filterTags.length}) <ChevronDown size={15} />
        </button>
      </section>
      <section className="panel-card connected-filter-card">
        <strong>비활성 메뉴 기준</strong>
        <span>비활성 메뉴는 신규 바로가기 추가를 차단하고 기존 항목은 조회와 삭제만 허용합니다.</span>
      </section>
    </aside>
  );
}

function KpiCard({ item, onClick }: { item: KpiItem; onClick?: () => void }) {
  const icons = {
    amber: Clock3,
    blue: Calendar,
    green: CheckCircle2,
    red: XCircle,
    teal: TrendingUp,
    navy: Gauge,
  };
  const Icon = icons[item.tone];
  const content = (
    <>
      <div>
        <Icon size={24} />
      </div>
      <span>{item.label}</span>
      <ChevronRight className="kpi-arrow" size={18} />
      <p className="kpi-value-row">
        <b>{item.value}</b>
        {item.suffix && <em>{item.suffix}</em>}
        {item.amount && <strong>{item.amount}</strong>}
      </p>
      <small className={item.footerTone ? `kpi-footer footer-${item.footerTone}` : "kpi-footer"}>
        {item.footer ?? item.detail}
      </small>
    </>
  );

  if (onClick) {
    return (
      <button className={`kpi-card kpi-button ${item.tone}`} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <article className={`kpi-card ${item.tone}`}>
      {content}
    </article>
  );
}

function CardHeader({ action, onAction, title }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <header className="erp-card-head">
      <strong>{title}</strong>
      {action && (
        <button onClick={onAction} type="button">
          {action}
          <ChevronRight size={14} />
        </button>
      )}
    </header>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill ${statusClass(value)}`}>{value}</span>;
}

function statusClass(status: string) {
  if (status.includes("반려") || status.includes("오류") || status.includes("초과") || status.includes("비활성")) return "rejected";
  if (status.includes("대기") || status.includes("예정") || status.includes("주의") || status.includes("긴급")) return "pending";
  if (status.includes("진행") || status.includes("확인 중") || status.includes("작성 중") || status.includes("검증 대기")) return "progress";
  if (status.includes("보류") || status.includes("미확인") || status.includes("확인 전")) return "neutral";
  return "done";
}

function isStatusColumn(column: string) {
  return ["상태", "결재상태", "예산확인", "지급상태", "계좌확인"].includes(column);
}

function Donut({ value, tone, label }: { value: number; tone: "teal" | "navy"; label: string }) {
  const color = tone === "teal" ? "#18b797" : "#082e68";
  const style = { "--value": `${value}%`, "--donut-color": color } as CSSProperties;
  return (
    <div className="erp-donut" style={style}>
      <span>{value}%</span>
      <small>{label}</small>
    </div>
  );
}

function MiniBars({ compact = false }: { compact?: boolean }) {
  const values = compact ? [38, 58, 46, 70, 52] : [42, 70, 55, 86, 62, 74];
  return (
    <div className={compact ? "mini-chart compact" : "mini-chart"} aria-hidden="true">
      {values.map((height, index) => (
        <div key={index}>
          <i style={{ height: `${height}px` }} />
          <em style={{ height: `${Math.max(28, 94 - height)}px` }} />
        </div>
      ))}
    </div>
  );
}

function ProgressList({ compact = false }: { compact?: boolean }) {
  const items = compact
    ? [
        ["승인 완료", "92%"],
        ["승인 진행", "6%"],
        ["반려", "2%"],
      ]
    : [
        ["마케팅 예산", "24,000,000 원"],
        ["사용 금액", "17,280,000 원"],
        ["잔여 예산", "6,720,000 원"],
      ];
  return (
    <div className="progress-list">
      {items.map(([label, value], index) => (
        <p key={label}>
          <span>{label}</span>
          <b>{value}</b>
          <i style={{ width: `${compact ? 70 - index * 18 : 72 - index * 14}%` }} />
        </p>
      ))}
    </div>
  );
}

function PaymentBreakdown() {
  return (
    <div className="payment-breakdown">
      <div className="breakdown-totals">
        <span>
          요청 건수 <b>23 건</b>
        </span>
        <span>
          요청 금액 <b>38,560,000 원</b>
        </span>
      </div>
      {[
        ["승인 대기", "5 건", "8,750,000 원", "pending"],
        ["승인 진행 중", "7 건", "12,460,000 원", "progress"],
        ["승인 완료", "11 건", "17,350,000 원", "done"],
      ].map(([label, count, amount, tone]) => (
        <p key={label}>
          <i className={tone} />
          <span>{label}</span>
          <b>{count}</b>
          <strong>{amount}</strong>
        </p>
      ))}
    </div>
  );
}

const rootElement = document.getElementById("root")!;
const root = window.__paymentApprovalRoot ?? createRoot(rootElement);
window.__paymentApprovalRoot = root;

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
