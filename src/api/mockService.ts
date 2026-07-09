import { createPageRow, deletePageRow as deleteMockPageRow, executePageAction as executeMockPageAction, getPageRow, listPageRows, updatePageRow } from "./mockApi";
import { budgetRows, disbursementRows, mockCurrentUser, notificationRows, paymentRows, reportRows, settingsRows, vendorRows } from "../mockData";
import type { ListQuery, MockApiResponse, TableRow } from "../types";
import type {
  AccountLifecycleDeactivateResult,
  AccountLifecycleSummary,
  AuditLogSearchResult,
  BudgetAdjustmentActionResult,
  BudgetAdjustmentInput,
  BudgetAdjustmentResult,
  BankResultReconcileSummary,
  BankTransferExport,
  ErpApiService,
  FileDto,
  FinancialReconciliationNotifyResult,
  FinancialReconciliationSummary,
  FinancialControlReport,
  PermissionReviewReport,
  IntegrationTestInput,
  IntegrationTestResult,
  ManualRecoveryItem,
  ManualRecoveryRequestInput,
  ManualRecoveryResult,
  ManualRecoveryReviewInput,
  ManualRecoverySummary,
  BusinessFailureAlertSummary,
  OperationModeStatus,
  OperationalAlertSummary,
  PasswordChangeResult,
  PasswordPolicySummary,
  PerformancePolicyStatus,
  ReportDownload,
  ReportDownloadFormat,
  ReportJobRunInput,
  ReportJobRunResult,
  RetentionPolicySummary,
  ReportScheduleDto,
  ReportScheduleInput,
  RoleSettingsDto,
  SystemSettingHistoryRow,
  SystemSettingKey,
  SystemSettingsSnapshot,
} from "./service";

let mockNotificationStore = notificationRows.map((notification) => ({ ...notification }));
const mockFileStore = new Map<string, FileDto>();
const mockRoleSettingsStore = new Map<string, RoleSettingsDto>();
const mockSystemSettingsStore = new Map<SystemSettingKey, unknown>();
const mockSystemSettingsVersionStore = new Map<SystemSettingKey, { auditLogId: string | null; updatedAt: string | null }>();
const mockSystemSettingsIdempotencyStore = new Map<string, { key: SystemSettingKey; value: unknown; auditLogId: string }>();
const mockIntegrationTestIdempotencyStore = new Map<string, IntegrationTestResult>();
const mockReportScheduleStore = new Map<string, ReportScheduleDto>();
const mockBudgetAdjustmentStore = new Map<string, TableRow[]>();
let mockManualRecoveryStore: ManualRecoveryItem[] = [];
const mockSystemSettingHistoryStore: SystemSettingHistoryRow[] = [
  { id: "mock-history-1", time: "2024-06-01 14:30", user: `${mockCurrentUser.name} (${mockCurrentUser.departmentName})`, desc: "결재 정책 저장", tag: "정책 변경" },
  { id: "mock-history-2", time: "2024-06-01 11:05", user: "이수연 대리 (마케팅팀)", desc: "사용자 권한 수정 (구매팀)", tag: "사용자 변경" },
  { id: "mock-history-3", time: "2024-05-31 16:42", user: "박정우 대리 (구매팀)", desc: "권한 그룹 수정 (승인자)", tag: "권한 변경" },
  { id: "mock-history-4", time: "2024-05-29 15:22", user: "조현우 대리 (재무팀)", desc: "알림 설정 저장", tag: "알림 변경" },
  { id: "mock-history-5", time: "2024-05-28 10:07", user: "김연구 대리 (IT운영팀)", desc: "외부 연동 설정 저장", tag: "연동 변경" },
];

const mockSystemSettingLabels: Record<SystemSettingKey, { desc: string; tag: string }> = {
  approvalPolicy: { desc: "결재 정책 저장", tag: "정책 변경" },
  notifications: { desc: "알림 설정 저장", tag: "알림 변경" },
  integrations: { desc: "외부 연동 설정 저장", tag: "연동 변경" },
};

const mockPasswordPolicy: PasswordPolicySummary = {
  minLength: 12,
  maxAgeDays: 90,
  requirements: ["최소 12자", "대문자 1자 이상", "소문자 1자 이상", "숫자 1자 이상", "특수문자 1자 이상"],
};

function buildMockRetentionPolicySummary(): RetentionPolicySummary {
  const now = new Date().toISOString();
  const expiredNotifications = mockNotificationStore.filter((notification) => notification.expiresAt && new Date(notification.expiresAt).getTime() <= Date.now()).length;
  const policies: RetentionPolicySummary["policies"] = [
    {
      entityType: "audit_log",
      label: "감사 로그",
      retentionDays: 2555,
      retentionLabel: "2555일",
      clockField: "createdAt",
      immutable: true,
      hardDeleteAllowed: false,
      legalHoldSupported: true,
      disposition: "7년 보관 후 감사/법무 승인 기반 아카이브",
      protectedFields: ["entityType", "entityId", "actorId", "action", "beforeValue", "afterValue", "requestId", "createdAt"],
      operatorAction: "보관 만료 대상은 외부 WORM 또는 감사 저장소로 내보낸 뒤 삭제하지 않습니다.",
      deletionPolicy: "물리 삭제 금지",
    },
    {
      entityType: "notification",
      label: "알림",
      retentionDays: 90,
      retentionLabel: "90일",
      clockField: "expiresAt",
      immutable: false,
      hardDeleteAllowed: true,
      legalHoldSupported: false,
      disposition: "90일 후 만료",
      protectedFields: ["userId", "type", "entityType", "entityId", "createdAt"],
      operatorAction: "만료 알림은 정기 정리 작업으로 삭제할 수 있습니다.",
      deletionPolicy: "만료 후 정리 가능",
    },
    {
      entityType: "attachment_metadata",
      label: "첨부 파일 metadata",
      retentionDays: 2555,
      retentionLabel: "2555일",
      clockField: "createdAt",
      immutable: true,
      hardDeleteAllowed: false,
      legalHoldSupported: true,
      disposition: "제출 이후 업무 증빙 metadata 7년 보관",
      protectedFields: ["ownerType", "ownerId", "fileName", "contentType", "byteSize", "storageKey", "checksum", "uploadedBy", "createdAt"],
      operatorAction: "초안 삭제 또는 관리자 복구 예외는 감사 로그를 남깁니다.",
      deletionPolicy: "제출 이후 물리 삭제 금지",
    },
    {
      entityType: "report_artifact",
      label: "보고서 산출물",
      retentionDays: 1095,
      retentionLabel: "1095일",
      clockField: "createdAt",
      immutable: true,
      hardDeleteAllowed: false,
      legalHoldSupported: true,
      disposition: "3년 보관 후 EXPIRED 상태 전환",
      protectedFields: ["definitionId", "createdBy", "name", "type", "periodStart", "periodEnd", "artifactKey", "rowCount", "createdAt"],
      operatorAction: "사용자 삭제는 물리 삭제가 아니라 EXPIRED 상태 전환으로 처리합니다.",
      deletionPolicy: "물리 삭제 금지",
    },
  ];
  const checks: RetentionPolicySummary["checks"] = [
    {
      id: "audit_log_archive_due",
      label: "감사 로그 아카이브 대상",
      ok: true,
      severity: "warning",
      count: 0,
      detail: "mock 감사 로그에는 보관 만료 대상이 없습니다.",
      action: "운영 DB에서만 실제 아카이브 대상을 계산합니다.",
    },
    {
      id: "expired_notifications",
      label: "만료 알림 정리 대상",
      ok: expiredNotifications === 0,
      severity: "info",
      count: expiredNotifications,
      detail: "expiresAt이 지난 알림은 목록에서 제외되고 정리 작업 대상입니다.",
      action: "야간 배치 또는 운영 정리 작업에서 삭제합니다.",
    },
    {
      id: "attachment_metadata_archive_due",
      label: "첨부 metadata 보관 검토 대상",
      ok: true,
      severity: "warning",
      count: 0,
      detail: "mock 첨부에는 7년 초과 metadata가 없습니다.",
      action: "소유 업무, checksum, storageKey를 보관 목록과 대사합니다.",
    },
    {
      id: "report_artifact_expire_due",
      label: "보고서 산출물 만료 전환 대상",
      ok: true,
      severity: "warning",
      count: 0,
      detail: "mock 보고서에는 3년 초과 활성 산출물이 없습니다.",
      action: "필요 시 보고서를 EXPIRED 상태로 전환합니다.",
    },
  ];
  const triggered = checks.filter((check) => !check.ok);
  return {
    ok: true,
    actionRequired: triggered.length > 0,
    generatedAt: now,
    policyVersion: "2026-07-07",
    summary: {
      auditLogs: mockSystemSettingHistoryStore.length,
      notifications: mockNotificationStore.length,
      attachments: mockFileStore.size,
      reportRuns: reportRows.length,
      immutablePolicies: policies.filter((policy) => policy.immutable).length,
      hardDeleteAllowedPolicies: policies.filter((policy) => policy.hardDeleteAllowed).length,
      triggeredChecks: triggered.length,
    },
    policies,
    checks,
    triggered,
  };
}

function buildMockAccountLifecycleSummary(): AccountLifecycleSummary {
  const now = new Date().toISOString();
  return {
    ok: true,
    actionRequired: false,
    generatedAt: now,
    dormantAccountDays: 90,
    dormantCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    offboardingConfigured: false,
    summary: {
      dormantCount: 0,
      offboardingCount: 0,
      totalCandidates: 0,
    },
    candidates: [],
  };
}

function buildMockFinancialReconciliationSummary(): FinancialReconciliationSummary {
  const now = new Date().toISOString();
  const approvedPayments = paymentRows.filter((row) => row.상태 === "승인 완료");
  const completedDisbursements = disbursementRows.filter((row) => row.지급상태 === "지급 완료");
  const totalBudgetAllocated = budgetRows.reduce((sum, row) => sum + parseTableAmount(row["배정 예산"]), 0);
  const totalBudgetUsed = budgetRows.reduce((sum, row) => sum + parseTableAmount(row["사용 금액"]), 0);
  const approvedPaymentAmount = approvedPayments.reduce((sum, row) => sum + parseTableAmount(row.금액), 0);
  const completedDisbursementAmount = completedDisbursements.reduce((sum, row) => sum + parseTableAmount(row.금액), 0);
  const monthly = new Map<string, FinancialReconciliationSummary["monthly"][number]>();
  const ensureBucket = (period: string, departmentName: string) => {
    const key = `${period}:${departmentName}`;
    const current = monthly.get(key) ?? {
      period,
      departmentId: `mock-${departmentName}`,
      departmentName,
      approvedPaymentCount: 0,
      approvedPaymentAmount: 0,
      completedDisbursementCount: 0,
      completedDisbursementAmount: 0,
      diff: 0,
    };
    monthly.set(key, current);
    return current;
  };
  for (const row of approvedPayments) {
    const bucket = ensureBucket((row.요청일 ?? now).slice(0, 7), row.부서 || "전사");
    bucket.approvedPaymentCount += 1;
    bucket.approvedPaymentAmount += parseTableAmount(row.금액);
    bucket.diff = bucket.completedDisbursementAmount - bucket.approvedPaymentAmount;
  }
  for (const row of completedDisbursements) {
    const bucket = ensureBucket((row.지급예정일 ?? now).slice(0, 7), "전사");
    bucket.completedDisbursementCount += 1;
    bucket.completedDisbursementAmount += parseTableAmount(row.금액);
    bucket.diff = bucket.completedDisbursementAmount - bucket.approvedPaymentAmount;
  }
  const checks: FinancialReconciliationSummary["checks"] = [
    {
      id: "budget_used_vs_items",
      label: "예산 사용액 대 항목 합계",
      ok: true,
      severity: "critical",
      count: 0,
      detail: "mock 데이터에서는 예산 항목 원장 불일치가 없습니다.",
      action: "remote mode에서 실제 Budget/BudgetItem 원장을 대사합니다.",
    },
    {
      id: "budget_used_vs_approved_requests",
      label: "예산 사용액 대 승인 요청",
      ok: true,
      severity: "critical",
      count: 0,
      detail: "mock 데이터에서는 승인 요청 합계 불일치가 없습니다.",
      action: "remote mode에서 승인 완료 요청과 예산 사용액을 비교합니다.",
    },
    {
      id: "completed_disbursement_vs_approved_requests",
      label: "지급 완료 대 승인 요청",
      ok: true,
      severity: "critical",
      count: 0,
      detail: "mock 데이터에서는 승인 금액 초과 지급이 없습니다.",
      action: "remote mode에서 지급 완료 원장을 승인 요청별로 대사합니다.",
    },
    {
      id: "report_snapshot_vs_current_sources",
      label: "보고서 스냅샷 대 현재 원천",
      ok: true,
      severity: "warning",
      count: 0,
      detail: "mock 보고서는 저장 스냅샷이 없어 점검 예시만 표시합니다.",
      action: "remote mode에서 ReportRun 드릴다운 스냅샷을 원천 코드와 비교합니다.",
    },
  ];
  return {
    ok: true,
    actionRequired: false,
    generatedAt: now,
    toleranceWon: 1,
    summary: {
      budgets: budgetRows.length,
      budgetItems: budgetRows.reduce((sum, row) => sum + Number(row.예산항목수 ?? "0"), 0),
      paymentRequests: paymentRows.length,
      approvedPaymentRequests: approvedPayments.length,
      disbursements: disbursementRows.length,
      completedDisbursements: completedDisbursements.length,
      reportRunsReviewed: reportRows.length,
      reportSnapshotsReviewed: 0,
      reportRowsReviewed: 0,
      totalBudgetAllocated,
      totalBudgetUsed,
      approvedPaymentAmount,
      completedDisbursementAmount,
      criticalMismatchCount: 0,
      warningMismatchCount: 0,
      mismatchCount: 0,
    },
    checks,
    triggered: [],
    mismatches: [],
    mismatchesTruncated: false,
    monthly: Array.from(monthly.values()).sort((left, right) => left.period.localeCompare(right.period)),
    daily: [],
  };
}

function buildMockPasswordChangeResult(): PasswordChangeResult {
  const changedAt = new Date();
  const expiresAt = new Date(changedAt.getTime() + mockPasswordPolicy.maxAgeDays * 24 * 60 * 60 * 1000);
  return {
    changedAt: changedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sessionsRevoked: 0,
    policy: mockPasswordPolicy,
  };
}

function buildMockManualRecoverySummary(): ManualRecoverySummary {
  const items = [...mockManualRecoveryStore].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      pending: items.filter((item) => item.status === "pending").length,
      approved: items.filter((item) => item.status === "approved").length,
      rejected: items.filter((item) => item.status === "rejected").length,
    },
    items,
    pending: items.filter((item) => item.status === "pending"),
  };
}

function buildMockFinancialControlReport(): FinancialControlReport {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const reconciliation = buildMockFinancialReconciliationSummary();
  const manualRecoveries = buildMockManualRecoverySummary();
  const exceptions: FinancialControlReport["exceptions"] = [
    ...reconciliation.mismatches.map((item) => ({
      id: `mock-reconciliation-${item.id}`,
      severity: item.severity,
      label: item.label,
      scope: item.scope,
      detail: item.detail,
      source: "financial_reconciliation",
      linkPath: item.linkPath,
    })),
    ...manualRecoveries.pending.map((item) => ({
      id: `mock-manual-recovery-${item.id}`,
      severity: "warning" as const,
      label: "수동 복구 승인 대기",
      scope: item.targetCode,
      detail: item.reason,
      source: "manual_recovery",
      linkPath: "#settings",
    })),
  ];
  const checklist: FinancialControlReport["checklist"] = [
    { id: "financial_reconciliation_clear", label: "예산/지급/보고서 대사", ok: reconciliation.summary.criticalMismatchCount === 0, owner: "재무 운영", detail: `불일치 ${reconciliation.summary.mismatchCount}건`, evidence: "GET /api/operations/financial-reconciliation" },
    { id: "manual_recovery_closed", label: "수동 복구 대기 해소", ok: manualRecoveries.summary.pending === 0, owner: "관리자", detail: `대기 ${manualRecoveries.summary.pending}건`, evidence: "GET /api/operations/manual-recoveries" },
    { id: "bank_result_reconcile_reviewed", label: "은행 결과 대사 검토", ok: true, owner: "재무팀", detail: "mock 은행 결과 대사 검토 완료", evidence: "mock audit evidence" },
    { id: "disbursement_audit_reviewed", label: "지급 변경 감사 로그 검토", ok: true, owner: "재무팀", detail: "mock 지급 감사 로그 검토 완료", evidence: "mock audit evidence" },
    { id: "report_snapshot_reviewed", label: "보고서 스냅샷 대사", ok: true, owner: "보고서 운영", detail: "mock 보고서 스냅샷 검토 완료", evidence: "mock report evidence" },
  ];
  return {
    ok: exceptions.filter((item) => item.severity === "critical").length === 0 && checklist.every((item) => item.ok),
    generatedAt: now.toISOString(),
    period: {
      month,
      start: `${month}-01T00:00:00.000Z`,
      endExclusive: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    },
    summary: {
      exceptions: exceptions.length,
      criticalExceptions: exceptions.filter((item) => item.severity === "critical").length,
      warningExceptions: exceptions.filter((item) => item.severity === "warning").length,
      manualRecoveryPending: manualRecoveries.summary.pending,
      manualRecoveryClosed: manualRecoveries.summary.approved + manualRecoveries.summary.rejected,
      bankReconcileCount: 1,
      disbursementAuditCount: disbursementRows.length,
      checklistPassed: checklist.filter((item) => item.ok).length,
      checklistTotal: checklist.length,
    },
    exceptions,
    checklist,
  };
}

function buildMockPermissionReviewReport(): PermissionReviewReport {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const soon = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const reviewDueAt = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3 + 3, 1)).toISOString();
  const privilegedUsers: PermissionReviewReport["privilegedUsers"] = [
    {
      userId: "mock-user-admin",
      userName: mockCurrentUser.name,
      departmentName: mockCurrentUser.departmentName,
      active: true,
      lastLoginAt: now.toISOString(),
      roles: ["관리자"],
      highRiskPermissions: ["*", "system:manage", "disbursement:execute", "audit:read"],
      missingExpiryCount: 1,
      expiredExceptionCount: 0,
      expiringExceptionCount: 1,
      reviewStatus: "review",
    },
    {
      userId: "mock-user-finance",
      userName: "조현우",
      departmentName: "재무팀",
      active: true,
      lastLoginAt: now.toISOString(),
      roles: ["재무팀"],
      highRiskPermissions: ["disbursement:execute", "payment_request:read_all"],
      missingExpiryCount: 0,
      expiredExceptionCount: 0,
      expiringExceptionCount: 0,
      reviewStatus: "ok",
    },
  ];
  const exceptions: PermissionReviewReport["exceptions"] = [
    {
      id: "mock-admin-system-manage",
      severity: "warning",
      status: "expiry_missing",
      userId: "mock-user-admin",
      userName: mockCurrentUser.name,
      departmentName: mockCurrentUser.departmentName,
      roleId: "role-admin",
      roleName: "관리자",
      permission: "system:manage",
      expiresAt: null,
      daysUntilExpiry: null,
      action: "예외 권한 만료일을 지정하고 정기 검토 승인 로그를 남기세요.",
      evidence: "Role.permissions expiry marker missing",
    },
    {
      id: "mock-admin-audit-read",
      severity: "warning",
      status: "expiring",
      userId: "mock-user-admin",
      userName: mockCurrentUser.name,
      departmentName: mockCurrentUser.departmentName,
      roleId: "role-admin",
      roleName: "관리자",
      permission: "audit:read",
      expiresAt: soon,
      daysUntilExpiry: 14,
      action: "만료 전 재검토하고 유지/회수 결정을 기록하세요.",
      evidence: `Role.permissions exception:audit:read:${soon.slice(0, 10)}`,
    },
  ];
  const checklist: PermissionReviewReport["checklist"] = [
    { id: "monthly_review_log_present", label: "정기 권한 검토 로그", ok: true, owner: "시스템 관리자", detail: `${month} mock 권한 검토 감사 로그 1건`, evidence: "AuditLog entityType=permission_review" },
    { id: "inactive_privileged_users_clear", label: "비활성 특권 계정 회수", ok: true, owner: "보안 운영", detail: "비활성 특권 계정 0명", evidence: "User.isActive + Role.permissions" },
    { id: "exception_expiry_current", label: "예외 권한 만료일 관리", ok: false, owner: "시스템 관리자", detail: "만료 0건, 만료일 없음 1건, 30일 이내 1건", evidence: "Role.permissions exception:<permission>:YYYY-MM-DD" },
  ];
  return {
    ok: false,
    generatedAt: now.toISOString(),
    period: {
      month,
      start: `${month}-01T00:00:00.000Z`,
      endExclusive: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      reviewDueAt,
      expiringThresholdDays: 30,
    },
    summary: {
      totalUsers: settingsRows.length,
      activeUsers: settingsRows.length,
      privilegedUsers: privilegedUsers.length,
      inactivePrivilegedUsers: 0,
      exceptions: exceptions.length,
      expiredExceptions: 0,
      expiringExceptions: 1,
      missingExpiryExceptions: 1,
      reviewLogs: 1,
      checklistPassed: checklist.filter((item) => item.ok).length,
      checklistTotal: checklist.length,
    },
    privilegedUsers,
    exceptions,
    checklist,
  };
}
function buildMockManualRecoveryResult(recoveryId: string, idempotencyReplay = false): ManualRecoveryResult {
  return {
    idempotencyReplay,
    recoveryId,
    summary: buildMockManualRecoverySummary(),
  };
}

function requestMockManualRecovery(input: ManualRecoveryRequestInput) {
  const now = new Date().toISOString();
  const item: ManualRecoveryItem = {
    id: `mock-manual-recovery-${Date.now()}-${mockManualRecoveryStore.length}`,
    status: "pending",
    targetType: input.targetType,
    targetCode: input.targetCode,
    reviewerName: mockCurrentUser.name,
    approverName: "",
    requestedAt: now,
    reviewedAt: "",
    reason: input.reason,
    approvalReason: "",
    expectedRowVersion: 1,
    proposed: {
      지급상태: input.nextStatus,
      계좌확인: input.accountStatus || "확인 완료",
      지급예정일: input.scheduledDate || now.slice(0, 10),
    },
  };
  mockManualRecoveryStore = [item, ...mockManualRecoveryStore].slice(0, 100);
  return item;
}

function reviewMockManualRecovery(recoveryId: string, input: ManualRecoveryReviewInput, status: "approved" | "rejected") {
  const now = new Date().toISOString();
  mockManualRecoveryStore = mockManualRecoveryStore.map((item) =>
    item.id === recoveryId && item.status === "pending"
      ? { ...item, status, approverName: mockCurrentUser.name, reviewedAt: now, approvalReason: input.reason }
      : item,
  );
}

function appendMockSettingsHistory(desc: string, tag: string) {
  const row: SystemSettingHistoryRow = {
    id: `mock-settings-history-${Date.now()}-${mockSystemSettingHistoryStore.length}`,
    time: new Date().toISOString().slice(0, 16).replace("T", " "),
    user: `${mockCurrentUser.name} (${mockCurrentUser.departmentName})`,
    desc,
    tag,
  };
  mockSystemSettingHistoryStore.unshift(row);
  mockSystemSettingHistoryStore.splice(100);
}

function buildMockAuditLogSearch(query: {
  search?: string;
  entityType?: string;
  action?: string;
  requestId?: string;
  actor?: string;
  page?: number;
  pageSize?: number;
} = {}): AuditLogSearchResult {
  const historyRows = mockSystemSettingHistoryStore.map((row, index) => ({
    id: `mock-audit-${row.id}`,
    time: row.time,
    actor: row.user.replace(/\s*\(.+\)$/, ""),
    actorDepartment: row.user.match(/\((.+)\)$/)?.[1] ?? "운영",
    entityType: row.tag.includes("권한") ? "role" : row.tag.includes("사용자") ? "user" : "system_setting",
    entityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    action: row.tag.includes("권한") ? "settings_role_update" : row.tag.includes("사용자") ? "settings_update" : "system_setting_update",
    reason: row.desc,
    requestId: `mock-request-${index + 1}`,
    ipAddress: "203.0.113.10",
    userAgent: "Mock ERP",
    summary: `${row.desc} · before keys:previous · after keys:current`,
  }));
  const fileRows = [...mockFileStore.values()].slice(0, 10).map((file, index) => ({
    id: `mock-audit-file-${file.id}`,
    time: file.createdAt,
    actor: mockCurrentUser.name,
    actorDepartment: mockCurrentUser.departmentName,
    entityType: "attachment",
    entityId: file.id,
    action: "download_request",
    reason: `${file.fileName} 다운로드 사유 기록`,
    requestId: `mock-file-request-${index + 1}`,
    ipAddress: "203.0.113.20",
    userAgent: "Mock ERP",
    summary: `download_request · attachment · before - · after keys:fileName,ownerType,ownerId`,
  }));
  const search = query.search?.trim().toLowerCase() ?? "";
  const actor = query.actor?.trim().toLowerCase() ?? "";
  const rows = [...fileRows, ...historyRows]
    .filter((row) => !query.entityType || row.entityType === query.entityType)
    .filter((row) => !query.action || row.action === query.action)
    .filter((row) => !query.requestId || row.requestId === query.requestId)
    .filter((row) => !actor || row.actor.toLowerCase().includes(actor))
    .filter((row) => !search || Object.values(row).some((value) => String(value).toLowerCase().includes(search)));
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25)));
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    accessScope: "external_auditor_read_only",
    rawValuePolicy: "beforeValue/afterValue 원문은 mock 감사 조회 응답에 포함하지 않습니다.",
    retention: {
      retentionDays: 2555,
      disposition: "7년 보관 후 감사/법무 승인 기반 아카이브",
      immutable: true,
      archiveAction: "보관 만료 대상은 외부 WORM 또는 감사 저장소로 내보냅니다.",
    },
  };
}

function buildMockOperationModeStatus(): OperationModeStatus {
  return {
    mode: "normal",
    label: "정상 운영",
    active: false,
    readOnly: false,
    disabledCapabilities: [],
    restrictions: [],
    source: {
      operationMode: "mock:ERP_OPERATION_MODE",
      disabledCapabilities: "mock:ERP_DISABLED_CAPABILITIES",
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildMockOperationalAlertSummary(): OperationalAlertSummary {
  const now = new Date();
  const since = new Date(now.getTime() - 15 * 60 * 1000);
  const rules: OperationalAlertSummary["rules"] = [
    { id: "api_5xx", label: "API 5xx", ok: true, count: 0, threshold: 1, eventTypes: ["server_failure"], severity: "critical", runbook: "API 로그와 requestId를 확인합니다." },
    { id: "slow_query", label: "Slow query", ok: true, count: 0, threshold: 1, eventTypes: ["slow_query"], severity: "warning", runbook: "DB slow query와 pagination 기준을 확인합니다." },
    { id: "file_upload_failure", label: "File upload failure", ok: true, count: 0, threshold: 1, eventTypes: ["file_upload_rejected"], severity: "critical", runbook: "object storage와 scanner 상태를 확인합니다." },
  ];
  return {
    ok: true,
    windowMinutes: 15,
    since: since.toISOString(),
    until: now.toISOString(),
    database: { ok: true, latencyMs: 18, error: null },
    countsByEventType: {},
    eventReadError: null,
    rules,
    triggered: [],
    metrics: {
      eventsReviewed: 0,
      ruleFailureRatePercent: 0,
      criticalTriggered: 0,
      warningTriggered: 0,
      p95LatencyMs: 18,
      p99LatencyMs: null,
      maxLatencyMs: null,
      latencySampleSize: 0,
      dbLatencyMs: 18,
      latencyTargets: {
        p95TargetMs: 800,
        p99TargetMs: 1500,
        currentP95Ms: 18,
        currentP99Ms: null,
        p95Ok: true,
        p99Ok: true,
        sampleSize: 0,
        source: "mock performance targets",
      },
    },
  };
}

function buildMockBusinessFailureAlertSummary(): BusinessFailureAlertSummary {
  const now = new Date();
  const since = new Date(now.getTime() - 15 * 60 * 1000);
  const rules: BusinessFailureAlertSummary["rules"] = [
    { id: "approval_processing_failure", label: "승인 처리 실패", ok: true, count: 0, threshold: 1, pathPrefixes: ["/api/approvals"], eventTypes: ["workflow_blocked"], severity: "critical", ownerPermission: "system:manage", linkPath: "#approval", runbook: "결재 단계와 rowVersion을 확인합니다.", recentEvents: [] },
    { id: "disbursement_processing_failure", label: "지급 처리 실패", ok: true, count: 0, threshold: 1, pathPrefixes: ["/api/disbursements"], eventTypes: ["workflow_blocked"], severity: "critical", ownerPermission: "system:manage", linkPath: "#disbursement", runbook: "지급 상태와 2인 확인 감사 로그를 확인합니다.", recentEvents: [] },
    { id: "report_processing_failure", label: "보고서 처리 실패", ok: true, count: 0, threshold: 1, pathPrefixes: ["/api/reports"], eventTypes: ["api_failure"], severity: "warning", ownerPermission: "system:manage", linkPath: "#reports", runbook: "ReportRun과 schedule 상태를 확인합니다.", recentEvents: [] },
    { id: "file_processing_failure", label: "파일 처리 실패", ok: true, count: 0, threshold: 1, pathPrefixes: ["/api/files"], eventTypes: ["file_upload_rejected"], severity: "critical", ownerPermission: "system:manage", linkPath: "#settings", runbook: "파일 저장소와 scan 상태를 확인합니다.", recentEvents: [] },
  ];
  return {
    ok: true,
    windowMinutes: 15,
    since: since.toISOString(),
    until: now.toISOString(),
    eventsReviewed: 0,
    eventReadError: null,
    rules,
    triggered: [],
  };
}

function ensureMockReportSchedules() {
  if (mockReportScheduleStore.size > 0) return;
  const seeded = [
    toMockReportSchedule({ reportName: "월간 종합 보고서", reportType: "종합", cycle: "매월 1일", time: "09:00", format: "PDF", recipients: ["재무팀", "경영진"] }),
    toMockReportSchedule({ reportName: "승인 현황 보고서", reportType: "승인", cycle: "매주 월요일", time: "09:00", format: "PDF", recipients: ["부서장"], isActive: true }),
    toMockReportSchedule({ reportName: "예산 대비 보고서", reportType: "예산", cycle: "매월 말일", time: "17:00", format: "CSV", recipients: ["경영진"], isActive: false }),
  ];
  seeded[0] = { ...seeded[0], nextRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() };
  seeded.forEach((schedule) => mockReportScheduleStore.set(schedule.id, schedule));
}

function buildMockReportJobRunResult(input: ReportJobRunInput = {}): ReportJobRunResult {
  ensureMockReportSchedules();
  const now = new Date();
  const batchSize = Math.min(Math.max(Number(input.batchSize ?? 10), 1), 100);
  const dueSchedules = [...mockReportScheduleStore.values()]
    .filter((schedule) => schedule.isActive && schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() <= now.getTime())
    .slice(0, batchSize);
  const dryRun = input.dryRun !== false;
  const results: ReportJobRunResult["results"] = dryRun
    ? []
    : dueSchedules.map((schedule) => {
        const nextRunAt = nextMockScheduleRunAt(schedule);
        const updated = { ...schedule, nextRunAt, updatedAt: now.toISOString(), rowVersion: schedule.rowVersion + 1 };
        mockReportScheduleStore.set(schedule.id, updated);
        return {
          scheduleId: schedule.id,
          reportName: schedule.reportName,
          status: "delivered" as const,
          attempt: 1,
          nextRunAt,
          errorMessage: "",
        };
      });
  return {
    ok: true,
    dryRun,
    generatedAt: now.toISOString(),
    policy: {
      deliveryMode: "internal",
      batchSize,
      maxAttempts: 3,
      timeoutMs: 30_000,
      retryBaseSeconds: 300,
      retryMaxSeconds: 3_600,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerWindowMinutes: 15,
      webhookConfigured: false,
      webhookTokenConfigured: false,
    },
    circuitBreaker: {
      open: false,
      recentFailures: 0,
      threshold: 5,
      windowMinutes: 15,
      since: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    },
    summary: {
      due: dueSchedules.length,
      processed: results.length,
      delivered: results.filter((result) => result.status === "delivered").length,
      retryScheduled: results.filter((result) => result.status === "retry_scheduled").length,
      deadLetter: results.filter((result) => result.status === "dead_letter").length,
      skipped: 0,
    },
    dueSchedules: dueSchedules.map((schedule) => ({
      id: schedule.id,
      reportName: schedule.reportName,
      owner: "mock 운영자",
      nextRunAt: schedule.nextRunAt || null,
    })),
    results,
  };
}

function buildMockPerformancePolicyStatus(): PerformancePolicyStatus {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    latency: {
      p95TargetMs: 800,
      p99TargetMs: 1500,
      currentP95Ms: 18,
      currentP99Ms: null,
      p95Ok: true,
      p99Ok: true,
      sampleSize: 0,
      source: "mock performance targets",
    },
    reportJob: {
      maxProcessingMs: 120_000,
      workerTimeoutMs: 30_000,
      batchSize: 10,
      maxAttempts: 3,
      source: "mock report job policy",
    },
    largeDownload: {
      maxReportRows: 5_000,
      maxReportBytes: 3 * 1024 * 1024,
      source: "mock report download policy",
    },
  };
}

function respond<T>(data: T, meta?: MockApiResponse<T>["meta"]): MockApiResponse<T> {
  return { ok: true, data, meta };
}

function isActiveNotification(notification: { expiresAt?: string }) {
  return !notification.expiresAt || new Date(notification.expiresAt).getTime() > Date.now();
}

function parseTableAmount(value: string | undefined) {
  const parsed = Number((value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMockWon(value: number) {
  return `${value.toLocaleString("ko-KR")} 원`;
}

function mockBudgetStatus(allocated: number, used: number) {
  if (allocated > 0 && used > allocated) return "초과";
  if (allocated > 0 && used / allocated >= 0.9) return "주의";
  return "정상";
}

function toMockBudgetPatch(row: TableRow, amount: number): TableRow {
  const allocated = parseTableAmount(row["배정 예산"]) + amount;
  const used = parseTableAmount(row["사용 금액"]);
  const remaining = allocated - used;
  const usageRate = allocated > 0 ? Math.round((used / allocated) * 100) : 0;
  const rowVersion = Number(row.예산RowVersion ?? "1");
  return {
    "배정 예산": formatMockWon(allocated),
    사용률: `${usageRate}%`,
    잔액: formatMockWon(remaining),
    상태: mockBudgetStatus(allocated, used),
    예산RowVersion: String(Number.isFinite(rowVersion) ? rowVersion + 1 : 2),
  };
}

function toMockBudgetAdjustment(departmentName: string, input: BudgetAdjustmentInput): TableRow {
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const requiresApproval = input.amount >= 10_000_000;
  return {
    조정ID: `mock-budget-adjustment-${crypto.randomUUID()}`,
    예산ID: `mock-budget-${departmentName}`,
    부서: departmentName,
    조정금액: formatMockWon(input.amount),
    조정사유: input.reason,
    승인필요: requiresApproval ? "필요" : "불필요",
    상태: requiresApproval ? "승인 대기" : "즉시 반영",
    취소가능: requiresApproval ? "가능" : "불가",
    반려가능: requiresApproval ? "가능" : "불가",
    원장반영방식: requiresApproval ? "원장 미반영 · 취소/반려 시 예산 원장 변경 없음" : "이미 원장 반영됨 · 취소/반려 대신 반대 조정 또는 보정 전표 필요",
    요청자: mockCurrentUser.name,
    요청일시: now,
    적용일시: requiresApproval ? "-" : now,
  };
}

function escapeCsvCell(value: string | number) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function buildCsv(columns: string[], rows: Array<Record<string, string | number>>) {
  return [
    columns.map(escapeCsvCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(row[column] ?? "")).join(",")),
  ].join("\r\n");
}

const reportDownloadColumns = ["보고서명", "유형", "기간", "생성일시", "생성자", "요약"];

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function toPdfSafeText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "?");
}

function escapePdfText(value: string) {
  return toPdfSafeText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createMockReportPdf(row: TableRow) {
  const lines = [
    "Payment Approval ERP Report",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Report: ${row.보고서명 ?? "Report"}`,
    `Type: ${row.유형 ?? "-"}`,
    `Period: ${row.기간 ?? "-"}`,
    `Creator: ${row.생성자 ?? "-"}`,
    `Summary: ${row.요약 ?? "-"}`,
  ];
  const content = lines
    .map((line, index) => `BT /F1 10 Tf 48 ${744 - index * 18} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream\nendobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = pdf.length;
    pdf += `${object}\n`;
    return offset;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n");
  pdf += `\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

function buildMockReportDownload(row: TableRow, format: ReportDownloadFormat): ReportDownload {
  const generatedAt = new Date().toISOString();
  const safeName = (row.보고서명 || "report").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  const content =
    format === "pdf"
      ? createMockReportPdf(row)
      : `\uFEFF${buildCsv(reportDownloadColumns, [row])}`;
  return {
    fileName: `${safeName}-${generatedAt.replace(/\D/g, "").slice(0, 14)}.${format}`,
    contentType: format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8",
    contentBase64: encodeBase64Utf8(content),
    generatedAt,
    report: { ...row },
  };
}

function nextMockScheduleRunAt(input: Pick<ReportScheduleInput, "cycle" | "time">) {
  const [hour, minute] = input.time.split(":").map((part) => Number(part));
  const next = new Date();
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  if (input.cycle.includes("매주")) next.setDate(next.getDate() + 7);
  if (input.cycle.includes("매월")) next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

function toMockReportSchedule(input: ReportScheduleInput, id = `mock-report-schedule-${Date.now()}`): ReportScheduleDto {
  const now = new Date().toISOString();
  return {
    id,
    title: `${input.reportName} 예약`,
    reportName: input.reportName,
    reportType: input.reportType,
    frequency: input.cycle.startsWith("매주") ? "매주" : input.cycle.startsWith("매일") ? "매일" : input.cycle.includes("분기") ? "매분기" : "매월",
    cycle: input.cycle,
    time: input.time,
    format: input.format,
    recipients: input.recipients,
    recipientLabel: input.recipients.join(", ") || "-",
    isActive: input.isActive ?? true,
    status: input.isActive === false ? "중지" : "활성",
    nextRunAt: input.isActive === false ? "" : nextMockScheduleRunAt(input),
    createdAt: now,
    updatedAt: now,
    rowVersion: input.rowVersion ?? 1,
  };
}

function matchesExportFilter(row: TableRow, filters: Partial<Record<string, string>> = {}) {
  const statusFilter = filters.지급상태 ?? filters.status;
  const bankFilter = filters.은행 ?? filters.bank;
  if (statusFilter && !statusFilter.startsWith("전체") && row.지급상태 !== statusFilter) return false;
  if (bankFilter && !bankFilter.startsWith("전체") && !row.은행?.startsWith(bankFilter)) return false;
  return true;
}

function buildMockBankTransferExport(query: ListQuery = {}): BankTransferExport {
  const sourceRows = disbursementRows
    .filter((row) => ["지급 예정", "오늘 지급"].includes(row.지급상태))
    .filter((row) => row.계좌확인 === "확인 완료")
    .filter((row) => matchesExportFilter(row, query.filters));
  const rows = sourceRows.map((row) => ({
    지급번호: row.지급번호,
    승인번호: row.승인번호,
    지급예정일: row.지급예정일,
    거래처: row.거래처,
    사업자번호: "mock",
    은행: row.은행?.split(/\s+/)[0] ?? "",
    계좌번호: row.은행?.split(/\s+/).slice(1).join(" ") ?? "",
    금액: parseTableAmount(row.금액),
    요청부서: "mock",
    요청자: row.담당자,
  }));
  if (rows.length === 0) throw new Error("NO_EXPORTABLE_DISBURSEMENTS: 현재 조건에 맞는 은행 이체 파일 대상이 없습니다.");

  const generatedAt = new Date().toISOString();
  const targetCount = rows.length;
  const reconciliationRows = sourceRows.map((row) => ({
    disbursementCode: String(row.지급번호),
    approvalCode: String(row.승인번호),
    scheduledDate: String(row.지급예정일),
    vendor: String(row.거래처),
    businessNumber: "mock",
    bank: String(row.은행?.split(/\s+/)[0] ?? ""),
    amount: parseTableAmount(row.금액),
    department: "mock",
    requester: String(row.담당자),
    disbursementStatus: String(row.지급상태),
    accountVerificationStatus: String(row.계좌확인),
    vendorAccountVerificationStatus: String(row.계좌확인),
    approvalStatus: "승인 완료",
    approvalStepStatus: "확인 완료",
  }));

  return {
    fileName: `bank-transfer-mock-${generatedAt.replace(/\D/g, "").slice(0, 14)}.csv`,
    contentType: "text/csv;charset=utf-8",
    csv: buildCsv(["지급번호", "승인번호", "지급예정일", "거래처", "사업자번호", "은행", "계좌번호", "금액", "요청부서", "요청자"], rows),
    summary: {
      targetCount,
      exportedCount: targetCount,
      blockedCount: 0,
      totalAmount: rows.reduce((sum, row) => sum + Number(row.금액), 0),
      vendorCount: new Set(sourceRows.map((row) => String(row.거래처))).size,
      accountVerifiedCount: sourceRows.filter((row) => row.계좌확인 === "확인 완료").length,
      disbursementAccountVerifiedCount: sourceRows.filter((row) => row.계좌확인 === "확인 완료").length,
      vendorAccountVerifiedCount: sourceRows.filter((row) => row.계좌확인 === "확인 완료").length,
      approvalVerifiedCount: targetCount,
      scheduledCount: sourceRows.filter((row) => row.지급상태 === "지급 예정").length,
      dueTodayCount: sourceRows.filter((row) => row.지급상태 === "오늘 지급").length,
      scheduledFrom: query.filters?.scheduledFrom,
      scheduledTo: query.filters?.scheduledTo,
      bank: query.filters?.은행 ?? query.filters?.bank,
      department: query.filters?.부서 ?? query.filters?.department,
      status: query.filters?.지급상태 ?? query.filters?.status,
      generatedAt,
      disbursementCodes: rows.map((row) => String(row.지급번호)),
      reconciliationRows,
    },
  };
}

export function createMockService(): ErpApiService {
  return {
    async getCurrentUser() {
      return respond(mockCurrentUser, { mode: "mock" });
    },
    async login() {
      return respond(mockCurrentUser, { mode: "mock" });
    },
    async logout() {
      return respond({ ok: true }, { mode: "mock" });
    },
    async getPasswordPolicy() {
      return respond(mockPasswordPolicy, { mode: "mock" });
    },
    async changePassword() {
      const result = buildMockPasswordChangeResult();
      appendMockSettingsHistory("비밀번호 변경", "사용자 변경");
      return respond(result, { mode: "mock", sessionsRevoked: result.sessionsRevoked });
    },
    async changeExpiredPassword() {
      const result = buildMockPasswordChangeResult();
      appendMockSettingsHistory("만료 비밀번호 변경", "사용자 변경");
      return respond(result, { mode: "mock", sessionsRevoked: result.sessionsRevoked });
    },
    async listNotifications() {
      return respond(mockNotificationStore.filter(isActiveNotification).map((notification) => ({ ...notification })), { mode: "mock" });
    },
    async markNotificationRead(notificationId) {
      const now = new Date().toISOString();
      mockNotificationStore = mockNotificationStore.map((notification) =>
        notification.id === notificationId && isActiveNotification(notification) ? { ...notification, readAt: notification.readAt ?? now } : notification,
      );
      const notification = mockNotificationStore.find((item) => item.id === notificationId && isActiveNotification(item)) ?? null;
      return respond(notification ? { ...notification } : null, { mode: "mock" });
    },
    async markAllNotificationsRead() {
      const now = new Date().toISOString();
      mockNotificationStore = mockNotificationStore.map((notification) => (isActiveNotification(notification) ? { ...notification, readAt: notification.readAt ?? now } : notification));
      return respond(mockNotificationStore.filter(isActiveNotification).map((notification) => ({ ...notification })), { mode: "mock" });
    },
    async getPaymentRequestMasterData() {
      const fallbackDepartments = ["IT운영팀", "외부 컨설팅팀", "장비 운영팀"];
      const vendors = vendorRows.map((vendor) => ({
        id: vendor.사업자번호,
        name: vendor.거래처명,
        businessNumber: vendor.사업자번호,
        managerName: vendor.담당자,
        taxInvoiceEmail: vendor["세금계산서 이메일"] ?? "",
        taxInvoiceIssueType: vendor["세금계산서 발행"] ?? "",
        status: vendor.상태,
        accountStatus: vendor.계좌확인,
      }));
      const departments = [
        ...budgetRows.map((budget) => ({
          name: budget.부서,
          budgetRemaining: parseTableAmount(budget.잔액),
          budgetStatus: budget.상태,
        })),
        ...fallbackDepartments
          .filter((departmentName) => !budgetRows.some((budget) => budget.부서 === departmentName))
          .map((departmentName) => ({
            name: departmentName,
            budgetRemaining: 20_000_000,
            budgetStatus: "로컬 기본",
          })),
      ];
      const budgetItems = departments.map((department, index) => ({
        id: `mock-budget-item-${index + 1}`,
        departmentName: department.name,
        name: "운영비 > 일반 경비",
        remaining: department.budgetRemaining,
        status: department.budgetStatus,
      }));
      const approvalCandidates = settingsRows
        .filter((row) => row.상태 === "활성" && /승인|관리자/.test(`${row.역할} ${row.권한그룹}`))
        .map((row, index) => ({
          id: `mock-approval-candidate-${index + 1}`,
          name: row.사용자,
          departmentName: row.부서,
          roleLabel: row.역할 || row.권한그룹 || "승인자",
        }));
      return respond({ vendors, departments, budgetItems, approvalCandidates }, { mode: "mock" });
    },
    listPageRows,
    getPageRow,
    createPageRow,
    updatePageRow,
    async deletePageRow(pageKey, rowId, input = {}) {
      return deleteMockPageRow(pageKey, rowId, input.idColumn);
    },
    async executePageAction(pageKey, rowId, action, input = {}) {
      return executeMockPageAction(pageKey, rowId, action, input.patch);
    },
    async listBudgetAdjustments(departmentName) {
      return respond((mockBudgetAdjustmentStore.get(departmentName) ?? []).map((row) => ({ ...row })), { mode: "mock", departmentName });
    },
    async createBudgetAdjustment(departmentName, input) {
      if (input.amount <= 0) throw new Error("VALIDATION_ERROR: 조정 금액은 1원 이상이어야 합니다.");
      if (!input.reason.trim()) throw new Error("VALIDATION_ERROR: 예산 조정 사유가 필요합니다.");
      const currentResponse = await getPageRow("budget", departmentName);
      const currentBudget = currentResponse.data ?? budgetRows.find((row) => row.부서 === departmentName) ?? null;
      if (!currentBudget) throw new Error("NOT_FOUND: 등록된 예산을 찾을 수 없습니다.");

      const adjustment = toMockBudgetAdjustment(departmentName, input);
      const history = [adjustment, ...(mockBudgetAdjustmentStore.get(departmentName) ?? [])].slice(0, 50);
      mockBudgetAdjustmentStore.set(departmentName, history);

      const requiresApproval = input.amount >= 10_000_000;
      let budget = { ...currentBudget };
      if (!requiresApproval) {
        const updated = await updatePageRow("budget", departmentName, toMockBudgetPatch(currentBudget, input.amount));
        budget = updated.data ?? budget;
      }

      return respond(
        {
          adjustment,
          budget,
          requiresApproval,
        } satisfies BudgetAdjustmentResult,
        { mode: "mock", departmentName, requiresApproval },
      );
    },
    async updateBudgetAdjustment(departmentName, adjustmentId, action, input = {}) {
      const history = mockBudgetAdjustmentStore.get(departmentName) ?? [];
      const index = history.findIndex((row) => row.조정ID === adjustmentId);
      if (index === -1) throw new Error("NOT_FOUND: 예산 조정 요청을 찾을 수 없습니다.");
      const current = history[index];
      if (current.상태 === "즉시 반영") throw new Error("LEDGER_ALREADY_APPLIED: 이미 원장에 반영된 조정은 취소/반려할 수 없습니다. 반대 조정 요청 또는 보정 전표로 처리해야 합니다.");
      if (current.상태 !== "승인 대기") throw new Error("WORKFLOW_LOCKED: 이미 종료된 예산 조정 요청은 상태를 변경할 수 없습니다.");
      const nextStatus = action === "cancel" ? "취소" : "반려";
      const updated = {
        ...current,
        상태: nextStatus,
        취소가능: "불가",
        반려가능: "불가",
        원장반영방식: "원장 미반영 상태에서 종료 · 예산 원장 rollback 없음",
        처리사유: input.reason ?? (action === "cancel" ? "예산 조정 취소" : "예산 조정 반려"),
      };
      history[index] = updated;
      mockBudgetAdjustmentStore.set(departmentName, history);
      const currentResponse = await getPageRow("budget", departmentName);
      const budget = currentResponse.data ?? budgetRows.find((row) => row.부서 === departmentName) ?? null;
      return respond(
        { adjustment: updated, budget: budget ? { ...budget } : null, rollbackPolicy: updated.원장반영방식 } satisfies BudgetAdjustmentActionResult,
        { mode: "mock", departmentName, adjustmentId, action },
      );
    },
    async downloadReport(reportName, format) {
      const rowResponse = await getPageRow("reports", reportName);
      const report = rowResponse.data ?? reportRows.find((row) => row.보고서명 === reportName) ?? reportRows[0];
      if (!report) throw new Error("NOT_FOUND: 보고서를 찾을 수 없습니다.");
      const data = buildMockReportDownload(report, format);
      return respond(data, { mode: "mock", reportName, format });
    },
    async listReportSchedules() {
      ensureMockReportSchedules();
      return respond([...mockReportScheduleStore.values()], { mode: "mock", total: mockReportScheduleStore.size });
    },
    async createReportSchedule(input) {
      const schedule = toMockReportSchedule(input, `mock-report-schedule-${crypto.randomUUID()}`);
      mockReportScheduleStore.set(schedule.id, schedule);
      return respond(schedule, { mode: "mock", created: true });
    },
    async updateReportSchedule(scheduleId, patch) {
      const current = mockReportScheduleStore.get(scheduleId) ?? null;
      if (!current) return respond(null, { mode: "mock", found: false });
      const nextInput: ReportScheduleInput = {
        reportName: patch.reportName ?? current.reportName,
        reportType: patch.reportType ?? current.reportType,
        cycle: patch.cycle ?? current.cycle,
        time: patch.time ?? current.time,
        format: patch.format ?? current.format,
        recipients: patch.recipients ?? current.recipients,
        isActive: patch.isActive ?? current.isActive,
      };
      const updated = { ...toMockReportSchedule({ ...nextInput, rowVersion: current.rowVersion + 1 }, current.id), createdAt: current.createdAt, updatedAt: new Date().toISOString() };
      mockReportScheduleStore.set(updated.id, updated);
      return respond(updated, { mode: "mock", found: true });
    },
    async deleteReportSchedule(scheduleId) {
      const current = mockReportScheduleStore.get(scheduleId) ?? null;
      if (!current) return respond(null, { mode: "mock", deleted: false });
      const stopped = { ...current, isActive: false, status: "중지", nextRunAt: "", updatedAt: new Date().toISOString(), rowVersion: current.rowVersion + 1 };
      mockReportScheduleStore.set(scheduleId, stopped);
      return respond(stopped, { mode: "mock", deleted: true });
    },
    async exportDisbursementBankTransfer(query = {}) {
      const data = buildMockBankTransferExport(query);
      return respond(data, { mode: "mock", targetCount: data.summary.targetCount, totalAmount: data.summary.totalAmount });
    },
    async reconcileDisbursementBankResults(input) {
      const rows = input.rows.map((row) => ({
        disbursementCode: row.disbursementCode,
        approvalCode: row.approvalCode ?? "",
        amount: row.amount,
        status: row.status,
        bankResultId: row.bankResultId ?? "",
        message: row.message ?? (row.status === "SUCCESS" ? "mock 은행 지급 성공 대사" : "mock 은행 지급 실패 대사"),
        outcome: row.status === "SUCCESS" ? "MATCHED" : "BANK_FAILED",
      }));
      return respond(
        {
          targetCount: rows.length,
          matchedCount: rows.filter((row) => row.status === "SUCCESS").length,
          bankFailedCount: rows.filter((row) => row.status === "FAILED").length,
          mismatchCount: 0,
          totalAmount: rows.reduce((sum, row) => sum + Number(row.amount), 0),
          reconciledAt: new Date().toISOString(),
          rows,
        } satisfies BankResultReconcileSummary,
        { mode: "mock", idempotencyKey: input.idempotencyKey },
      );
    },
    async presignFileUpload(input) {
      const fileId = crypto.randomUUID();
      const file: FileDto = {
        id: fileId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        fileName: input.fileName,
        contentType: input.contentType,
        byteSize: input.byteSize,
        storageKey: `mock/${fileId}/${input.fileName}`,
        checksum: input.checksum ?? "mock-pending",
        scanStatus: "pending",
        canPreview: input.fileName.toLowerCase().endsWith(".pdf"),
        createdAt: new Date().toISOString(),
      };
      mockFileStore.set(fileId, file);
      return respond({ file, upload: { url: `mock-upload:${fileId}`, expiresAt: new Date(Date.now() + 600_000).toISOString() } }, { mode: "mock" });
    },
    async uploadFileContent(uploadUrl, file, onProgress) {
      const fileId = uploadUrl.replace("mock-upload:", "");
      const current = mockFileStore.get(fileId);
      onProgress?.({ loaded: 0, total: file.size, percent: 0 });
      onProgress?.({ loaded: Math.floor(file.size * 0.45), total: file.size, percent: 45 });
      const uploaded = {
        ...(current ?? {
          id: fileId,
          ownerType: "MOCK",
          ownerId: "MOCK",
          storageKey: `mock/${fileId}/${file.name}`,
          createdAt: new Date().toISOString(),
        }),
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
        checksum: `mock-${file.size}-${file.lastModified}`,
        scanStatus: "clean" as const,
        canPreview: file.name.toLowerCase().endsWith(".pdf"),
      } satisfies FileDto;
      mockFileStore.set(fileId, uploaded);
      onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
      return respond(uploaded, { mode: "mock" });
    },
    async completeFileUpload(fileId, input = {}) {
      const current = mockFileStore.get(fileId);
      if (!current) throw new Error("NOT_FOUND: 파일 정보를 찾을 수 없습니다.");
      const completed = { ...current, checksum: input.checksum ?? current.checksum, scanStatus: "clean" as const };
      mockFileStore.set(fileId, completed);
      return respond(completed, { mode: "mock", ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
    },
    async listFiles(ownerType, ownerId) {
      const files = [...mockFileStore.values()].filter((file) => file.ownerType === ownerType && file.ownerId === ownerId);
      return respond(files.map((file) => ({ ...file })), { mode: "mock", ownerType, ownerId });
    },
    async getFileDownload(fileId, input) {
      if (!input.reason.trim()) throw new Error("VALIDATION_ERROR: 파일 다운로드 사유가 필요합니다.");
      const file = mockFileStore.get(fileId);
      if (!file) throw new Error("NOT_FOUND: 파일 정보를 찾을 수 없습니다.");
      return respond({ file, download: { url: `mock-download:${fileId}`, expiresAt: new Date(Date.now() + 600_000).toISOString() } }, { mode: "mock", downloadReasonLogged: true });
    },
    async deleteFile(fileId, input = {}) {
      const file = mockFileStore.get(fileId) ?? null;
      mockFileStore.delete(fileId);
      return respond(file, { mode: "mock", deleted: Boolean(file), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
    },
    async listRoleSettings() {
      return respond([...mockRoleSettingsStore.values()], { mode: "mock" });
    },
    async createRoleSettings(input) {
      const role: RoleSettingsDto = {
        id: `mock-role-${Date.now()}`,
        code: `MOCK_ROLE_${Date.now()}`,
        name: input.name,
        tag: input.tag ?? "그룹",
        userCount: 0,
        permissions: input.permissions,
        status: input.status,
        rowVersion: 1,
      };
      mockRoleSettingsStore.set(role.id, role);
      appendMockSettingsHistory(`권한 그룹 추가 (${role.name})`, "권한 변경");
      return respond(role, { mode: "mock", created: true });
    },
    async updateRoleSettings(roleId, patch) {
      const current = mockRoleSettingsStore.get(roleId) ?? [...mockRoleSettingsStore.values()].find((role) => role.name === roleId || role.code === roleId) ?? null;
      if (current && patch.rowVersion !== undefined && patch.rowVersion !== current.rowVersion) throw new Error("CONFLICT: 권한 그룹 정보가 이미 변경되었습니다.");
      if (!current) {
        const role: RoleSettingsDto = {
          id: roleId,
          code: roleId,
          name: patch.name ?? roleId,
          tag: patch.tag ?? "그룹",
          userCount: 0,
          permissions: patch.permissions ?? [],
          status: patch.status ?? "활성",
          rowVersion: (patch.rowVersion ?? 0) + 1,
        };
        mockRoleSettingsStore.set(role.id, role);
        appendMockSettingsHistory(`권한 그룹 추가 (${role.name})`, "권한 변경");
        return respond(role, { mode: "mock", created: true });
      }
      const updated = { ...current, ...patch, tag: patch.tag ?? current.tag, permissions: patch.permissions ?? current.permissions, rowVersion: current.rowVersion + 1 };
      mockRoleSettingsStore.set(updated.id, updated);
      appendMockSettingsHistory(`권한 그룹 수정 (${updated.name})`, "권한 변경");
      return respond(updated, { mode: "mock", found: true });
    },
    async deleteRoleSettings(roleId, input) {
      const current = mockRoleSettingsStore.get(roleId) ?? [...mockRoleSettingsStore.values()].find((role) => role.name === roleId || role.code === roleId) ?? null;
      if (current && current.userCount > 0) throw new Error("ROLE_IN_USE: 사용자가 배정된 권한 그룹은 삭제할 수 없습니다.");
      if (current && input?.rowVersion !== undefined && input.rowVersion !== current.rowVersion) throw new Error("CONFLICT: 권한 그룹 정보가 이미 변경되었습니다.");
      if (current) mockRoleSettingsStore.delete(current.id);
      if (current) appendMockSettingsHistory(`권한 그룹 삭제 (${current.name})`, "권한 변경");
      return respond(current, { mode: "mock", deleted: Boolean(current) });
    },
    async getSystemSettings() {
      const values = Object.fromEntries(mockSystemSettingsStore.entries()) as SystemSettingsSnapshot;
      values.__meta = Object.fromEntries(mockSystemSettingsVersionStore.entries()) as SystemSettingsSnapshot["__meta"];
      return respond(values, { mode: "mock" });
    },
    async listSystemSettingHistory() {
      return respond(mockSystemSettingHistoryStore.map((row) => ({ ...row })), { mode: "mock", total: mockSystemSettingHistoryStore.length });
    },
    async listAuditLogs(query = {}) {
      const result = buildMockAuditLogSearch(query);
      return respond(result, { mode: "mock", total: result.total, page: result.page, pageSize: result.pageSize });
    },
    async getOperationMode() {
      const status = buildMockOperationModeStatus();
      return respond(status, { mode: status.mode, active: status.active });
    },
    async getOperationalAlerts() {
      const summary = buildMockOperationalAlertSummary();
      return respond(summary, { mode: "mock", ok: summary.ok, triggered: summary.triggered.length });
    },
    async getBusinessFailureAlerts() {
      const summary = buildMockBusinessFailureAlertSummary();
      return respond(summary, { mode: "mock", ok: summary.ok, triggered: summary.triggered.length });
    },
    async getReportJobStatus() {
      const result = buildMockReportJobRunResult({ dryRun: true });
      return respond(result, { mode: "mock", ok: result.ok, due: result.summary.due });
    },
    async runReportJobs(input = {}) {
      const result = buildMockReportJobRunResult({ dryRun: false, ...input });
      appendMockSettingsHistory(`보고서 예약 job 실행 (${result.summary.processed}건)`, "운영 변경");
      return respond(result, { mode: "mock", ok: result.ok, processed: result.summary.processed });
    },
    async getPerformancePolicy() {
      const status = buildMockPerformancePolicyStatus();
      return respond(status, { mode: "mock", ok: status.ok, p95TargetMs: status.latency.p95TargetMs });
    },
    async saveSystemSetting(key, value, input = {}) {
      if (input.idempotencyKey) {
        const existing = mockSystemSettingsIdempotencyStore.get(input.idempotencyKey);
        if (existing) {
          if (existing.key !== key) throw new Error("IDEMPOTENCY_CONFLICT: 이미 다른 처리에 사용된 idempotencyKey입니다.");
          return respond(existing.value, { mode: "mock", key, saved: true, idempotencyReplay: true, auditLogId: existing.auditLogId });
        }
      }
      const currentVersion = mockSystemSettingsVersionStore.get(key)?.auditLogId ?? null;
      if (input.expectedAuditLogId !== undefined && input.expectedAuditLogId !== currentVersion) {
        throw new Error("CONFLICT: 시스템 설정이 이미 변경되었습니다.");
      }
      const auditLogId = `mock-setting-audit-${key}-${Date.now()}`;
      const updatedAt = new Date().toISOString();
      mockSystemSettingsStore.set(key, value);
      mockSystemSettingsVersionStore.set(key, { auditLogId, updatedAt });
      if (input.idempotencyKey) mockSystemSettingsIdempotencyStore.set(input.idempotencyKey, { key, value, auditLogId });
      const history = mockSystemSettingLabels[key];
      appendMockSettingsHistory(history.desc, history.tag);
      return respond(value, { mode: "mock", key, saved: true, auditLogId });
    },
    async testIntegrationSetting(integrationId, input: IntegrationTestInput = {}) {
      if (input.idempotencyKey) {
        const existing = mockIntegrationTestIdempotencyStore.get(input.idempotencyKey);
        if (existing) return respond(existing, { mode: "mock", integrationId, success: existing.success, idempotencyReplay: true });
      }
      const current = Array.isArray(mockSystemSettingsStore.get("integrations")) ? (mockSystemSettingsStore.get("integrations") as Array<Record<string, unknown>>) : [];
      const target = current.find((setting) => setting.id === integrationId || setting.name === integrationId);
      const testedAt = new Date().toISOString();
      const credentialRef = typeof target?.credentialRef === "string" ? target.credentialRef.trim() : "";
      const testEndpoint = typeof target?.testEndpoint === "string" ? target.testEndpoint.trim() : "";
      const failureReason = !target
        ? "외부 연동 설정을 찾을 수 없습니다."
        : !credentialRef
          ? "credential reference가 필요합니다."
          : !testEndpoint
            ? "테스트 endpoint가 필요합니다."
            : "";
      const result: IntegrationTestResult = {
        integrationId,
        success: !failureReason,
        status: failureReason ? "점검" : "연동",
        testedAt,
        lastSynced: failureReason ? String(target?.lastSynced ?? "-") : testedAt,
        failureReason,
        httpStatus: failureReason ? 0 : 200,
      };
      const updated = current.map((setting) =>
        setting.id === integrationId || setting.name === integrationId
          ? { ...setting, status: result.status, lastSynced: result.lastSynced, lastTestedAt: result.testedAt, lastFailureReason: result.failureReason }
          : setting,
      );
      mockSystemSettingsStore.set("integrations", updated);
      result.setting = updated.find((setting) => setting.id === integrationId || setting.name === integrationId);
      if (input.idempotencyKey) mockIntegrationTestIdempotencyStore.set(input.idempotencyKey, result);
      appendMockSettingsHistory(`외부 연동 테스트 (${integrationId})`, "연동 변경");
      return respond(result, { mode: "mock", integrationId, success: result.success });
    },
    async getRetentionPolicySummary() {
      return respond(buildMockRetentionPolicySummary(), { mode: "mock" });
    },
    async getAccountLifecycleSummary() {
      return respond(buildMockAccountLifecycleSummary(), { mode: "mock" });
    },
    async deactivateAccountLifecycle(input) {
      const result: AccountLifecycleDeactivateResult = {
        scope: input.scope,
        reason: input.reason,
        deactivatedCount: 0,
        sessionsRevoked: 0,
        dormantAccountDays: 90,
        dormantCutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        candidates: [],
      };
      appendMockSettingsHistory("계정 수명주기 비활성화 배치 실행", "사용자 변경");
      return respond(result, { mode: "mock", deactivatedCount: 0, sessionsRevoked: 0 });
    },
    async getFinancialReconciliationSummary() {
      return respond(buildMockFinancialReconciliationSummary(), { mode: "mock" });
    },
    async notifyFinancialReconciliation() {
      const summary = buildMockFinancialReconciliationSummary();
      const result: FinancialReconciliationNotifyResult = {
        summary,
        recipientCount: 1,
        notificationsCreated: summary.actionRequired ? summary.triggered.length : 0,
      };
      appendMockSettingsHistory("재무 대사 불일치 알림 발송", "알림 변경");
      return respond(result, { mode: "mock", recipientCount: result.recipientCount, notificationsCreated: result.notificationsCreated });
    },
    async listManualRecoveries() {
      return respond(buildMockManualRecoverySummary(), { mode: "mock" });
    },
    async requestManualRecovery(input) {
      const item = requestMockManualRecovery(input);
      appendMockSettingsHistory(`수동 복구 요청 (${input.targetCode})`, "운영 변경");
      return respond(buildMockManualRecoveryResult(item.id), { mode: "mock", recoveryId: item.id });
    },
    async approveManualRecovery(recoveryId, input) {
      reviewMockManualRecovery(recoveryId, input, "approved");
      appendMockSettingsHistory("수동 복구 승인", "운영 변경");
      return respond(buildMockManualRecoveryResult(recoveryId), { mode: "mock", recoveryId });
    },
    async rejectManualRecovery(recoveryId, input) {
      reviewMockManualRecovery(recoveryId, input, "rejected");
      appendMockSettingsHistory("수동 복구 반려", "운영 변경");
      return respond(buildMockManualRecoveryResult(recoveryId), { mode: "mock", recoveryId });
    },
    async getFinancialControlReport() {
      return respond(buildMockFinancialControlReport(), { mode: "mock" });
    },
    async getPermissionReviewReport() {
      const report = buildMockPermissionReviewReport();
      return respond(report, { mode: "mock", ok: report.ok, exceptions: report.summary.exceptions });
    },
  };
}
