import { createPageRow, deletePageRow as deleteMockPageRow, executePageAction as executeMockPageAction, getPageRow, listPageRows, updatePageRow } from "./mockApi";
import { budgetRows, disbursementRows, mockCurrentUser, notificationRows, reportRows, settingsRows, vendorRows } from "../mockData";
import type { ListQuery, MockApiResponse, TableRow } from "../types";
import type {
  BudgetAdjustmentInput,
  BudgetAdjustmentResult,
  BankResultReconcileSummary,
  BankTransferExport,
  ErpApiService,
  FileDto,
  IntegrationTestInput,
  IntegrationTestResult,
  ReportDownload,
  ReportDownloadFormat,
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
    async downloadReport(reportName, format) {
      const rowResponse = await getPageRow("reports", reportName);
      const report = rowResponse.data ?? reportRows.find((row) => row.보고서명 === reportName) ?? reportRows[0];
      if (!report) throw new Error("NOT_FOUND: 보고서를 찾을 수 없습니다.");
      const data = buildMockReportDownload(report, format);
      return respond(data, { mode: "mock", reportName, format });
    },
    async listReportSchedules() {
      if (mockReportScheduleStore.size === 0) {
        [
          toMockReportSchedule({ reportName: "월간 종합 보고서", reportType: "종합", cycle: "매월 1일", time: "09:00", format: "PDF", recipients: ["재무팀", "경영진"] }),
          toMockReportSchedule({ reportName: "승인 현황 보고서", reportType: "승인", cycle: "매주 월요일", time: "09:00", format: "PDF", recipients: ["부서장"], isActive: true }),
          toMockReportSchedule({ reportName: "예산 대비 보고서", reportType: "예산", cycle: "매월 말일", time: "17:00", format: "CSV", recipients: ["경영진"], isActive: false }),
        ].forEach((schedule) => mockReportScheduleStore.set(schedule.id, schedule));
      }
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
    async uploadFileContent(uploadUrl, file) {
      const fileId = uploadUrl.replace("mock-upload:", "");
      const current = mockFileStore.get(fileId);
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
    async getFileDownload(fileId) {
      const file = mockFileStore.get(fileId);
      if (!file) throw new Error("NOT_FOUND: 파일 정보를 찾을 수 없습니다.");
      return respond({ file, download: { url: `mock-download:${fileId}`, expiresAt: new Date(Date.now() + 600_000).toISOString() } }, { mode: "mock" });
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
  };
}
