import type { ApiResponse, AuthUserDto, LoginRequestDto, NotificationDto, ReleaseIdentityDto } from "./contracts";
import { ApiRequestError, errorFromApiResponse } from "./errors";
import type { AuthUser, ListQuery, MockApiResponse, NotificationItem, PageKey, PaginatedRows, TableRow } from "../types";

export type PageActionRequest = {
  reason?: string;
  idColumn?: string;
  rowVersion?: number | string;
  요청RowVersion?: number | string;
  예산RowVersion?: number | string;
  보고서RowVersion?: number | string;
  즐겨찾기RowVersion?: number | string;
  idempotencyKey?: string;
  patch?: TableRow;
};

export type BudgetAdjustmentInput = {
  amount: number;
  reason: string;
  rowVersion?: number;
  idempotencyKey?: string;
};

export type BudgetAdjustmentResult = {
  adjustment: TableRow;
  budget: TableRow;
  requiresApproval: boolean;
};

export type BudgetAdjustmentActionInput = {
  reason?: string;
  idempotencyKey?: string;
};

export type BudgetAdjustmentActionResult = {
  adjustment: TableRow;
  budget: TableRow | null;
  rollbackPolicy: string;
};

export type FileOwnerType = "PAYMENT_REQUEST" | "VENDOR";

export type FileDto = {
  id: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storageKey: string;
  checksum: string;
  scanStatus: "pending" | "clean" | "blocked";
  canPreview: boolean;
  createdAt: string;
};

export type FileUploadInput = {
  ownerType: FileOwnerType;
  ownerId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksum?: string;
  idempotencyKey?: string;
};

export type FileUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type FileUploadProgressHandler = (progress: FileUploadProgress) => void;

export type FileCompleteInput = {
  checksum?: string;
  idempotencyKey?: string;
};

export type FileDeleteInput = {
  idempotencyKey?: string;
};

export type FileDownloadInput = {
  reason: string;
};

export type SignedFileUrl = {
  url: string;
  expiresAt: string;
};

export type FileUploadTicket = {
  file: FileDto;
  upload: SignedFileUrl;
};

export type FileDownloadTicket = {
  file: FileDto;
  download: SignedFileUrl;
};

export type RoleSettingsDto = {
  id: string;
  code: string;
  name: string;
  tag: string;
  userCount: number;
  permissions: string[];
  status: "활성" | "비활성";
  rowVersion: number;
};

export type RoleSettingsInput = {
  name: string;
  tag?: string;
  permissions: string[];
  status: "활성" | "비활성";
  rowVersion?: number;
  idempotencyKey?: string;
};

export type RoleSettingsDeleteInput = {
  rowVersion?: number;
  idempotencyKey?: string;
};

export type SystemSettingKey = "approvalPolicy" | "notifications" | "integrations";

export type SystemSettingSnapshotMeta = {
  auditLogId: string | null;
  updatedAt: string | null;
};

export type SystemSettingsSnapshot = Partial<Record<SystemSettingKey, unknown>> & {
  __meta?: Partial<Record<SystemSettingKey, SystemSettingSnapshotMeta>>;
};

export type SystemSettingSaveInput = {
  expectedAuditLogId?: string | null;
  idempotencyKey?: string;
  reason?: string;
};

export type SystemSettingHistoryRow = {
  id: string;
  time: string;
  user: string;
  desc: string;
  tag: string;
};

export type AuditLogSearchQuery = {
  search?: string;
  entityType?: string;
  action?: string;
  requestId?: string;
  actor?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogSearchRow = {
  id: string;
  time: string;
  actor: string;
  actorDepartment: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  summary: string;
};

export type AuditLogSearchResult = {
  rows: AuditLogSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  accessScope: string;
  rawValuePolicy: string;
  retention: {
    retentionDays: number | null;
    disposition: string;
    immutable: boolean;
    archiveAction: string;
  };
};

export type OperationModeCapability = "business_mutations" | "payments" | "file_uploads";

export type OperationModeStatus = {
  mode: "normal" | "read_only" | "payments_paused" | "uploads_paused" | "maintenance";
  label: string;
  active: boolean;
  readOnly: boolean;
  disabledCapabilities: OperationModeCapability[];
  restrictions: Array<{
    capability: OperationModeCapability;
    label: string;
    summary: string;
  }>;
  source: {
    operationMode: string;
    disabledCapabilities: string;
  };
  generatedAt: string;
};

export type OperationalAlertRuleResult = {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  threshold: number;
  eventTypes: string[];
  severity: "warning" | "critical";
  runbook: string;
};

export type OperationalAlertSummary = {
  ok: boolean;
  windowMinutes: number;
  since: string;
  until: string;
  database: {
    ok: boolean;
    latencyMs: number;
    error: string | null;
  };
  countsByEventType: Record<string, number>;
  eventReadError: string | null;
  rules: OperationalAlertRuleResult[];
  triggered: OperationalAlertRuleResult[];
  metrics: {
    eventsReviewed: number;
    ruleFailureRatePercent: number;
    criticalTriggered: number;
    warningTriggered: number;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    maxLatencyMs: number | null;
    latencySampleSize: number;
    dbLatencyMs: number;
    latencyTargets: {
      p95TargetMs: number;
      p99TargetMs: number;
      currentP95Ms: number | null;
      currentP99Ms: number | null;
      p95Ok: boolean;
      p99Ok: boolean;
      sampleSize: number;
      source: string;
    };
  };
};

export type BusinessFailureRecentEvent = {
  id: string;
  eventType: string;
  errorCode: string;
  message: string;
  statusCode: number;
  path: string | null;
  requestId: string;
  createdAt: string;
};

export type BusinessFailureRuleResult = {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  threshold: number;
  pathPrefixes: string[];
  eventTypes: string[];
  severity: "warning" | "critical";
  ownerPermission: string;
  linkPath: string;
  runbook: string;
  recentEvents: BusinessFailureRecentEvent[];
};

export type BusinessFailureAlertSummary = {
  ok: boolean;
  windowMinutes: number;
  since: string;
  until: string;
  eventsReviewed: number;
  eventReadError: string | null;
  rules: BusinessFailureRuleResult[];
  triggered: BusinessFailureRuleResult[];
};

export type ReportJobPolicy = {
  deliveryMode: string;
  batchSize: number;
  maxAttempts: number;
  timeoutMs: number;
  retryBaseSeconds: number;
  retryMaxSeconds: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerWindowMinutes: number;
  webhookConfigured: boolean;
  webhookTokenConfigured: boolean;
};

export type ReportJobCircuitBreaker = {
  open: boolean;
  recentFailures: number;
  threshold: number;
  windowMinutes: number;
  since: string;
};

export type ReportJobDueSchedule = {
  id: string;
  reportName: string;
  owner: string;
  nextRunAt: string | null;
};

export type ReportJobResult = {
  scheduleId: string;
  reportName: string;
  status: "delivered" | "retry_scheduled" | "dead_letter";
  attempt: number;
  nextRunAt: string | null;
  errorMessage: string;
};

export type ReportJobRunResult = {
  ok: boolean;
  dryRun: boolean;
  generatedAt: string;
  policy: ReportJobPolicy;
  circuitBreaker: ReportJobCircuitBreaker;
  summary: {
    due: number;
    processed: number;
    delivered: number;
    retryScheduled: number;
    deadLetter: number;
    skipped: number;
  };
  dueSchedules: ReportJobDueSchedule[];
  results: ReportJobResult[];
};

export type ReportJobRunInput = {
  dryRun?: boolean;
  batchSize?: number;
};

export type PerformancePolicyStatus = {
  ok: boolean;
  generatedAt: string;
  latency: {
    p95TargetMs: number;
    p99TargetMs: number;
    currentP95Ms: number | null;
    currentP99Ms: number | null;
    p95Ok: boolean;
    p99Ok: boolean;
    sampleSize: number;
    source: string;
  };
  reportJob: {
    maxProcessingMs: number;
    workerTimeoutMs: number;
    batchSize: number;
    maxAttempts: number;
    source: string;
  };
  largeDownload: {
    maxReportRows: number;
    maxReportBytes: number;
    source: string;
  };
};

export type IntegrationTestResult = {
  integrationId: string;
  success: boolean;
  status: "연동" | "점검";
  testedAt: string;
  lastSynced: string;
  failureReason: string;
  httpStatus: number;
  setting?: Record<string, unknown>;
};

export type IntegrationTestInput = {
  idempotencyKey?: string;
};

export type FrontendReleaseIdentity = {
  apiMode: "mock" | "remote";
  apiBaseUrl: string;
  releaseVersion: string | null;
  sourceRef: string | null;
  gitCommit: string | null;
  missing: string[];
};

export type ReleaseIdentityComparison = {
  ok: boolean;
  frontend: FrontendReleaseIdentity;
  backend: ReleaseIdentityDto;
  issues: string[];
};

export type PasswordPolicySummary = {
  minLength: number;
  maxAgeDays: number;
  requirements: string[];
};

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

export type ExpiredPasswordChangeInput = PasswordChangeInput & {
  email: string;
};

export type PasswordChangeResult = {
  changedAt: string;
  expiresAt: string;
  sessionsRevoked: number;
  policy: PasswordPolicySummary;
};

export type RetentionPolicyDto = {
  entityType: string;
  label: string;
  retentionDays: number | null;
  retentionLabel: string;
  clockField: string;
  immutable: boolean;
  hardDeleteAllowed: boolean;
  legalHoldSupported: boolean;
  disposition: string;
  protectedFields: string[];
  operatorAction: string;
  deletionPolicy: string;
};

export type RetentionPolicyCheck = {
  id: string;
  label: string;
  ok: boolean;
  severity: "info" | "warning" | "critical";
  count: number;
  detail: string;
  action: string;
};

export type RetentionPolicySummary = {
  ok: boolean;
  actionRequired: boolean;
  generatedAt: string;
  policyVersion: string;
  summary: {
    auditLogs: number;
    notifications: number;
    attachments: number;
    reportRuns: number;
    immutablePolicies: number;
    hardDeleteAllowedPolicies: number;
    triggeredChecks: number;
  };
  policies: RetentionPolicyDto[];
  checks: RetentionPolicyCheck[];
  triggered: RetentionPolicyCheck[];
};

export type AccountLifecycleCandidate = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
  reasons: string[];
};

export type AccountLifecycleSummary = {
  ok: boolean;
  actionRequired: boolean;
  generatedAt: string;
  dormantAccountDays: number;
  dormantCutoff: string;
  offboardingConfigured: boolean;
  summary: {
    dormantCount: number;
    offboardingCount: number;
    totalCandidates: number;
  };
  candidates: AccountLifecycleCandidate[];
};

export type AccountLifecycleDeactivateInput = {
  scope: "dormant" | "offboarding" | "all";
  reason: string;
  idempotencyKey: string;
};

export type AccountLifecycleDeactivateResult = {
  scope: string;
  reason: string;
  deactivatedCount: number;
  sessionsRevoked: number;
  dormantAccountDays: number;
  dormantCutoff: string;
  candidates: Array<Record<string, string>>;
};

export type FinancialReconciliationSeverity = "warning" | "critical";

export type FinancialReconciliationCheck = {
  id: string;
  label: string;
  ok: boolean;
  severity: FinancialReconciliationSeverity;
  count: number;
  detail: string;
  action: string;
};

export type FinancialReconciliationMismatch = {
  id: string;
  type: string;
  severity: FinancialReconciliationSeverity;
  label: string;
  scope: string;
  expected: number;
  actual: number;
  diff: number;
  detail: string;
  linkPath: string;
};

export type FinancialReconciliationBucket = {
  period: string;
  departmentId: string;
  departmentName: string;
  approvedPaymentCount: number;
  approvedPaymentAmount: number;
  completedDisbursementCount: number;
  completedDisbursementAmount: number;
  diff: number;
};

export type FinancialReconciliationSummary = {
  ok: boolean;
  actionRequired: boolean;
  generatedAt: string;
  toleranceWon: number;
  summary: {
    budgets: number;
    budgetItems: number;
    paymentRequests: number;
    approvedPaymentRequests: number;
    disbursements: number;
    completedDisbursements: number;
    reportRunsReviewed: number;
    reportSnapshotsReviewed: number;
    reportRowsReviewed: number;
    totalBudgetAllocated: number;
    totalBudgetUsed: number;
    approvedPaymentAmount: number;
    completedDisbursementAmount: number;
    criticalMismatchCount: number;
    warningMismatchCount: number;
    mismatchCount: number;
  };
  checks: FinancialReconciliationCheck[];
  triggered: FinancialReconciliationCheck[];
  mismatches: FinancialReconciliationMismatch[];
  mismatchesTruncated: boolean;
  monthly: FinancialReconciliationBucket[];
  daily: FinancialReconciliationBucket[];
};

export type FinancialReconciliationNotifyResult = {
  summary: FinancialReconciliationSummary;
  recipientCount: number;
  notificationsCreated: number;
};

export type ManualRecoveryItem = {
  id: string;
  status: "pending" | "approved" | "rejected" | string;
  targetType: string;
  targetCode: string;
  reviewerName: string;
  approverName: string;
  requestedAt: string;
  reviewedAt: string;
  reason: string;
  approvalReason: string;
  expectedRowVersion: number;
  proposed: Record<string, unknown>;
};

export type ManualRecoverySummary = {
  ok: boolean;
  generatedAt: string;
  summary: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  items: ManualRecoveryItem[];
  pending: ManualRecoveryItem[];
};

export type ManualRecoveryRequestInput = {
  targetType: "disbursement";
  targetCode: string;
  nextStatus: string;
  accountStatus?: string;
  scheduledDate?: string;
  reason: string;
  idempotencyKey: string;
};

export type ManualRecoveryReviewInput = {
  reason: string;
  idempotencyKey: string;
};

export type ManualRecoveryResult = {
  idempotencyReplay: boolean;
  recoveryId: string;
  summary: ManualRecoverySummary;
};

export type FinancialControlException = {
  id: string;
  severity: "info" | "warning" | "critical";
  label: string;
  scope: string;
  detail: string;
  source: string;
  linkPath: string;
};

export type MonthEndChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  owner: string;
  detail: string;
  evidence: string;
};

export type FinancialControlReport = {
  ok: boolean;
  generatedAt: string;
  period: {
    month: string;
    start: string;
    endExclusive: string;
  };
  summary: {
    exceptions: number;
    criticalExceptions: number;
    warningExceptions: number;
    manualRecoveryPending: number;
    manualRecoveryClosed: number;
    bankReconcileCount: number;
    disbursementAuditCount: number;
    checklistPassed: number;
    checklistTotal: number;
  };
  exceptions: FinancialControlException[];
  checklist: MonthEndChecklistItem[];
};

export type PaymentMasterVendor = {
  id?: string;
  name: string;
  businessNumber?: string;
  managerName?: string;
  taxInvoiceEmail?: string;
  taxInvoiceIssueType?: string;
  status: "활성" | "비활성" | string;
  accountStatus: string;
};

export type PaymentMasterDepartment = {
  name: string;
  budgetRemaining: number;
  budgetStatus: string;
};

export type PaymentBudgetItem = {
  id: string;
  departmentName: string;
  name: string;
  remaining: number;
  status: string;
};

export type PaymentApprovalCandidate = {
  id: string;
  name: string;
  departmentName: string;
  roleLabel: string;
};

export type PaymentRequestMasterData = {
  vendors: PaymentMasterVendor[];
  departments: PaymentMasterDepartment[];
  budgetItems: PaymentBudgetItem[];
  approvalCandidates: PaymentApprovalCandidate[];
};

export type BankTransferExportSummary = {
  targetCount: number;
  exportedCount: number;
  blockedCount: number;
  totalAmount: number;
  vendorCount: number;
  accountVerifiedCount: number;
  disbursementAccountVerifiedCount: number;
  vendorAccountVerifiedCount: number;
  approvalVerifiedCount: number;
  scheduledCount: number;
  dueTodayCount: number;
  scheduledFrom?: string;
  scheduledTo?: string;
  bank?: string;
  department?: string;
  status?: string;
  generatedAt: string;
  disbursementCodes: string[];
  reconciliationRows: Array<Record<string, string | number>>;
};

export type BankTransferExport = {
  fileName: string;
  contentType: string;
  csv: string;
  summary: BankTransferExportSummary;
};

export type ReportDownloadFormat = "csv" | "pdf";

export type ReportDownload = {
  fileName: string;
  contentType: string;
  contentBase64: string;
  generatedAt: string;
  limits?: {
    rowCount: number;
    contentBytes: number;
  };
  artifact?: {
    storageKey: string;
    storedAt: string;
    source: string;
  };
  report: TableRow;
};

export type ReportScheduleDto = {
  id: string;
  title: string;
  reportName: string;
  reportType: string;
  frequency: string;
  cycle: string;
  time: string;
  format: string;
  recipients: string[];
  recipientLabel: string;
  isActive: boolean;
  status: "활성" | "중지" | string;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
};

export type ReportScheduleInput = {
  reportName: string;
  reportType: string;
  cycle: string;
  time: string;
  format: string;
  recipients: string[];
  isActive?: boolean;
  rowVersion?: number;
  idempotencyKey?: string;
};

export type BankResultReconcileRow = {
  disbursementCode: string;
  approvalCode?: string;
  amount: number;
  status: "SUCCESS" | "FAILED";
  bankResultId?: string;
  message?: string;
};

export type BankResultReconcileSummary = {
  targetCount: number;
  matchedCount: number;
  bankFailedCount: number;
  mismatchCount: number;
  totalAmount: number;
  reconciledAt: string;
  rows: Array<Record<string, string | number>>;
  afterRows?: TableRow[];
};

export type ErpApiService = {
  getCurrentUser(): Promise<MockApiResponse<AuthUser>>;
  login(input: LoginRequestDto): Promise<MockApiResponse<AuthUser>>;
  logout(): Promise<MockApiResponse<{ ok: true }>>;
  getPasswordPolicy(): Promise<MockApiResponse<PasswordPolicySummary>>;
  changePassword(input: PasswordChangeInput): Promise<MockApiResponse<PasswordChangeResult>>;
  changeExpiredPassword(input: ExpiredPasswordChangeInput): Promise<MockApiResponse<PasswordChangeResult>>;
  listNotifications(): Promise<MockApiResponse<NotificationItem[]>>;
  markNotificationRead(notificationId: string): Promise<MockApiResponse<NotificationItem | null>>;
  markAllNotificationsRead(): Promise<MockApiResponse<NotificationItem[]>>;
  getPaymentRequestMasterData(): Promise<MockApiResponse<PaymentRequestMasterData>>;
  listPageRows(pageKey: PageKey, query?: ListQuery): Promise<MockApiResponse<PaginatedRows>>;
  getPageRow(pageKey: PageKey, rowId: string): Promise<MockApiResponse<TableRow | null>>;
  createPageRow(pageKey: PageKey, row: TableRow): Promise<MockApiResponse<TableRow>>;
  updatePageRow(pageKey: PageKey, rowId: string, patch: TableRow): Promise<MockApiResponse<TableRow | null>>;
  deletePageRow(pageKey: PageKey, rowId: string, input?: PageActionRequest): Promise<MockApiResponse<TableRow | null>>;
  executePageAction(pageKey: PageKey, rowId: string, action: string, input?: PageActionRequest): Promise<MockApiResponse<TableRow | null>>;
  listBudgetAdjustments(departmentName: string): Promise<MockApiResponse<TableRow[]>>;
  createBudgetAdjustment(departmentName: string, input: BudgetAdjustmentInput): Promise<MockApiResponse<BudgetAdjustmentResult>>;
  updateBudgetAdjustment(departmentName: string, adjustmentId: string, action: "cancel" | "reject", input?: BudgetAdjustmentActionInput): Promise<MockApiResponse<BudgetAdjustmentActionResult>>;
  downloadReport(reportName: string, format: ReportDownloadFormat): Promise<MockApiResponse<ReportDownload>>;
  listReportSchedules(): Promise<MockApiResponse<ReportScheduleDto[]>>;
  createReportSchedule(input: ReportScheduleInput): Promise<MockApiResponse<ReportScheduleDto>>;
  updateReportSchedule(scheduleId: string, patch: Partial<ReportScheduleInput>): Promise<MockApiResponse<ReportScheduleDto | null>>;
  deleteReportSchedule(scheduleId: string, input?: { rowVersion?: number; idempotencyKey?: string }): Promise<MockApiResponse<ReportScheduleDto | null>>;
  exportDisbursementBankTransfer(query?: ListQuery): Promise<MockApiResponse<BankTransferExport>>;
  reconcileDisbursementBankResults(input: { idempotencyKey: string; rows: BankResultReconcileRow[] }): Promise<MockApiResponse<BankResultReconcileSummary>>;
  presignFileUpload(input: FileUploadInput): Promise<MockApiResponse<FileUploadTicket>>;
  uploadFileContent(uploadUrl: string, file: File, onProgress?: FileUploadProgressHandler): Promise<MockApiResponse<FileDto>>;
  completeFileUpload(fileId: string, input?: FileCompleteInput): Promise<MockApiResponse<FileDto>>;
  listFiles(ownerType: FileOwnerType, ownerId: string): Promise<MockApiResponse<FileDto[]>>;
  getFileDownload(fileId: string, input: FileDownloadInput): Promise<MockApiResponse<FileDownloadTicket>>;
  deleteFile(fileId: string, input?: FileDeleteInput): Promise<MockApiResponse<FileDto | null>>;
  listRoleSettings(): Promise<MockApiResponse<RoleSettingsDto[]>>;
  createRoleSettings(input: RoleSettingsInput): Promise<MockApiResponse<RoleSettingsDto>>;
  updateRoleSettings(roleId: string, patch: Partial<RoleSettingsInput>): Promise<MockApiResponse<RoleSettingsDto | null>>;
  deleteRoleSettings(roleId: string, input?: RoleSettingsDeleteInput): Promise<MockApiResponse<RoleSettingsDto | null>>;
  getSystemSettings(): Promise<MockApiResponse<SystemSettingsSnapshot>>;
  listSystemSettingHistory(): Promise<MockApiResponse<SystemSettingHistoryRow[]>>;
  listAuditLogs(query?: AuditLogSearchQuery): Promise<MockApiResponse<AuditLogSearchResult>>;
  getOperationMode(): Promise<MockApiResponse<OperationModeStatus>>;
  getOperationalAlerts(): Promise<MockApiResponse<OperationalAlertSummary>>;
  getBusinessFailureAlerts(): Promise<MockApiResponse<BusinessFailureAlertSummary>>;
  getReportJobStatus(): Promise<MockApiResponse<ReportJobRunResult>>;
  runReportJobs(input?: ReportJobRunInput): Promise<MockApiResponse<ReportJobRunResult>>;
  getPerformancePolicy(): Promise<MockApiResponse<PerformancePolicyStatus>>;
  saveSystemSetting(key: SystemSettingKey, value: unknown, input?: SystemSettingSaveInput): Promise<MockApiResponse<unknown>>;
  testIntegrationSetting(integrationId: string, input?: IntegrationTestInput): Promise<MockApiResponse<IntegrationTestResult>>;
  getRetentionPolicySummary(): Promise<MockApiResponse<RetentionPolicySummary>>;
  getAccountLifecycleSummary(): Promise<MockApiResponse<AccountLifecycleSummary>>;
  deactivateAccountLifecycle(input: AccountLifecycleDeactivateInput): Promise<MockApiResponse<AccountLifecycleDeactivateResult>>;
  getFinancialReconciliationSummary(): Promise<MockApiResponse<FinancialReconciliationSummary>>;
  notifyFinancialReconciliation(): Promise<MockApiResponse<FinancialReconciliationNotifyResult>>;
  listManualRecoveries(): Promise<MockApiResponse<ManualRecoverySummary>>;
  requestManualRecovery(input: ManualRecoveryRequestInput): Promise<MockApiResponse<ManualRecoveryResult>>;
  approveManualRecovery(recoveryId: string, input: ManualRecoveryReviewInput): Promise<MockApiResponse<ManualRecoveryResult>>;
  rejectManualRecovery(recoveryId: string, input: ManualRecoveryReviewInput): Promise<MockApiResponse<ManualRecoveryResult>>;
  getFinancialControlReport(): Promise<MockApiResponse<FinancialControlReport>>;
};

const resourcePathByPage: Record<PageKey, string> = {
  dashboard: "/dashboard",
  "payment-request": "/payment-requests",
  approval: "/approvals",
  disbursement: "/disbursements",
  budget: "/budgets",
  vendors: "/vendors",
  reports: "/reports",
  settings: "/settings",
  favorites: "/favorites",
};

function getApiBaseUrl() {
  return import.meta.env.VITE_ERP_API_BASE_URL || "/api";
}

function getApiMode() {
  return import.meta.env.VITE_ERP_API_MODE === "remote" ? "remote" : "mock";
}

function trimmedEnvValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function getFrontendReleaseIdentity(): FrontendReleaseIdentity {
  const releaseVersion = trimmedEnvValue(import.meta.env.VITE_RELEASE_VERSION);
  const sourceRef = trimmedEnvValue(import.meta.env.VITE_RELEASE_SOURCE_REF);
  const gitCommit = trimmedEnvValue(import.meta.env.VITE_RELEASE_GIT_COMMIT);
  return {
    apiMode: getApiMode(),
    apiBaseUrl: getApiBaseUrl(),
    releaseVersion,
    sourceRef,
    gitCommit,
    missing: [
      ["VITE_RELEASE_VERSION", releaseVersion],
      ["VITE_RELEASE_SOURCE_REF", sourceRef],
      ["VITE_RELEASE_GIT_COMMIT", gitCommit],
    ].filter(([, value]) => !value).map(([name]) => String(name)),
  };
}

function compareReleaseField(label: string, frontendValue: string | null, backendValue: string | null) {
  if (!frontendValue || !backendValue) return null;
  return frontendValue === backendValue ? null : `${label} mismatch: frontend=${frontendValue}, backend=${backendValue}`;
}

export async function verifyRemoteReleaseIdentity(): Promise<ReleaseIdentityComparison> {
  const frontend = getFrontendReleaseIdentity();
  const backend = await requestRemote<ReleaseIdentityDto>("/health/version");
  const issues = [
    ...frontend.missing.map((name) => `${name} is missing from the frontend build.`),
    ...backend.missing.map((name) => `${name} is missing from the backend release environment.`),
    ...backend.issues,
    compareReleaseField("releaseVersion", frontend.releaseVersion, backend.releaseVersion),
    compareReleaseField("sourceRef", frontend.sourceRef, backend.sourceRef),
    compareReleaseField("gitCommit", frontend.gitCommit, backend.gitCommit),
  ].filter((item): item is string => Boolean(item));

  return {
    ok: frontend.apiMode === "remote" && backend.ok && issues.length === 0,
    frontend,
    backend,
    issues,
  };
}

function normalizeApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) {
    const base = new URL(getApiBaseUrl(), window.location.origin);
    return `${base.origin}${pathOrUrl}`;
  }
  return `${getApiBaseUrl()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function toQueryString(query: Record<string, unknown> & { filters?: Partial<Record<string, string>> } = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (key === "filters") return;
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") params.set(key, String(value));
  });
  Object.entries(query.filters ?? {}).forEach(([key, value]) => {
    if (value) params.set(`filter.${key}`, value);
  });
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

function getCookieValue(name: string) {
  if (typeof document === "undefined") return "";
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
}

function addDefaultRemoteHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const method = init?.method?.toUpperCase() ?? "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = getCookieValue("erp_csrf");
    if (token && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", decodeURIComponent(token));
  }
  return headers;
}

const remoteRequestTimeoutMs = 15_000;
const remoteRetryDelayMs = 350;
const retryableRemoteStatuses = new Set([408, 429, 502, 503, 504]);

function remoteRequestMethod(init?: RequestInit) {
  return init?.method?.toUpperCase() ?? "GET";
}

function canRetryRemoteRequest(init?: RequestInit) {
  return ["GET", "HEAD", "OPTIONS"].includes(remoteRequestMethod(init));
}

function wait(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function apiErrorCodeForStatus(status: number) {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "SERVER_ERROR";
}

function apiErrorMessageForStatus(status: number) {
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  return "서버 응답을 처리하지 못했습니다.";
}

async function fetchRemoteWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  let timeoutHit = false;
  const timeoutId = globalThis.setTimeout(() => {
    timeoutHit = true;
    controller.abort();
  }, remoteRequestTimeoutMs);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const errorName = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
    if (errorName === "AbortError") {
      throw new ApiRequestError(
        timeoutHit ? "NETWORK_TIMEOUT" : "REQUEST_ABORTED",
        timeoutHit ? "요청 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요." : "요청이 중단되었습니다.",
      );
    }
    throw new ApiRequestError("NETWORK_ERROR", "네트워크 연결 오류가 발생했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.");
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

async function readRemoteApiPayload<T>(response: Response): Promise<Extract<ApiResponse<T>, { status: "success" }>> {
  const text = await response.text();
  if (!text.trim()) {
    throw new ApiRequestError(apiErrorCodeForStatus(response.status), apiErrorMessageForStatus(response.status));
  }

  let payload: ApiResponse<T>;
  try {
    payload = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new ApiRequestError(apiErrorCodeForStatus(response.status), apiErrorMessageForStatus(response.status));
  }

  if (payload.status === "error") {
    const error = errorFromApiResponse(payload);
    if (error) throw error;
    throw new ApiRequestError(apiErrorCodeForStatus(response.status), payload.error.message);
  }
  return payload;
}

async function requestRemoteEnvelope<T>(path: string, init?: RequestInit): Promise<Extract<ApiResponse<T>, { status: "success" }>> {
  const url = `${getApiBaseUrl()}${path}`;
  const requestInit: RequestInit = {
    ...(init ?? {}),
    credentials: "include",
    headers: addDefaultRemoteHeaders(init),
  };
  const maxAttempts = canRetryRemoteRequest(init) ? 2 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchRemoteWithTimeout(url, requestInit);
      if (attempt + 1 < maxAttempts && retryableRemoteStatuses.has(response.status)) {
        await response.text().catch(() => "");
        await wait(remoteRetryDelayMs * (attempt + 1));
        continue;
      }
      return await readRemoteApiPayload<T>(response);
    } catch (error) {
      lastError = error;
      const retryableError = error instanceof ApiRequestError && ["NETWORK_ERROR", "NETWORK_TIMEOUT"].includes(error.code);
      if (attempt + 1 < maxAttempts && retryableError) {
        await wait(remoteRetryDelayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ApiRequestError("NETWORK_ERROR", "요청을 처리하지 못했습니다.");
}

async function requestRemote<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await requestRemoteEnvelope<T>(path, init);
  return payload.data;
}

function uploadProgressFromEvent(event: ProgressEvent, fallbackTotal: number): FileUploadProgress {
  const total = event.lengthComputable && event.total > 0 ? event.total : fallbackTotal;
  const loaded = Math.min(event.loaded, total);
  return {
    loaded,
    total,
    percent: total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0,
  };
}

function parseRemotePayload<T>(responseText: string, status = 200): T {
  if (!responseText.trim()) {
    throw new ApiRequestError(apiErrorCodeForStatus(status), apiErrorMessageForStatus(status));
  }
  let payload: ApiResponse<T>;
  try {
    payload = JSON.parse(responseText) as ApiResponse<T>;
  } catch {
    throw new ApiRequestError(apiErrorCodeForStatus(status), apiErrorMessageForStatus(status));
  }
  if (payload.status === "error") {
    const error = errorFromApiResponse(payload);
    if (error) throw error;
    throw new ApiRequestError(apiErrorCodeForStatus(status), payload.error.message);
  }
  return payload.data;
}

async function uploadRemoteFileContent<T>(url: string, file: File, onProgress?: FileUploadProgressHandler): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", normalizeApiUrl(url));
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => onProgress?.(uploadProgressFromEvent(event, file.size));
    xhr.onerror = () => reject(new ApiRequestError("NETWORK_ERROR", "파일 업로드 중 네트워크 오류가 발생했습니다."));
    xhr.onabort = () => reject(new ApiRequestError("UPLOAD_ABORTED", "파일 업로드가 중단되었습니다."));
    xhr.onload = () => {
      try {
        const data = parseRemotePayload<T>(xhr.responseText, xhr.status);
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    onProgress?.({ loaded: 0, total: file.size, percent: 0 });
    xhr.send(file);
  });
}

function remoteResponse<T>(data: T, meta?: MockApiResponse<T>["meta"]): MockApiResponse<T> {
  return { ok: true, data, meta };
}

function primitiveApiMeta(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return Object.entries(meta).reduce<Record<string, string | number | boolean>>((acc, [key, value]) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") acc[key] = value;
    return acc;
  }, {});
}

const remoteService: ErpApiService = {
  async getCurrentUser() {
    const data = await requestRemote<AuthUserDto>("/auth/me");
    return remoteResponse(data);
  },
  async login(input) {
    const data = await requestRemote<AuthUserDto>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data);
  },
  async logout() {
    const data = await requestRemote<{ ok: true }>("/auth/logout", {
      method: "POST",
    });
    return remoteResponse(data);
  },
  async getPasswordPolicy() {
    const data = await requestRemote<PasswordPolicySummary>("/auth/password-policy");
    return remoteResponse(data);
  },
  async changePassword(input) {
    const data = await requestRemote<PasswordChangeResult>("/auth/password/change", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { sessionsRevoked: data.sessionsRevoked });
  },
  async changeExpiredPassword(input) {
    const data = await requestRemote<PasswordChangeResult>("/auth/password/change-expired", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { sessionsRevoked: data.sessionsRevoked });
  },
  async listNotifications() {
    const data = await requestRemote<NotificationDto[]>("/notifications");
    return remoteResponse(data);
  },
  async markNotificationRead(notificationId) {
    const data = await requestRemote<NotificationDto | null>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "PATCH",
    });
    return remoteResponse(data, { notificationId });
  },
  async markAllNotificationsRead() {
    const data = await requestRemote<NotificationDto[]>("/notifications/read-all", {
      method: "POST",
    });
    return remoteResponse(data);
  },
  async getPaymentRequestMasterData() {
    const data = await requestRemote<PaymentRequestMasterData>("/payment-requests/master-data");
    return remoteResponse(data);
  },
  async listPageRows(pageKey, query = {}) {
    const data = await requestRemote<PaginatedRows>(`${resourcePathByPage[pageKey]}${toQueryString(query)}`);
    return remoteResponse(data, { pageKey, total: data.total });
  },
  async getPageRow(pageKey, rowId) {
    const data = await requestRemote<TableRow | null>(`${resourcePathByPage[pageKey]}/${encodeURIComponent(rowId)}`);
    return remoteResponse(data, { pageKey, rowId, found: Boolean(data) });
  },
  async createPageRow(pageKey, row) {
    const data = await requestRemote<TableRow>(resourcePathByPage[pageKey], {
      method: "POST",
      body: JSON.stringify(row),
    });
    return remoteResponse(data, { pageKey, created: true });
  },
  async updatePageRow(pageKey, rowId, patch) {
    const payload = await requestRemoteEnvelope<TableRow | null>(`${resourcePathByPage[pageKey]}/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return remoteResponse(payload.data, { ...primitiveApiMeta(payload.meta), pageKey, rowId, found: Boolean(payload.data) });
  },
  async deletePageRow(pageKey, rowId, input = {}) {
    const data = await requestRemote<TableRow | null>(`${resourcePathByPage[pageKey]}/${encodeURIComponent(rowId)}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { pageKey, rowId, deleted: Boolean(data) });
  },
  async executePageAction(pageKey, rowId, action, input = {}) {
    const data = await requestRemote<TableRow | null>(`${resourcePathByPage[pageKey]}/${encodeURIComponent(rowId)}/${encodeURIComponent(action)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { pageKey, rowId, action, found: Boolean(data) });
  },
  async listBudgetAdjustments(departmentName) {
    const data = await requestRemote<TableRow[]>(`/budgets/${encodeURIComponent(departmentName)}/adjustments`);
    return remoteResponse(data, { departmentName, total: data.length });
  },
  async createBudgetAdjustment(departmentName, input) {
    const data = await requestRemote<BudgetAdjustmentResult>(`/budgets/${encodeURIComponent(departmentName)}/adjustments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { departmentName, requiresApproval: data.requiresApproval });
  },
  async updateBudgetAdjustment(departmentName, adjustmentId, action, input = {}) {
    const data = await requestRemote<BudgetAdjustmentActionResult>(`/budgets/${encodeURIComponent(departmentName)}/adjustments/${encodeURIComponent(adjustmentId)}/${encodeURIComponent(action)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { departmentName, adjustmentId, action });
  },
  async downloadReport(reportName, format) {
    const params = new URLSearchParams({ format });
    const data = await requestRemote<ReportDownload>(`/reports/${encodeURIComponent(reportName)}/download?${params.toString()}`);
    return remoteResponse(data, { reportName, format });
  },
  async listReportSchedules() {
    const data = await requestRemote<ReportScheduleDto[]>("/reports/schedules");
    return remoteResponse(data, { total: data.length });
  },
  async createReportSchedule(input) {
    const data = await requestRemote<ReportScheduleDto>("/reports/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { created: true });
  },
  async updateReportSchedule(scheduleId, patch) {
    const data = await requestRemote<ReportScheduleDto | null>(`/reports/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return remoteResponse(data, { scheduleId, found: Boolean(data) });
  },
  async deleteReportSchedule(scheduleId, input = {}) {
    const data = await requestRemote<ReportScheduleDto | null>(`/reports/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { scheduleId, deleted: Boolean(data) });
  },
  async exportDisbursementBankTransfer(query = {}) {
    const data = await requestRemote<BankTransferExport>(`/disbursements/bank-transfer-export${toQueryString(query)}`);
    return remoteResponse(data, { targetCount: data.summary.targetCount, totalAmount: data.summary.totalAmount });
  },
  async reconcileDisbursementBankResults(input) {
    const data = await requestRemote<BankResultReconcileSummary>("/disbursements/bank-result-reconcile", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { targetCount: data.targetCount, totalAmount: data.totalAmount });
  },
  async presignFileUpload(input) {
    const data = await requestRemote<FileUploadTicket>("/files/presign-upload", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { fileId: data.file.id });
  },
  async uploadFileContent(uploadUrl, file, onProgress) {
    const data = await uploadRemoteFileContent<FileDto>(uploadUrl, file, onProgress);
    return remoteResponse(data, { fileId: data.id });
  },
  async completeFileUpload(fileId, input = {}) {
    const data = await requestRemote<FileDto>("/files/complete", {
      method: "POST",
      body: JSON.stringify({ fileId, ...input }),
    });
    return remoteResponse(data, { fileId });
  },
  async listFiles(ownerType, ownerId) {
    const params = new URLSearchParams({ ownerType, ownerId });
    const data = await requestRemote<FileDto[]>(`/files?${params.toString()}`);
    return remoteResponse(data, { ownerType, ownerId, total: data.length });
  },
  async getFileDownload(fileId, input) {
    const params = new URLSearchParams({ reason: input.reason });
    const data = await requestRemote<FileDownloadTicket>(`/files/${encodeURIComponent(fileId)}/download?${params.toString()}`);
    return remoteResponse({ ...data, download: { ...data.download, url: normalizeApiUrl(data.download.url) } }, { fileId, downloadReasonLogged: true });
  },
  async deleteFile(fileId, input = {}) {
    const data = await requestRemote<FileDto | null>(`/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { fileId, deleted: Boolean(data) });
  },
  async listRoleSettings() {
    const data = await requestRemote<RoleSettingsDto[]>("/settings/roles");
    return remoteResponse(data);
  },
  async createRoleSettings(input) {
    const data = await requestRemote<RoleSettingsDto>("/settings/roles", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { created: true });
  },
  async updateRoleSettings(roleId, patch) {
    const payload = await requestRemoteEnvelope<RoleSettingsDto | null>(`/settings/roles/${encodeURIComponent(roleId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return remoteResponse(payload.data, { ...primitiveApiMeta(payload.meta), roleId, found: Boolean(payload.data) });
  },
  async deleteRoleSettings(roleId, input) {
    const data = await requestRemote<RoleSettingsDto | null>(`/settings/roles/${encodeURIComponent(roleId)}`, {
      method: "DELETE",
      body: JSON.stringify(input ?? {}),
    });
    return remoteResponse(data, { roleId, deleted: Boolean(data) });
  },
  async getSystemSettings() {
    const data = await requestRemote<SystemSettingsSnapshot>("/settings/config");
    return remoteResponse(data);
  },
  async listSystemSettingHistory() {
    const data = await requestRemote<SystemSettingHistoryRow[]>("/settings/history");
    return remoteResponse(data, { total: data.length });
  },
  async listAuditLogs(query = {}) {
    const data = await requestRemote<AuditLogSearchResult>(`/operations/audit-logs${toQueryString(query)}`);
    return remoteResponse(data, { total: data.total, page: data.page, pageSize: data.pageSize });
  },
  async getOperationMode() {
    const data = await requestRemote<OperationModeStatus>("/operations/mode");
    return remoteResponse(data, { mode: data.mode, active: data.active });
  },
  async getOperationalAlerts() {
    const data = await requestRemote<OperationalAlertSummary>("/operations/alerts");
    return remoteResponse(data, { ok: data.ok, triggered: data.triggered.length });
  },
  async getBusinessFailureAlerts() {
    const data = await requestRemote<BusinessFailureAlertSummary>("/operations/business-failure-alerts");
    return remoteResponse(data, { ok: data.ok, triggered: data.triggered.length });
  },
  async getReportJobStatus() {
    const data = await requestRemote<ReportJobRunResult>("/operations/report-jobs");
    return remoteResponse(data, { ok: data.ok, due: data.summary.due, circuitOpen: data.circuitBreaker.open });
  },
  async runReportJobs(input = {}) {
    const data = await requestRemote<ReportJobRunResult>("/operations/report-jobs/run", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { ok: data.ok, processed: data.summary.processed, delivered: data.summary.delivered });
  },
  async getPerformancePolicy() {
    const data = await requestRemote<PerformancePolicyStatus>("/operations/performance-policy");
    return remoteResponse(data, { ok: data.ok, p95TargetMs: data.latency.p95TargetMs, maxReportRows: data.largeDownload.maxReportRows });
  },
  async saveSystemSetting(key, value, input = {}) {
    const payload = await requestRemoteEnvelope<unknown>(`/settings/config/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ value, ...input }),
    });
    return remoteResponse(payload.data, {
      key,
      saved: true,
      ...(payload.meta?.auditLogId ? { auditLogId: payload.meta.auditLogId } : {}),
      ...(payload.meta?.idempotencyReplay ? { idempotencyReplay: true } : {}),
    });
  },
  async testIntegrationSetting(integrationId, input = {}) {
    const data = await requestRemote<IntegrationTestResult>(`/settings/integrations/${encodeURIComponent(integrationId)}/test`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { integrationId, success: data.success });
  },
  async getRetentionPolicySummary() {
    const data = await requestRemote<RetentionPolicySummary>("/operations/retention-policy");
    return remoteResponse(data, { actionRequired: data.actionRequired, triggeredChecks: data.summary.triggeredChecks });
  },
  async getAccountLifecycleSummary() {
    const data = await requestRemote<AccountLifecycleSummary>("/operations/account-lifecycle");
    return remoteResponse(data, { actionRequired: data.actionRequired, totalCandidates: data.summary.totalCandidates });
  },
  async deactivateAccountLifecycle(input) {
    const data = await requestRemote<AccountLifecycleDeactivateResult>("/operations/account-lifecycle/deactivate", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { deactivatedCount: data.deactivatedCount, sessionsRevoked: data.sessionsRevoked });
  },
  async getFinancialReconciliationSummary() {
    const data = await requestRemote<FinancialReconciliationSummary>("/operations/financial-reconciliation");
    return remoteResponse(data, { actionRequired: data.actionRequired, mismatchCount: data.summary.mismatchCount });
  },
  async notifyFinancialReconciliation() {
    const data = await requestRemote<FinancialReconciliationNotifyResult>("/operations/financial-reconciliation/notify", {
      method: "POST",
      body: JSON.stringify({}),
    });
    return remoteResponse(data, { recipientCount: data.recipientCount, notificationsCreated: data.notificationsCreated });
  },
  async listManualRecoveries() {
    const data = await requestRemote<ManualRecoverySummary>("/operations/manual-recoveries");
    return remoteResponse(data, { pending: data.summary.pending });
  },
  async requestManualRecovery(input) {
    const data = await requestRemote<ManualRecoveryResult>("/operations/manual-recoveries", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { recoveryId: data.recoveryId, idempotencyReplay: data.idempotencyReplay });
  },
  async approveManualRecovery(recoveryId, input) {
    const data = await requestRemote<ManualRecoveryResult>(`/operations/manual-recoveries/${encodeURIComponent(recoveryId)}/approve`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { recoveryId: data.recoveryId, idempotencyReplay: data.idempotencyReplay });
  },
  async rejectManualRecovery(recoveryId, input) {
    const data = await requestRemote<ManualRecoveryResult>(`/operations/manual-recoveries/${encodeURIComponent(recoveryId)}/reject`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return remoteResponse(data, { recoveryId: data.recoveryId, idempotencyReplay: data.idempotencyReplay });
  },
  async getFinancialControlReport() {
    const data = await requestRemote<FinancialControlReport>("/operations/financial-control-report");
    return remoteResponse(data, { ok: data.ok, exceptions: data.summary.exceptions });
  },
};

let mockServicePromise: Promise<ErpApiService> | null = null;

async function getActiveService() {
  if (import.meta.env.VITE_ERP_API_MODE === "remote") return remoteService;
  mockServicePromise ??= import("./mockService").then((module) => module.createMockService());
  return mockServicePromise;
}

type ServiceMethod<Key extends keyof ErpApiService> = ErpApiService[Key] extends (...args: infer Args) => infer Result ? (...args: Args) => Result : never;

function callService<Key extends keyof ErpApiService>(
  method: Key,
  ...args: Parameters<ServiceMethod<Key>>
): ReturnType<ServiceMethod<Key>> {
  return getActiveService().then((service) => {
    const serviceMethod = service[method] as (...methodArgs: Parameters<ServiceMethod<Key>>) => ReturnType<ServiceMethod<Key>>;
    return serviceMethod(...args);
  }) as ReturnType<ServiceMethod<Key>>;
}

export const erpApi: ErpApiService = {
  getCurrentUser: () => callService("getCurrentUser"),
  login: (input) => callService("login", input),
  logout: () => callService("logout"),
  getPasswordPolicy: () => callService("getPasswordPolicy"),
  changePassword: (input) => callService("changePassword", input),
  changeExpiredPassword: (input) => callService("changeExpiredPassword", input),
  listNotifications: () => callService("listNotifications"),
  markNotificationRead: (notificationId) => callService("markNotificationRead", notificationId),
  markAllNotificationsRead: () => callService("markAllNotificationsRead"),
  getPaymentRequestMasterData: () => callService("getPaymentRequestMasterData"),
  listPageRows: (pageKey, query) => callService("listPageRows", pageKey, query),
  getPageRow: (pageKey, rowId) => callService("getPageRow", pageKey, rowId),
  createPageRow: (pageKey, row) => callService("createPageRow", pageKey, row),
  updatePageRow: (pageKey, rowId, patch) => callService("updatePageRow", pageKey, rowId, patch),
  deletePageRow: (pageKey, rowId, input) => callService("deletePageRow", pageKey, rowId, input),
  executePageAction: (pageKey, rowId, action, input) => callService("executePageAction", pageKey, rowId, action, input),
  listBudgetAdjustments: (departmentName) => callService("listBudgetAdjustments", departmentName),
  createBudgetAdjustment: (departmentName, input) => callService("createBudgetAdjustment", departmentName, input),
  updateBudgetAdjustment: (departmentName, adjustmentId, action, input) => callService("updateBudgetAdjustment", departmentName, adjustmentId, action, input),
  downloadReport: (reportName, format) => callService("downloadReport", reportName, format),
  listReportSchedules: () => callService("listReportSchedules"),
  createReportSchedule: (input) => callService("createReportSchedule", input),
  updateReportSchedule: (scheduleId, patch) => callService("updateReportSchedule", scheduleId, patch),
  deleteReportSchedule: (scheduleId, input) => callService("deleteReportSchedule", scheduleId, input),
  exportDisbursementBankTransfer: (query) => callService("exportDisbursementBankTransfer", query),
  reconcileDisbursementBankResults: (input) => callService("reconcileDisbursementBankResults", input),
  presignFileUpload: (input) => callService("presignFileUpload", input),
  uploadFileContent: (uploadUrl, file, onProgress) => callService("uploadFileContent", uploadUrl, file, onProgress),
  completeFileUpload: (fileId, input) => callService("completeFileUpload", fileId, input),
  listFiles: (ownerType, ownerId) => callService("listFiles", ownerType, ownerId),
  getFileDownload: (fileId, input) => callService("getFileDownload", fileId, input),
  deleteFile: (fileId, input) => callService("deleteFile", fileId, input),
  listRoleSettings: () => callService("listRoleSettings"),
  createRoleSettings: (input) => callService("createRoleSettings", input),
  updateRoleSettings: (roleId, patch) => callService("updateRoleSettings", roleId, patch),
  deleteRoleSettings: (roleId, input) => callService("deleteRoleSettings", roleId, input),
  getSystemSettings: () => callService("getSystemSettings"),
  listSystemSettingHistory: () => callService("listSystemSettingHistory"),
  listAuditLogs: (query) => callService("listAuditLogs", query),
  getOperationMode: () => callService("getOperationMode"),
  getOperationalAlerts: () => callService("getOperationalAlerts"),
  getBusinessFailureAlerts: () => callService("getBusinessFailureAlerts"),
  getReportJobStatus: () => callService("getReportJobStatus"),
  runReportJobs: (input) => callService("runReportJobs", input),
  getPerformancePolicy: () => callService("getPerformancePolicy"),
  saveSystemSetting: (key, value, input) => callService("saveSystemSetting", key, value, input),
  testIntegrationSetting: (integrationId, input) => callService("testIntegrationSetting", integrationId, input),
  getRetentionPolicySummary: () => callService("getRetentionPolicySummary"),
  getAccountLifecycleSummary: () => callService("getAccountLifecycleSummary"),
  deactivateAccountLifecycle: (input) => callService("deactivateAccountLifecycle", input),
  getFinancialReconciliationSummary: () => callService("getFinancialReconciliationSummary"),
  notifyFinancialReconciliation: () => callService("notifyFinancialReconciliation"),
  listManualRecoveries: () => callService("listManualRecoveries"),
  requestManualRecovery: (input) => callService("requestManualRecovery", input),
  approveManualRecovery: (recoveryId, input) => callService("approveManualRecovery", recoveryId, input),
  rejectManualRecovery: (recoveryId, input) => callService("rejectManualRecovery", recoveryId, input),
  getFinancialControlReport: () => callService("getFinancialControlReport"),
};
