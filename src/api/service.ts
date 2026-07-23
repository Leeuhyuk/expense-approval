import type { ApiResponse, AuthUserDto, LoginRequestDto, NotificationDto, ReleaseIdentityDto } from "./contracts";
import { errorFromApiResponse } from "./errors";
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

export type FileCompleteInput = {
  checksum?: string;
  idempotencyKey?: string;
};

export type FileDeleteInput = {
  idempotencyKey?: string;
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
  getCurrentUser(): Promise<MockApiResponse<AuthUser | null>>;
  login(input: LoginRequestDto): Promise<MockApiResponse<AuthUser>>;
  logout(): Promise<MockApiResponse<{ ok: true }>>;
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
  downloadReport(reportName: string, format: ReportDownloadFormat): Promise<MockApiResponse<ReportDownload>>;
  listReportSchedules(): Promise<MockApiResponse<ReportScheduleDto[]>>;
  createReportSchedule(input: ReportScheduleInput): Promise<MockApiResponse<ReportScheduleDto>>;
  updateReportSchedule(scheduleId: string, patch: Partial<ReportScheduleInput>): Promise<MockApiResponse<ReportScheduleDto | null>>;
  deleteReportSchedule(scheduleId: string, input?: { rowVersion?: number; idempotencyKey?: string }): Promise<MockApiResponse<ReportScheduleDto | null>>;
  exportDisbursementBankTransfer(query?: ListQuery): Promise<MockApiResponse<BankTransferExport>>;
  reconcileDisbursementBankResults(input: { idempotencyKey: string; rows: BankResultReconcileRow[] }): Promise<MockApiResponse<BankResultReconcileSummary>>;
  presignFileUpload(input: FileUploadInput): Promise<MockApiResponse<FileUploadTicket>>;
  uploadFileContent(uploadUrl: string, file: File): Promise<MockApiResponse<FileDto>>;
  completeFileUpload(fileId: string, input?: FileCompleteInput): Promise<MockApiResponse<FileDto>>;
  listFiles(ownerType: FileOwnerType, ownerId: string): Promise<MockApiResponse<FileDto[]>>;
  getFileDownload(fileId: string): Promise<MockApiResponse<FileDownloadTicket>>;
  deleteFile(fileId: string, input?: FileDeleteInput): Promise<MockApiResponse<FileDto | null>>;
  listRoleSettings(): Promise<MockApiResponse<RoleSettingsDto[]>>;
  createRoleSettings(input: RoleSettingsInput): Promise<MockApiResponse<RoleSettingsDto>>;
  updateRoleSettings(roleId: string, patch: Partial<RoleSettingsInput>): Promise<MockApiResponse<RoleSettingsDto | null>>;
  deleteRoleSettings(roleId: string, input?: RoleSettingsDeleteInput): Promise<MockApiResponse<RoleSettingsDto | null>>;
  getSystemSettings(): Promise<MockApiResponse<SystemSettingsSnapshot>>;
  listSystemSettingHistory(): Promise<MockApiResponse<SystemSettingHistoryRow[]>>;
  saveSystemSetting(key: SystemSettingKey, value: unknown, input?: SystemSettingSaveInput): Promise<MockApiResponse<unknown>>;
  testIntegrationSetting(integrationId: string, input?: IntegrationTestInput): Promise<MockApiResponse<IntegrationTestResult>>;
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

function toQueryString(query: ListQuery = {}) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.sort) params.set("sort", query.sort);
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
  // body 없는 요청에 JSON content-type을 붙이면 서버 JSON 파서가 빈 본문을 거부한다.
  if (!headers.has("Content-Type") && init?.body != null) headers.set("Content-Type", "application/json");
  const method = init?.method?.toUpperCase() ?? "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = getCookieValue("erp_csrf");
    if (token && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", decodeURIComponent(token));
  }
  return headers;
}

async function requestRemoteEnvelope<T>(path: string, init?: RequestInit): Promise<Extract<ApiResponse<T>, { status: "success" }>> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...(init ?? {}),
    credentials: "include",
    headers: addDefaultRemoteHeaders(init),
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw errorFromApiResponse(payload);
  }
  return payload;
}

async function requestRemote<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await requestRemoteEnvelope<T>(path, init);
  return payload.data;
}

async function requestRemoteUrl<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(normalizeApiUrl(url), {
    credentials: "include",
    ...(init ?? {}),
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw errorFromApiResponse(payload);
  }
  return payload.data;
}

function remoteResponse<T>(data: T, meta?: MockApiResponse<T>["meta"]): MockApiResponse<T> {
  return { ok: true, data, meta };
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
    const data = await requestRemote<TableRow | null>(`${resourcePathByPage[pageKey]}/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return remoteResponse(data, { pageKey, rowId, found: Boolean(data) });
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
  async uploadFileContent(uploadUrl, file) {
    const data = await requestRemoteUrl<FileDto>(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
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
  async getFileDownload(fileId) {
    const data = await requestRemote<FileDownloadTicket>(`/files/${encodeURIComponent(fileId)}/download`);
    return remoteResponse({ ...data, download: { ...data.download, url: normalizeApiUrl(data.download.url) } }, { fileId });
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
    const data = await requestRemote<RoleSettingsDto | null>(`/settings/roles/${encodeURIComponent(roleId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return remoteResponse(data, { roleId, found: Boolean(data) });
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
  downloadReport: (reportName, format) => callService("downloadReport", reportName, format),
  listReportSchedules: () => callService("listReportSchedules"),
  createReportSchedule: (input) => callService("createReportSchedule", input),
  updateReportSchedule: (scheduleId, patch) => callService("updateReportSchedule", scheduleId, patch),
  deleteReportSchedule: (scheduleId, input) => callService("deleteReportSchedule", scheduleId, input),
  exportDisbursementBankTransfer: (query) => callService("exportDisbursementBankTransfer", query),
  reconcileDisbursementBankResults: (input) => callService("reconcileDisbursementBankResults", input),
  presignFileUpload: (input) => callService("presignFileUpload", input),
  uploadFileContent: (uploadUrl, file) => callService("uploadFileContent", uploadUrl, file),
  completeFileUpload: (fileId, input) => callService("completeFileUpload", fileId, input),
  listFiles: (ownerType, ownerId) => callService("listFiles", ownerType, ownerId),
  getFileDownload: (fileId) => callService("getFileDownload", fileId),
  deleteFile: (fileId, input) => callService("deleteFile", fileId, input),
  listRoleSettings: () => callService("listRoleSettings"),
  createRoleSettings: (input) => callService("createRoleSettings", input),
  updateRoleSettings: (roleId, patch) => callService("updateRoleSettings", roleId, patch),
  deleteRoleSettings: (roleId, input) => callService("deleteRoleSettings", roleId, input),
  getSystemSettings: () => callService("getSystemSettings"),
  listSystemSettingHistory: () => callService("listSystemSettingHistory"),
  saveSystemSetting: (key, value, input) => callService("saveSystemSetting", key, value, input),
  testIntegrationSetting: (integrationId, input) => callService("testIntegrationSetting", integrationId, input),
};
