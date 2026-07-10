import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AccountVerificationStatus, BudgetAdjustmentStatus, BudgetStatus, DisbursementStatus, FavoriteKind, NotificationType, PaymentRequestStatus, ReportRunStatus, ReportScheduleFrequency, ReportType, VendorStatus, type Prisma } from "../../generated/prisma/index.js";
import { z } from "zod";
import { hasPermission, requireAuth, type AuthUser } from "../auth/session.js";
import { validateBudgetAdjustmentFinancialClose } from "../controls/financialClose.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { reportDownloadLimitIssue } from "../operations/performancePolicy.js";
import { readStoredFile, writeStoredFile } from "../storage/attachmentStorage.js";
import { encryptBankAccount, maskBankAccount } from "../security/bankAccountCrypto.js";
import { fail, success } from "../utils/response.js";
import { addDays, auditRequestContext, definedCookies, filterAndSortRows, formatDate, formatWon, jsonRow, paginateRows, parseWon, readListFilters, readStringPatch, type ListQuery, type TableRow } from "./rowUtils.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  sort: z.string().optional(),
});

function pageQuery(request: FastifyRequest): ListQuery {
  const parsed = listQuerySchema.parse(request.query);
  return {
    ...parsed,
    filters: readListFilters(request.query),
  };
}

function rowsResponse(request: FastifyRequest, rows: TableRow[]) {
  const query = pageQuery(request);
  return success(request, paginateRows(filterAndSortRows(rows, query), query));
}

function can(user: AuthUser, permission: string) {
  return hasPermission(user, permission) || hasPermission(user, "system:manage");
}

function displayBudgetStatus(status: BudgetStatus) {
  const map: Record<BudgetStatus, string> = {
    NORMAL: "정상",
    WARNING: "주의",
    EXCEEDED: "초과",
    CLOSED: "마감",
  };
  return map[status];
}

function toBudgetStatus(value: string) {
  const map: Record<string, BudgetStatus> = {
    정상: BudgetStatus.NORMAL,
    주의: BudgetStatus.WARNING,
    초과: BudgetStatus.EXCEEDED,
    마감: BudgetStatus.CLOSED,
  };
  return map[value];
}

function displayBudgetAdjustmentStatus(status: BudgetAdjustmentStatus) {
  const map: Record<BudgetAdjustmentStatus, string> = {
    PENDING_APPROVAL: "승인 대기",
    APPLIED: "즉시 반영",
    REJECTED: "반려",
    CANCELLED: "취소",
  };
  return map[status];
}

function budgetStatusFor(allocatedAmount: unknown, usedAmount: unknown) {
  const allocated = Number(allocatedAmount);
  const used = Number(usedAmount);
  if (allocated > 0 && used > allocated) return BudgetStatus.EXCEEDED;
  if (allocated > 0 && used / allocated >= 0.9) return BudgetStatus.WARNING;
  return BudgetStatus.NORMAL;
}

function displayAccountStatus(status: AccountVerificationStatus) {
  const map: Record<AccountVerificationStatus, string> = {
    VERIFIED: "확인 완료",
    PENDING: "검증 대기",
    MISMATCH: "계좌 불일치",
    INACTIVE: "비활성",
  };
  return map[status];
}

function toAccountStatus(value: string) {
  const map: Record<string, AccountVerificationStatus> = {
    "확인 완료": AccountVerificationStatus.VERIFIED,
    "검증 대기": AccountVerificationStatus.PENDING,
    "확인 대기": AccountVerificationStatus.PENDING,
    "계좌 불일치": AccountVerificationStatus.MISMATCH,
    비활성: AccountVerificationStatus.INACTIVE,
  };
  return map[value];
}

function displayVendorStatus(status: VendorStatus, isActive: boolean) {
  if (!isActive) return "비활성";
  const map: Record<VendorStatus, string> = {
    ACTIVE: "활성",
    INACTIVE: "비활성",
    BLOCKED: "차단",
  };
  return map[status];
}

function toVendorStatus(value: string) {
  const map: Record<string, VendorStatus> = {
    활성: VendorStatus.ACTIVE,
    비활성: VendorStatus.INACTIVE,
    차단: VendorStatus.BLOCKED,
  };
  return map[value];
}

function displayReportType(type: ReportType) {
  const map: Record<ReportType, string> = {
    COMPREHENSIVE: "종합",
    DISBURSEMENT: "지급",
    APPROVAL: "승인",
    BUDGET: "예산",
    VENDOR: "거래처",
  };
  return map[type];
}

function toReportType(value: string) {
  const map: Record<string, ReportType> = {
    종합: ReportType.COMPREHENSIVE,
    지급: ReportType.DISBURSEMENT,
    승인: ReportType.APPROVAL,
    예산: ReportType.BUDGET,
    거래처: ReportType.VENDOR,
  };
  return map[value] ?? ReportType.COMPREHENSIVE;
}

function displayFavoriteKind(kind: FavoriteKind) {
  const map: Record<FavoriteKind, string> = {
    MENU: "메뉴",
    FILTER: "필터",
    REPORT: "보고서",
    SHORTCUT: "바로가기",
  };
  return map[kind];
}

function toFavoriteKind(value: string) {
  const map: Record<string, FavoriteKind> = {
    메뉴: FavoriteKind.MENU,
    필터: FavoriteKind.FILTER,
    보고서: FavoriteKind.REPORT,
    바로가기: FavoriteKind.SHORTCUT,
  };
  return map[value] ?? FavoriteKind.SHORTCUT;
}

function firstBankPart(value: string) {
  return value.trim().split(/\s+/)[0] || "미지정";
}

function accountNumberPart(value: string) {
  const parts = value.trim().split(/\s+/);
  return parts.slice(1).join(" ");
}

function maskedAccountPart(value: string) {
  return maskBankAccount(accountNumberPart(value));
}

export function validateVendorBusinessNumber(value: string) {
  return /^\d{3}-\d{2}-\d{5}$/.test(value.trim());
}

export function validateVendorBankAccount(value: string) {
  return /^[0-9-]{6,30}$/.test(value.trim());
}

export function validateVendorTaxInvoiceEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function validateVendorTaxIssueType(value: string) {
  return ["이메일 발행", "전자세금계산서 연동", "수기 확인"].includes(value.trim());
}

function validateVendorRow(row: TableRow, mode: "create" | "update") {
  if (mode === "create" && !row.담당자?.trim()) return "거래처 담당자가 필요합니다.";
  if (row.사업자번호 && !validateVendorBusinessNumber(row.사업자번호)) return "사업자번호는 000-00-00000 형식이어야 합니다.";
  if (row.은행) {
    const account = accountNumberPart(row.은행);
    if (!account || !validateVendorBankAccount(account)) return "계좌번호는 숫자와 하이픈 6~30자로 입력해야 합니다.";
  }
  if (mode === "create" && !row["세금계산서 이메일"]?.trim()) return "세금계산서 수신 이메일이 필요합니다.";
  if (row["세금계산서 이메일"] && !validateVendorTaxInvoiceEmail(row["세금계산서 이메일"])) return "유효한 세금계산서 수신 이메일이 필요합니다.";
  if (row["세금계산서 발행"] && !validateVendorTaxIssueType(row["세금계산서 발행"])) return "지원하지 않는 세금계산서 발행 방식입니다.";
  return "";
}

const budgetRowInclude = {
  department: true,
  items: true,
} satisfies Prisma.BudgetInclude;

type BudgetWithDepartment = Prisma.BudgetGetPayload<{
  include: typeof budgetRowInclude;
}>;

type BudgetAdjustmentWithBudget = Prisma.BudgetAdjustmentGetPayload<{
  include: {
    budget: {
      include: {
        department: true;
      };
    };
    requester: true;
  };
}>;

function toBudgetRow(item: BudgetWithDepartment): TableRow {
  const allocated = Number(item.allocatedAmount);
  const used = Number(item.usedAmount);
  const remaining = allocated - used;
  const usageRate = allocated > 0 ? Math.round((used / allocated) * 100) : 0;
  return {
    예산ID: item.id,
    부서: item.department.name,
    회계연도: item.fiscalYear,
    기간: `${item.fiscalYear}-01-01 ~ ${item.fiscalYear}-12-31`,
    예산항목: item.items.map((budgetItem) => budgetItem.name).join(", ") || "미등록",
    예산항목수: String(item.items.length),
    "배정 예산": formatWon(allocated),
    "사용 금액": formatWon(used),
    사용률: `${usageRate}%`,
    잔액: formatWon(remaining),
    상태: displayBudgetStatus(item.status),
    rowVersion: String(item.rowVersion),
    예산RowVersion: String(item.rowVersion),
  };
}

function toBudgetAdjustmentRow(item: BudgetAdjustmentWithBudget): TableRow {
  const canVoid = item.status === BudgetAdjustmentStatus.PENDING_APPROVAL;
  const ledgerPolicy = item.status === BudgetAdjustmentStatus.APPLIED
    ? "이미 원장 반영됨 · 취소/반려 대신 반대 조정 또는 보정 전표 필요"
    : item.status === BudgetAdjustmentStatus.PENDING_APPROVAL
      ? "원장 미반영 · 취소/반려 시 예산 원장 변경 없음"
      : "원장 미반영 종료 상태 · 추가 원장 rollback 없음";
  return {
    조정ID: item.id,
    예산ID: item.budgetId,
    부서: item.budget.department.name,
    조정금액: formatWon(item.amount),
    조정사유: item.reason,
    승인필요: item.requiresApproval ? "필요" : "불필요",
    상태: displayBudgetAdjustmentStatus(item.status),
    취소가능: canVoid ? "가능" : "불가",
    반려가능: canVoid ? "가능" : "불가",
    원장반영방식: ledgerPolicy,
    요청자: item.requester.name,
    요청일시: item.createdAt.toISOString().slice(0, 16).replace("T", " "),
    적용일시: item.appliedAt ? item.appliedAt.toISOString().slice(0, 16).replace("T", " ") : "-",
  };
}

type VendorWithDisbursements = Prisma.VendorGetPayload<{
  include: {
    disbursements: true;
  };
}>;

function vendorBusinessType(vendorName: string) {
  if (vendorName.includes("(주)") || vendorName.includes("무역")) return "법인";
  if (vendorName.includes("오피스") || vendorName.includes("콘텐츠")) return "개인/소상공";
  return "일반";
}

function toVendorRow(item: VendorWithDisbursements): TableRow {
  const latest = item.disbursements.reduce<Date | null>((current, disbursement) => {
    if (!disbursement.executedAt) return current;
    return !current || disbursement.executedAt > current ? disbursement.executedAt : current;
  }, null);
  const totalPaid = item.disbursements
    .filter((disbursement) => disbursement.status === "COMPLETED")
    .reduce((sum, disbursement) => sum + Number(disbursement.amount), 0);

  return {
    거래처명: item.name,
    사업자번호: item.businessNumber,
    담당자: item.managerName,
    은행: `${item.bankName} ${item.bankAccountMasked}`,
    계좌확인: displayAccountStatus(item.accountVerificationStatus),
    구분: vendorBusinessType(item.name),
    최근지급일: latest ? formatDate(latest) : "-",
    누적지급액: formatWon(totalPaid),
    상태: displayVendorStatus(item.status, item.isActive),
    "세금계산서 이메일": item.taxInvoiceEmail,
    "세금계산서 발행": item.taxInvoiceIssueType,
    rowVersion: String(item.rowVersion),
    거래처RowVersion: String(item.rowVersion),
  };
}

const vendorActivePaymentStatuses = [
  PaymentRequestStatus.DRAFT,
  PaymentRequestStatus.SUBMITTED,
  PaymentRequestStatus.APPROVAL_PENDING,
  PaymentRequestStatus.APPROVAL_IN_PROGRESS,
  PaymentRequestStatus.APPROVED,
  PaymentRequestStatus.HELD,
];

const vendorOpenDisbursementStatuses = [
  DisbursementStatus.SCHEDULED,
  DisbursementStatus.DUE_TODAY,
  DisbursementStatus.ERROR,
  DisbursementStatus.HELD,
];

type VendorDeactivationImpact = {
  activePaymentRequestCount: number;
  openDisbursementCount: number;
};

async function getVendorDeactivationImpact(tx: Prisma.TransactionClient, vendorId: string): Promise<VendorDeactivationImpact> {
  const [activePaymentRequestCount, openDisbursementCount] = await Promise.all([
    tx.paymentRequest.count({
      where: {
        vendorId,
        status: { in: vendorActivePaymentStatuses },
      },
    }),
    tx.disbursement.count({
      where: {
        vendorId,
        status: { in: vendorOpenDisbursementStatuses },
      },
    }),
  ]);
  return { activePaymentRequestCount, openDisbursementCount };
}

function withVendorDeactivationImpact(row: TableRow, impact: VendorDeactivationImpact): TableRow {
  return {
    ...row,
    비활성화영향요청: String(impact.activePaymentRequestCount),
    비활성화영향지급예약: String(impact.openDisbursementCount),
    비활성화영향요약: `진행 중 요청 ${impact.activePaymentRequestCount}건, 지급 예약/미완료 ${impact.openDisbursementCount}건`,
  };
}

type ReportRunWithCreator = Prisma.ReportRunGetPayload<{
  include: {
    creator: true;
  };
}>;

const reportAccessPattern = /\s*\[공유권한:([^\]]+)\]\s*$/;
const reportVendorPattern = /\s*\[거래처:([^\]]+)\]\s*$/;
const reportDepartmentPattern = /\s*\[부서:([^\]]+)\]\s*$/;
const reportDrilldownPattern = /\s*\[드릴다운:([^\]]+)\]\s*$/;

type ReportDrilldownSnapshot = {
  generatedAt: string;
  source: string;
  sections: Record<string, { columns: string[]; rows: TableRow[] }>;
};

function displayPaymentRequestStatus(status: PaymentRequestStatus) {
  const map: Record<PaymentRequestStatus, string> = {
    DRAFT: "임시 저장",
    SUBMITTED: "제출",
    APPROVAL_PENDING: "승인 대기",
    APPROVAL_IN_PROGRESS: "승인 진행 중",
    APPROVED: "승인 완료",
    REJECTED: "반려",
    HELD: "보류",
  };
  return map[status];
}

function displayDisbursementStatus(status: DisbursementStatus) {
  const map: Record<DisbursementStatus, string> = {
    SCHEDULED: "지급 예정",
    DUE_TODAY: "오늘 지급",
    COMPLETED: "지급 완료",
    ERROR: "오류",
    HELD: "보류",
  };
  return map[status];
}

function encodeReportDrilldownSnapshot(snapshot: ReportDrilldownSnapshot | undefined) {
  return snapshot ? encodeURIComponent(JSON.stringify(snapshot)) : "";
}

function decodeReportDrilldownSnapshot(value: string | undefined): ReportDrilldownSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const sections = (parsed as { sections?: unknown }).sections;
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) return null;
    return parsed as ReportDrilldownSnapshot;
  } catch {
    return null;
  }
}

function readReportSummaryMeta(summary: string | null | undefined) {
  const raw = summary ?? "";
  const accessMatch = raw.match(reportAccessPattern);
  const withoutAccess = accessMatch ? raw.replace(reportAccessPattern, "") : raw;
  const vendorMatch = withoutAccess.match(reportVendorPattern);
  const withoutVendor = vendorMatch ? withoutAccess.replace(reportVendorPattern, "") : withoutAccess;
  const departmentMatch = withoutVendor.match(reportDepartmentPattern);
  const withoutDepartment = departmentMatch ? withoutVendor.replace(reportDepartmentPattern, "") : withoutVendor;
  const drilldownMatch = withoutDepartment.match(reportDrilldownPattern);
  const withoutDrilldown = drilldownMatch ? withoutDepartment.replace(reportDrilldownPattern, "") : withoutDepartment;
  return {
    summary: withoutDrilldown.trim(),
    access: accessMatch?.[1]?.trim() || "부서 공유",
    department: departmentMatch?.[1]?.trim() || "",
    vendor: vendorMatch?.[1]?.trim() || "",
    drilldown: decodeReportDrilldownSnapshot(drilldownMatch?.[1]?.trim()),
  };
}

function reportMetaTag(label: "부서" | "거래처", value: string) {
  const trimmed = value.trim();
  return trimmed && !trimmed.startsWith("전체") ? ` [${label}:${trimmed}]` : "";
}

function writeReportSummaryMeta(
  summary: string | null | undefined,
  access: string | undefined,
  drilldown?: ReportDrilldownSnapshot | null,
  scope?: { department?: string; vendor?: string },
) {
  const current = readReportSummaryMeta(summary);
  const nextSummary = current.summary || "사용자 생성 보고서";
  const nextAccess = access?.trim() || current.access;
  const nextDrilldown = drilldown === undefined ? current.drilldown : drilldown;
  const nextDepartment = scope?.department ?? current.department;
  const nextVendor = scope?.vendor ?? current.vendor;
  const drilldownText = encodeReportDrilldownSnapshot(nextDrilldown ?? undefined);
  return `${nextSummary}${drilldownText ? ` [드릴다운:${drilldownText}]` : ""}${reportMetaTag("부서", nextDepartment)}${reportMetaTag("거래처", nextVendor)} [공유권한:${nextAccess}]`;
}

function toReportRow(item: ReportRunWithCreator): TableRow {
  const period = item.periodStart && item.periodEnd ? `${formatDate(item.periodStart)} ~ ${formatDate(item.periodEnd)}` : "-";
  const summaryMeta = readReportSummaryMeta(item.summary);
  return {
    보고서명: item.name,
    유형: displayReportType(item.type),
    기간: period,
    생성일시: item.createdAt.toISOString().slice(0, 16).replace("T", " "),
    생성자: item.creator.name,
    요약: summaryMeta.summary || `${item.rowCount}개 행`,
    부서: summaryMeta.department,
    거래처: summaryMeta.vendor,
    공유권한: summaryMeta.access,
    공유: summaryMeta.access,
    드릴다운JSON: summaryMeta.drilldown ? JSON.stringify(summaryMeta.drilldown) : "",
    rowVersion: String(item.rowVersion),
    보고서RowVersion: String(item.rowVersion),
  };
}

type ReportDownloadFormat = "csv" | "pdf";

const reportDownloadColumns = ["보고서명", "유형", "기간", "생성일시", "생성자", "요약"];

function parseReportDate(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return new Date(`${trimmed}T00:00:00.000Z`);
}

function parseReportPeriod(value: string | undefined) {
  const [start, end] = (value ?? "").split("~").map((part) => part.trim());
  return {
    periodStart: parseReportDate(start),
    periodEnd: parseReportDate(end),
  };
}

function readReportDownloadFormat(request: FastifyRequest): ReportDownloadFormat | null {
  const query = request.query && typeof request.query === "object" ? (request.query as { format?: unknown }) : {};
  if (query.format === undefined) return "csv";
  return query.format === "csv" || query.format === "pdf" ? query.format : null;
}

function safeReportFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
}

function escapeReportCsvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function createReportCsv(item: ReportRunWithCreator) {
  const row = toReportRow(item);
  const lines = [
    reportDownloadColumns.map(escapeReportCsvCell).join(","),
    reportDownloadColumns.map((column) => escapeReportCsvCell(row[column] ?? "")).join(","),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function toPdfSafeText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "?");
}

function escapeReportPdfText(value: string) {
  return toPdfSafeText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createReportPdf(item: ReportRunWithCreator) {
  const row = toReportRow(item);
  const lines = [
    "Payment Approval ERP Report",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Report: ${row.보고서명}`,
    `Type: ${row.유형}`,
    `Period: ${row.기간}`,
    `Creator: ${row.생성자}`,
    `Summary: ${row.요약}`,
  ];
  const content = lines
    .map((line, index) => `BT /F1 10 Tf 48 ${744 - index * 18} Td (${escapeReportPdfText(line)}) Tj ET`)
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

function buildReportDownload(item: ReportRunWithCreator, format: ReportDownloadFormat, generatedAt = new Date().toISOString()) {
  const extension = format === "pdf" ? "pdf" : "csv";
  const contentType = format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8";
  const content = format === "pdf" ? createReportPdf(item) : createReportCsv(item);
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");
  return {
    fileName: `${safeReportFileName(item.name)}-${generatedAt.replace(/\D/g, "").slice(0, 14)}.${extension}`,
    contentType,
    contentBase64,
    generatedAt,
    limits: {
      rowCount: item.rowCount,
      contentBytes: Buffer.byteLength(contentBase64, "utf8"),
    },
    report: toReportRow(item),
  };
}

type ReportDownloadPayload = ReturnType<typeof buildReportDownload>;

type StoredReportArtifact = {
  schemaVersion: 1;
  reportRunId: string;
  reportName: string;
  storedAt: string;
  files: Partial<Record<ReportDownloadFormat, ReportDownloadPayload>>;
};

function reportArtifactStorageKey(reportRunId: string) {
  return `reports/${reportRunId}.artifact.json`;
}

function isReportDownloadPayload(value: unknown): value is ReportDownloadPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ReportDownloadPayload>;
  return typeof candidate.fileName === "string"
    && typeof candidate.contentType === "string"
    && typeof candidate.contentBase64 === "string"
    && typeof candidate.generatedAt === "string";
}

function parseStoredReportArtifact(body: Buffer): StoredReportArtifact | null {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const artifact = parsed as Partial<StoredReportArtifact>;
    if (artifact.schemaVersion !== 1 || typeof artifact.reportRunId !== "string" || typeof artifact.storedAt !== "string") return null;
    if (!artifact.files || typeof artifact.files !== "object" || Array.isArray(artifact.files)) return null;
    return artifact as StoredReportArtifact;
  } catch {
    return null;
  }
}

async function writeReportArtifact(item: ReportRunWithCreator) {
  const artifactKey = reportArtifactStorageKey(item.id);
  const storedAt = new Date().toISOString();
  const artifact: StoredReportArtifact = {
    schemaVersion: 1,
    reportRunId: item.id,
    reportName: item.name,
    storedAt,
    files: {
      csv: buildReportDownload(item, "csv", storedAt),
      pdf: buildReportDownload(item, "pdf", storedAt),
    },
  };
  const stored = await writeStoredFile(artifactKey, JSON.stringify(artifact), "application/json");
  return { artifactKey, storedAt, checksum: stored.checksum, byteSize: stored.byteSize };
}

async function ensureReportArtifact(item: ReportRunWithCreator) {
  if (item.artifactKey) return item;
  const artifact = await writeReportArtifact(item);
  return prisma.reportRun.update({
    where: { id: item.id },
    data: { artifactKey: artifact.artifactKey },
    include: { creator: true },
  });
}

async function readReportArtifactDownload(item: ReportRunWithCreator, format: ReportDownloadFormat) {
  if (!item.artifactKey) return null;
  const artifact = parseStoredReportArtifact(await readStoredFile(item.artifactKey));
  const file = artifact?.files[format];
  if (!artifact || !isReportDownloadPayload(file)) return null;
  return {
    ...file,
    limits: file.limits ?? {
      rowCount: item.rowCount,
      contentBytes: Buffer.byteLength(file.contentBase64, "utf8"),
    },
    report: file.report ?? toReportRow(item),
    artifact: {
      storageKey: item.artifactKey,
      storedAt: artifact.storedAt,
      source: "object-storage",
    },
  };
}

function reportFilterValue(row: TableRow, key: string, allPrefix: string) {
  const value = row[key]?.trim();
  return value && !value.startsWith(allPrefix) ? value : undefined;
}

async function buildReportDrilldownSnapshot(tx: Prisma.TransactionClient, row: TableRow): Promise<ReportDrilldownSnapshot> {
  const period = parseReportPeriod(row.기간);
  const departmentName = reportFilterValue(row, "부서", "전체");
  const vendorName = reportFilterValue(row, "거래처", "전체");
  const requestedAt = period.periodStart || period.periodEnd
    ? {
      ...(period.periodStart ? { gte: period.periodStart } : {}),
      ...(period.periodEnd ? { lte: period.periodEnd } : {}),
    }
    : undefined;
  const scheduledDate = period.periodStart || period.periodEnd
    ? {
      ...(period.periodStart ? { gte: period.periodStart } : {}),
      ...(period.periodEnd ? { lte: period.periodEnd } : {}),
    }
    : undefined;
  const paymentWhere: Prisma.PaymentRequestWhereInput = {
    ...(requestedAt ? { requestedAt } : {}),
    ...(departmentName ? { department: { name: departmentName } } : {}),
    ...(vendorName ? { vendor: { name: vendorName } } : {}),
  };
  const disbursementWhere: Prisma.DisbursementWhereInput = {
    ...(scheduledDate ? { scheduledDate } : {}),
    ...(vendorName ? { vendor: { name: vendorName } } : {}),
    ...(departmentName ? { paymentRequest: { department: { name: departmentName } } } : {}),
  };
  const [paymentRequests, disbursements] = await Promise.all([
    tx.paymentRequest.findMany({
      where: paymentWhere,
      include: { department: true, vendor: true, requester: true },
      orderBy: { requestedAt: "desc" },
      take: 40,
    }),
    tx.disbursement.findMany({
      where: disbursementWhere,
      include: {
        vendor: true,
        paymentRequest: {
          include: {
            department: true,
            requester: true,
          },
        },
      },
      orderBy: { scheduledDate: "desc" },
      take: 40,
    }),
  ]);
  const paymentRows = paymentRequests.map((item) => ({
    요청번호: item.requestCode,
    요청일: formatDate(item.requestedAt),
    부서: item.department.name,
    요청자: item.requester.name,
    거래처: item.vendor.name,
    금액: formatWon(item.amount),
    상태: displayPaymentRequestStatus(item.status),
    결재상태: displayPaymentRequestStatus(item.status),
  }));
  const disbursementRows = disbursements.map((item) => ({
    월: `${item.scheduledDate.getUTCMonth() + 1}월 지급 추이`,
    지급번호: item.disbursementCode,
    승인번호: item.paymentRequest.requestCode,
    지급예정일: formatDate(item.scheduledDate),
    부서: item.paymentRequest.department.name,
    담당자: item.paymentRequest.requester.name,
    거래처: item.vendor.name,
    금액: formatWon(item.amount),
    지급상태: displayDisbursementStatus(item.status),
  }));
  return {
    generatedAt: new Date().toISOString(),
    source: `ReportRun snapshot · ${row.보고서명 || "보고서"}`,
    sections: {
      monthly: {
        columns: ["월", "지급번호", "승인번호", "지급예정일", "부서", "거래처", "금액", "지급상태"],
        rows: disbursementRows,
      },
      department: {
        columns: ["요청번호", "요청일", "부서", "거래처", "금액", "상태"],
        rows: paymentRows,
      },
      approval: {
        columns: ["요청번호", "요청일", "부서", "요청자", "금액", "결재상태"],
        rows: paymentRows,
      },
    },
  };
}

type ReportScheduleWithDefinition = Prisma.ReportScheduleGetPayload<{
  include: {
    definition: true;
  };
}>;

type ReportScheduleDelivery = {
  recipients: string[];
  cycle: string;
  time: string;
  format: string;
};

type ReportScheduleInput = ReportScheduleDelivery & {
  reportName: string;
  reportType: string;
  isActive?: boolean;
};

function displayReportScheduleFrequency(frequency: ReportScheduleFrequency) {
  const map: Record<ReportScheduleFrequency, string> = {
    DAILY: "매일",
    WEEKLY: "매주",
    MONTHLY: "매월",
    QUARTERLY: "매분기",
  };
  return map[frequency];
}

function toReportScheduleFrequency(value: string) {
  if (value.includes("매일")) return ReportScheduleFrequency.DAILY;
  if (value.includes("매주")) return ReportScheduleFrequency.WEEKLY;
  if (value.includes("분기") || value.includes("분기별")) return ReportScheduleFrequency.QUARTERLY;
  return ReportScheduleFrequency.MONTHLY;
}

function normalizeReportScheduleRecipients(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function readReportScheduleInput(body: unknown, fallback: Partial<ReportScheduleInput> = {}): ReportScheduleInput {
  const source = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const recipients = normalizeReportScheduleRecipients(source.recipients ?? source.recipient ?? fallback.recipients ?? []);
  return {
    reportName: typeof source.reportName === "string" && source.reportName.trim() ? source.reportName.trim() : fallback.reportName ?? "월간 종합 보고서",
    reportType: typeof source.reportType === "string" && source.reportType.trim() ? source.reportType.trim() : fallback.reportType ?? "종합",
    recipients,
    cycle: typeof source.cycle === "string" && source.cycle.trim() ? source.cycle.trim() : fallback.cycle ?? "매월 1일",
    time: typeof source.time === "string" && /^\d{2}:\d{2}$/.test(source.time) ? source.time : fallback.time ?? "09:00",
    format: typeof source.format === "string" && source.format.trim() ? source.format.trim() : fallback.format ?? "PDF",
    isActive: typeof source.isActive === "boolean" ? source.isActive : fallback.isActive,
  };
}

function reportScheduleDeliveryFromJson(value: unknown): ReportScheduleDelivery {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const recipients = normalizeReportScheduleRecipients(source.recipients);
  return {
    recipients,
    cycle: typeof source.cycle === "string" && source.cycle.trim() ? source.cycle.trim() : "매월 1일",
    time: typeof source.time === "string" && /^\d{2}:\d{2}$/.test(source.time) ? source.time : "09:00",
    format: typeof source.format === "string" && source.format.trim() ? source.format.trim() : "PDF",
  };
}

function reportScheduleDeliveryJson(input: ReportScheduleInput): Prisma.InputJsonObject {
  return {
    recipients: input.recipients,
    cycle: input.cycle,
    time: input.time,
    format: input.format,
  };
}

function parseScheduleTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 9,
    minute: Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  };
}

function withScheduleTime(date: Date, time: string) {
  const { hour, minute } = parseScheduleTime(time);
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function nextReportScheduleRunAt(input: Pick<ReportScheduleInput, "cycle" | "time">, from = new Date()) {
  const frequency = toReportScheduleFrequency(input.cycle);
  let next = withScheduleTime(from, input.time);

  if (frequency === ReportScheduleFrequency.DAILY) {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  if (frequency === ReportScheduleFrequency.WEEKLY) {
    const weekdays: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
    const targetDay = Object.entries(weekdays).find(([label]) => input.cycle.includes(label))?.[1] ?? 5;
    const delta = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next <= from) next.setDate(next.getDate() + 7);
    return next;
  }

  if (frequency === ReportScheduleFrequency.QUARTERLY) {
    const currentQuarterStart = Math.floor(next.getMonth() / 3) * 3;
    next.setMonth(currentQuarterStart, 1);
    if (next <= from) next.setMonth(currentQuarterStart + 3, 1);
    return next;
  }

  const targetDay = input.cycle.includes("말") ? lastDayOfMonth(next.getFullYear(), next.getMonth()) : Number(input.cycle.match(/\d+/)?.[0] ?? 1);
  next.setDate(Math.min(Math.max(targetDay, 1), lastDayOfMonth(next.getFullYear(), next.getMonth())));
  if (next <= from) {
    next.setMonth(next.getMonth() + 1, 1);
    const nextTargetDay = input.cycle.includes("말") ? lastDayOfMonth(next.getFullYear(), next.getMonth()) : targetDay;
    next.setDate(Math.min(nextTargetDay, lastDayOfMonth(next.getFullYear(), next.getMonth())));
  }
  return next;
}

function toReportScheduleDto(item: ReportScheduleWithDefinition) {
  const delivery = reportScheduleDeliveryFromJson(item.recipients);
  return {
    id: item.id,
    title: `${item.definition.name} 예약`,
    reportName: item.definition.name,
    reportType: displayReportType(item.definition.type),
    frequency: displayReportScheduleFrequency(item.frequency),
    cycle: delivery.cycle,
    time: delivery.time,
    format: delivery.format,
    recipients: delivery.recipients,
    recipientLabel: delivery.recipients.join(", ") || "-",
    isActive: item.isActive,
    status: item.isActive ? "활성" : "중지",
    nextRunAt: item.nextRunAt?.toISOString() ?? "",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    rowVersion: item.rowVersion,
  };
}

function toReportScheduleAuditRow(item: ReportScheduleWithDefinition): TableRow {
  const dto = toReportScheduleDto(item);
  return {
    예약ID: dto.id,
    보고서명: dto.reportName,
    유형: dto.reportType,
    주기: dto.cycle,
    시간: dto.time,
    형식: dto.format,
    수신자: dto.recipientLabel,
    상태: dto.status,
    다음실행: dto.nextRunAt,
    rowVersion: String(dto.rowVersion),
  };
}

async function findOrCreateReportDefinition(tx: Prisma.TransactionClient, user: AuthUser, input: Pick<ReportScheduleInput, "reportName" | "reportType" | "cycle" | "format">) {
  const type = toReportType(input.reportType);
  const existing = await tx.reportDefinition.findFirst({
    where: {
      ownerId: user.id,
      name: input.reportName,
      type,
      isActive: true,
    },
  });
  if (existing) return existing;
  return tx.reportDefinition.create({
    data: {
      ownerId: user.id,
      name: input.reportName,
      type,
      description: "보고서 예약 발송 기준",
      filters: toInputJson({
        source: "reports-screen",
        cycle: input.cycle,
        format: input.format,
      }),
    },
  });
}

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    department: true;
    roles: {
      include: {
        role: true;
      };
    };
  };
}>;

function toSettingRow(item: UserWithRelations): TableRow {
  const activeRoles = item.roles.filter(({ role }) => role.isActive).map(({ role }) => role.name);
  const roleCodes = item.roles.filter(({ role }) => role.isActive).map(({ role }) => role.code);
  return {
    사용자: item.name,
    부서: item.department.name,
    역할: roleCodes[0] ?? "-",
    권한그룹: activeRoles[0] ?? "-",
    상태: item.isActive ? "활성" : "비활성",
    rowVersion: String(item.rowVersion),
    사용자RowVersion: String(item.rowVersion),
  };
}

type FavoriteWithUser = Prisma.FavoriteItemGetPayload<{
  include: {
    user: true;
  };
}>;

type RoleWithCount = Prisma.RoleGetPayload<{
  include: {
    _count: {
      select: {
        users: true;
      };
    };
  };
}>;

function normalizeRolePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((permission): permission is string => typeof permission === "string" && permission.trim().length > 0))];
}

function sameStringSet(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function roleSessionInvalidationNeeded(role: { permissions: Prisma.JsonValue; isActive: boolean }, body: { permissions?: unknown; status?: unknown }) {
  if (Array.isArray(body.permissions) && !sameStringSet(normalizeRolePermissions(role.permissions), normalizeRolePermissions(body.permissions))) return true;
  if (typeof body.status === "string" && (body.status === "활성") !== role.isActive) return true;
  return false;
}

function roleCodeFromName(name: string) {
  const slug = name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `${slug || "ROLE"}_${Date.now().toString(36).toUpperCase()}`.slice(0, 64);
}

function toRoleSettingsDto(item: RoleWithCount) {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    tag: item.code === "ADMIN" ? "관리자" : item.code === "REQUESTER" ? "기본" : "그룹",
    userCount: item._count.users,
    permissions: normalizeRolePermissions(item.permissions),
    status: item.isActive ? "활성" : "비활성",
    rowVersion: item.rowVersion,
  };
}

function toRoleAuditRow(item: RoleWithCount): TableRow {
  const dto = toRoleSettingsDto(item);
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    tag: dto.tag,
    userCount: String(dto.userCount),
    permissions: dto.permissions.join(","),
    status: dto.status,
    rowVersion: String(dto.rowVersion),
  };
}

const systemSettingIds = {
  approvalPolicy: "91000000-0000-4000-8000-000000000001",
  notifications: "91000000-0000-4000-8000-000000000002",
  integrations: "91000000-0000-4000-8000-000000000003",
} as const;

type SystemSettingKey = keyof typeof systemSettingIds;

const systemSettingKeySchema = z.enum(["approvalPolicy", "notifications", "integrations"]);

type SystemSettingLatest = {
  id: string;
  afterValue: Prisma.JsonValue | null;
  createdAt: Date;
};

function systemSettingMeta(latest: SystemSettingLatest | null | undefined) {
  return {
    auditLogId: latest?.id ?? null,
    updatedAt: latest?.createdAt?.toISOString() ?? null,
  };
}

type SettingsHistoryAuditLog = Prisma.AuditLogGetPayload<{
  include: { actor: { include: { department: true } } };
}>;

const systemSettingLabels: Record<SystemSettingKey, string> = {
  approvalPolicy: "결재 정책",
  notifications: "알림 설정",
  integrations: "외부 연동 설정",
};

function systemSettingKeyFromEntityId(entityId: string) {
  return Object.entries(systemSettingIds).find(([, id]) => id === entityId)?.[0] as SystemSettingKey | undefined;
}

function settingsHistoryTag(log: SettingsHistoryAuditLog) {
  if (log.entityType === "role") return "권한 변경";
  if (log.entityType === "user") return "사용자 변경";
  const settingKey = systemSettingKeyFromEntityId(log.entityId);
  if (settingKey === "notifications") return "알림 변경";
  if (settingKey === "integrations") return "연동 변경";
  return "정책 변경";
}

function settingsHistoryDescription(log: SettingsHistoryAuditLog) {
  const settingKey = systemSettingKeyFromEntityId(log.entityId);
  if (log.entityType === "system_setting") {
    if (log.action === "settings_integration_test") return `외부 연동 테스트 (${log.reason || "연동"})`;
    return `${settingKey ? systemSettingLabels[settingKey] : "시스템 설정"} 저장`;
  }
  if (log.entityType === "role") {
    if (log.action.endsWith("_create")) return `권한 그룹 추가 (${log.reason || "신규"})`;
    if (log.action.endsWith("_delete")) return `권한 그룹 삭제 (${log.reason || "비활성"})`;
    return `권한 그룹 수정 (${log.reason || "권한"})`;
  }
  if (log.entityType === "user") {
    if (log.action === "settings_create") return `사용자 권한 추가 (${log.reason || "권한"})`;
    return `사용자 권한 수정 (${log.reason || "상태/권한"})`;
  }
  return `${log.entityType} ${log.action}`;
}

function toSettingsHistoryRow(log: SettingsHistoryAuditLog): TableRow {
  const departmentName = log.actor.department?.name;
  return {
    id: log.id,
    time: log.createdAt.toISOString().slice(0, 16).replace("T", " "),
    user: departmentName ? `${log.actor.name} (${departmentName})` : log.actor.name,
    desc: settingsHistoryDescription(log),
    tag: settingsHistoryTag(log),
  };
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readSystemSettingExpectedAuditLogId(record: Record<string, unknown>) {
  for (const key of ["expectedAuditLogId", "settingAuditLogId", "auditLogId"]) {
    if (!hasOwn(record, key)) continue;
    const value = record[key];
    if (value === null || value === "") return { provided: true, value: null, valid: true };
    if (typeof value === "string" && value.trim()) return { provided: true, value: value.trim(), valid: true };
    return { provided: true, value: null, valid: false };
  }
  return { provided: false, value: null, valid: true };
}

function readSystemSettingSaveBody(body: unknown) {
  const record = bodyRecord(body);
  const wrapped = hasOwn(record, "value") && (
    hasOwn(record, "idempotencyKey")
    || hasOwn(record, "expectedAuditLogId")
    || hasOwn(record, "settingAuditLogId")
    || hasOwn(record, "auditLogId")
  );
  const expected = readSystemSettingExpectedAuditLogId(record);
  return {
    snapshot: wrapped ? record.value : body,
    idempotencyKey: readStringValue(record, ["idempotencyKey"]),
    expectedAuditLogId: expected.value,
    hasExpectedAuditLogId: expected.provided,
    expectedAuditLogIdValid: expected.valid,
    reason: readStringValue(record, ["reason"]),
  };
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type IntegrationSettingSnapshot = {
  id: string;
  name: string;
  target: string;
  status: "연동" | "대기" | "점검";
  lastSynced: string;
  credentialRef?: string;
  testEndpoint?: string;
  lastFailureReason?: string;
  lastTestedAt?: string;
};

type IntegrationTestResult = {
  integrationId: string;
  success: boolean;
  status: "연동" | "점검";
  testedAt: string;
  lastSynced: string;
  failureReason: string;
  httpStatus: number;
};

function integrationTestResultFromSetting(setting: IntegrationSettingSnapshot, replayedAt: string): IntegrationTestResult & { setting: IntegrationSettingSnapshot } {
  const success = setting.status === "연동" && !setting.lastFailureReason;
  return {
    integrationId: setting.id,
    success,
    status: success ? "연동" : "점검",
    testedAt: setting.lastTestedAt || replayedAt,
    lastSynced: setting.lastSynced || "-",
    failureReason: setting.lastFailureReason || "",
    httpStatus: success ? 200 : 0,
    setting,
  };
}

function readIntegrationSettings(value: unknown): IntegrationSettingSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id) return [];
    return [{
      id,
      name: typeof source.name === "string" ? source.name : id,
      target: typeof source.target === "string" ? source.target : "",
      status: source.status === "연동" || source.status === "점검" ? source.status : "대기",
      lastSynced: typeof source.lastSynced === "string" ? source.lastSynced : "-",
      credentialRef: typeof source.credentialRef === "string" ? source.credentialRef.trim() : "",
      testEndpoint: typeof source.testEndpoint === "string" ? source.testEndpoint.trim() : "",
      lastFailureReason: typeof source.lastFailureReason === "string" ? source.lastFailureReason : "",
      lastTestedAt: typeof source.lastTestedAt === "string" ? source.lastTestedAt : "",
    }];
  });
}

export function validateIntegrationTestSetup(setting: Pick<IntegrationSettingSnapshot, "credentialRef" | "testEndpoint">, env: NodeJS.ProcessEnv = process.env) {
  const credentialRef = setting.credentialRef?.trim() ?? "";
  const testEndpoint = setting.testEndpoint?.trim() ?? "";
  if (!credentialRef) return "credential reference가 필요합니다.";
  if (!/^[A-Z0-9_]{3,100}$/.test(credentialRef)) return "credential reference는 대문자, 숫자, 밑줄만 사용할 수 있습니다.";
  if (!env[credentialRef]) return `${credentialRef} secret이 서버 환경에 없습니다.`;
  if (!testEndpoint) return "테스트 endpoint가 필요합니다.";
  if (!/^https:\/\//i.test(testEndpoint)) return "테스트 endpoint는 HTTPS URL이어야 합니다.";
  return "";
}

async function executeIntegrationTest(setting: IntegrationSettingSnapshot, env: NodeJS.ProcessEnv = process.env): Promise<IntegrationTestResult> {
  const testedAt = new Date().toISOString();
  const setupError = validateIntegrationTestSetup(setting, env);
  if (setupError) {
    return {
      integrationId: setting.id,
      success: false,
      status: "점검",
      testedAt,
      lastSynced: setting.lastSynced || "-",
      failureReason: setupError,
      httpStatus: 0,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(setting.testEndpoint ?? "", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env[setting.credentialRef ?? ""]}`,
      },
      signal: controller.signal,
    });
    const success = response.ok;
    return {
      integrationId: setting.id,
      success,
      status: success ? "연동" : "점검",
      testedAt,
      lastSynced: success ? testedAt : setting.lastSynced || "-",
      failureReason: success ? "" : `HTTP ${response.status}`,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      integrationId: setting.id,
      success: false,
      status: "점검",
      testedAt,
      lastSynced: setting.lastSynced || "-",
      failureReason: error instanceof Error ? error.message : "연동 테스트 호출 실패",
      httpStatus: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toFavoriteRow(item: FavoriteWithUser): TableRow {
  const filters = favoriteFiltersFromJson(item.filters);
  const filterTags = filters.tags.length > 0 ? filters.tags : favoriteFilterTagsFromRecord(filters.filters);
  return {
    ID: item.id,
    항목명: item.label,
    유형: displayFavoriteKind(item.kind),
    설명: item.targetPath ?? item.pageKey,
    최근사용: item.lastUsedAt ? item.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "-",
    소유자: item.user.name,
    상태: item.isActive ? "활성" : "비활성",
    순서: String(item.sortOrder),
    대상화면: item.pageKey,
    필터: filterTags.join(", "),
    필터JSON: Object.keys(filters.filters).length > 0 ? JSON.stringify(filters.filters) : "",
    정렬: favoriteSortToText(filters.sort),
    공유: filters.shared,
    rowVersion: String(item.rowVersion),
    즐겨찾기RowVersion: String(item.rowVersion),
  };
}

type FavoriteFilterPayload = {
  tags: string[];
  shared: string;
  filters: Record<string, string>;
  sort?: { field: string; direction: "asc" | "desc" };
};

function favoriteStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, recordValue]) => {
    if (typeof recordValue === "string" && recordValue.trim()) acc[key] = recordValue.trim();
    return acc;
  }, {});
}

function favoriteFilterTagsFromRecord(filters: Record<string, string>) {
  const labels: Record<string, string> = {
    status: "상태",
    urgency: "긴급여부",
    reportDefinitionId: "보고서ID",
  };
  return Object.entries(filters).map(([key, value]) => `${labels[key] ?? key}: ${value}`);
}

function parseFavoriteSort(value: unknown): FavoriteFilterPayload["sort"] {
  if (typeof value === "string") {
    const [field, direction] = value.split(":");
    if (field && (direction === "asc" || direction === "desc")) return { field, direction };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (typeof source.field === "string" && (source.direction === "asc" || source.direction === "desc")) {
      return { field: source.field, direction: source.direction };
    }
  }
  return undefined;
}

function favoriteSortToText(sort: FavoriteFilterPayload["sort"]) {
  return sort ? `${sort.field}:${sort.direction}` : "";
}

function favoriteFiltersFromJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { tags: [] as string[], shared: "개인", filters: {} } satisfies FavoriteFilterPayload;
  const source = value as Record<string, unknown>;
  const filters = favoriteStringRecord(source.filters);
  const reserved = new Set(["tags", "shared", "filters", "sort", "sortColumn", "sortDirection"]);
  Object.entries(source).forEach(([key, recordValue]) => {
    if (!reserved.has(key) && typeof recordValue === "string" && recordValue.trim()) filters[key] = recordValue.trim();
  });
  const tags = Array.isArray(source.tags)
    ? source.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : favoriteFilterTagsFromRecord(filters);
  const sort =
    parseFavoriteSort(source.sort) ??
    (typeof source.sortColumn === "string" && (source.sortDirection === "asc" || source.sortDirection === "desc")
      ? { field: source.sortColumn, direction: source.sortDirection }
      : undefined);
  return {
    tags,
    shared: typeof source.shared === "string" && source.shared.trim() ? source.shared.trim() : "개인",
    filters,
    sort,
  };
}

function favoriteFiltersFromRow(row: TableRow): Prisma.InputJsonObject | undefined {
  const tags = (row.필터 ?? "")
    .split(/,\s*(?=[^,：:]+[:：])/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const shared = row.공유?.trim() || "개인";
  let filters: Record<string, string> = {};
  try {
    filters = favoriteStringRecord(row.필터JSON ? JSON.parse(row.필터JSON) : undefined);
  } catch {
    filters = {};
  }
  const sort = parseFavoriteSort(row.정렬);
  const payload: Record<string, unknown> = {};
  if (tags.length > 0) payload.tags = tags;
  if (shared !== "개인") payload.shared = shared;
  if (Object.keys(filters).length > 0) payload.filters = filters;
  if (sort) payload.sort = sort;
  if (Object.keys(payload).length === 0) return undefined;
  return payload as Prisma.InputJsonObject;
}

function favoritePageKeyFromRow(row: TableRow, fallback = "dashboard") {
  const candidate = (row.대상화면 ?? row.설명 ?? fallback).replace(/^#/, "").trim();
  return candidate || fallback;
}

function favoriteLastUsedAtFromRow(row: TableRow) {
  if (row.최근사용 === undefined || row.최근사용 === "-" || !row.최근사용.trim()) return undefined;
  const normalized = row.최근사용.includes("T") ? row.최근사용 : row.최근사용.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function favoriteSortOrder(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function createAudit(
  tx: Prisma.TransactionClient,
  request: FastifyRequest,
  user: AuthUser,
  entityType: string,
  entityId: string,
  action: string,
  beforeValue: TableRow | null,
  afterValue: TableRow | null,
  reason?: string,
  idempotencyKey?: string,
) {
  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      actorId: user.id,
      action,
      beforeValue: beforeValue ? jsonRow(beforeValue) : undefined,
      afterValue: afterValue ? jsonRow(afterValue) : undefined,
      reason,
      idempotencyKey,
      ...auditRequestContext(request),
    },
  });
}

async function revokeActiveSessionsForUsers(tx: Prisma.TransactionClient, userIds: string[], now = new Date()) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueUserIds.length === 0) return 0;
  const result = await tx.authSession.updateMany({
    where: {
      userId: { in: uniqueUserIds },
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });
  return result.count;
}

const budgetAdjustmentApprovalThreshold = 10_000_000;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function readStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readOptionalIntegerValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
  }
  return undefined;
}

function isPrismaCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function readBudgetAdjustmentInput(body: unknown) {
  const record = bodyRecord(body);
  const amountValue = record.amount ?? record["조정 금액"] ?? record.조정금액;
  const amount = typeof amountValue === "number" ? amountValue : parseWon(amountValue);
  const reason = readStringValue(record, ["reason", "조정 사유", "조정사유", "처리 사유"]);
  const rowVersionValue = record.rowVersion ?? record.예산RowVersion;
  const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
  const rowVersion = rowVersionValue === undefined || rowVersionValue === null || rowVersionValue === ""
    ? undefined
    : Number(rowVersionValue);

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return { error: "조정 금액은 1원 이상이어야 합니다." };
  if (!reason) return { error: "예산 조정 사유가 필요합니다." };
  if (rowVersion !== undefined && (!Number.isInteger(rowVersion) || rowVersion < 1)) return { error: "예산 버전 정보가 올바르지 않습니다." };
  return { amount, reason, rowVersion, idempotencyKey };
}

function dashboardActivityTone(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("reject") || normalized.includes("error") || normalized.includes("failed") || normalized.includes("exceeded")) return "danger";
  if (normalized.includes("hold") || normalized.includes("delayed")) return "warning";
  if (normalized.includes("complete") || normalized.includes("approve") || normalized.includes("apply")) return "success";
  if (normalized.includes("disbursement") || normalized.includes("payment")) return "payment";
  return "info";
}

function dashboardAuditActionLabel(action: string) {
  const map: Record<string, string> = {
    create: "생성",
    update: "수정",
    delete: "삭제",
    apply: "반영",
    request: "요청",
    approve: "승인",
    approved: "승인",
    reject: "반려",
    rejected: "반려",
    hold: "보류",
    held: "보류",
    verify: "검증",
    retry: "재처리",
    reschedule: "일정 변경",
    execution_approval: "지급 실행 확인",
  };
  return map[action] ?? action;
}

type DashboardAuditLog = Prisma.AuditLogGetPayload<{ include: { actor: true } }>;

function toDashboardAuditActivity(log: DashboardAuditLog, user: AuthUser): TableRow {
  const canSeeDetails = hasPermission(user, "system:manage") || log.actorId === user.id;
  const actor = canSeeDetails ? log.actor.name : "권한 범위 내 사용자";
  const entity = canSeeDetails ? `${log.entityType}:${log.entityId}` : log.entityType;
  const action = dashboardAuditActionLabel(log.action);
  return {
    제목: `감사 로그 · ${action}`,
    설명: `${actor} · ${entity}`,
    메타: canSeeDetails ? (log.reason ?? entity) : "권한에 따라 상세 마스킹",
    생성일시: log.createdAt.toISOString(),
    톤: dashboardActivityTone(`${log.entityType} ${log.action}`),
    원천: "AuditLog",
  };
}

function toDashboardNotificationActivity(notification: { title: string; message: string; entityType: string | null; entityId: string | null; type: NotificationType; createdAt: Date }): TableRow {
  return {
    제목: notification.title,
    설명: notification.message,
    메타: notification.entityId ?? notification.entityType ?? "알림",
    생성일시: notification.createdAt.toISOString(),
    톤: dashboardActivityTone(notification.type),
    원천: "Notification",
  };
}

async function dashboardRecentActivities(user: AuthUser) {
  const [logs, notifications] = await Promise.all([
    prisma.auditLog.findMany({
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return [
    ...logs.map((log) => toDashboardAuditActivity(log, user)),
    ...notifications.map(toDashboardNotificationActivity),
  ]
    .sort((a, b) => new Date(b.생성일시).getTime() - new Date(a.생성일시).getTime())
    .slice(0, 8);
}

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  async function dashboardRows(user: AuthUser) {
    const [items, activities] = await Promise.all([
      prisma.paymentRequest.findMany({
        include: {
          department: true,
          requester: true,
          vendor: true,
          approvalSteps: true,
        },
        orderBy: { requestedAt: "desc" },
        take: 50,
      }),
      dashboardRecentActivities(user),
    ]);
    const activitiesJson = JSON.stringify(activities);
    return items.map((item) => ({
      요청번호: item.requestCode,
      제목: item.reason,
      요청일: formatDate(item.requestedAt),
      부서: item.department.name,
      요청자: item.requester.name,
      거래처: item.vendor.name,
      금액: formatWon(item.amount),
      상태: item.status === "APPROVED" ? "승인 완료" : item.status === "REJECTED" ? "반려" : item.status === "HELD" ? "보류" : item.status === "APPROVAL_IN_PROGRESS" ? "승인 진행 중" : "승인 대기",
      결재상태: item.status === "APPROVED" ? "승인 완료" : item.status === "REJECTED" ? "반려" : item.status === "HELD" ? "보류" : item.status === "APPROVAL_IN_PROGRESS" ? "승인 진행 중" : "승인 대기",
      예산확인: item.budgetItemId ? "확인 완료" : "확인 전",
      처리기한: formatDate(addDays(item.requestedAt, 3)),
      결재단계: `${item.approvalSteps.filter((step) => step.status === "APPROVED").length}/${item.approvalSteps.length}`,
      최근활동JSON: activitiesJson,
    }));
  }

  app.get("/dashboard", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 조회 권한이 없습니다.", 403);

    const rows = await dashboardRows(user);

    return reply.send(rowsResponse(request, rows));
  });

  app.get("/dashboard/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 조회 권한이 없습니다.", 403);

    const params = request.params as { requestCode: string };
    const row = (await dashboardRows(user)).find((item) => item.요청번호 === params.requestCode) ?? null;
    return reply.send(success(request, row));
  });

  app.post("/dashboard", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 접근 권한이 없습니다.", 403);
    return fail(reply, "VALIDATION_ERROR", "대시보드는 읽기 전용입니다.", 400);
  });

  app.patch("/dashboard/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 접근 권한이 없습니다.", 403);
    return fail(reply, "VALIDATION_ERROR", "대시보드는 읽기 전용입니다.", 400);
  });

  app.delete("/dashboard/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 접근 권한이 없습니다.", 403);
    return fail(reply, "VALIDATION_ERROR", "대시보드는 읽기 전용입니다.", 400);
  });

  app.post("/dashboard/:requestCode/:action", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "dashboard:read")) return fail(reply, "FORBIDDEN", "대시보드 접근 권한이 없습니다.", 403);
    return fail(reply, "VALIDATION_ERROR", "대시보드는 읽기 전용입니다.", 400);
  });
};

export const budgetRoutes: FastifyPluginAsync = async (app) => {
  app.get("/budgets", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 조회 권한이 없습니다.", 403);

    const items = await prisma.budget.findMany({
      include: budgetRowInclude,
      orderBy: { fiscalYear: "desc" },
    });
    return reply.send(rowsResponse(request, items.map(toBudgetRow)));
  });

  app.get("/budgets/:departmentName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 조회 권한이 없습니다.", 403);

    const params = request.params as { departmentName: string };
    const item = await prisma.budget.findFirst({ where: { department: { name: params.departmentName } }, include: budgetRowInclude, orderBy: { fiscalYear: "desc" } });
    return reply.send(success(request, item ? toBudgetRow(item) : null));
  });

  app.get("/budgets/:departmentName/adjustments", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 조정 이력 조회 권한이 없습니다.", 403);

    const params = request.params as { departmentName: string };
    const item = await prisma.budget.findFirst({ where: { department: { name: params.departmentName } }, include: budgetRowInclude, orderBy: { fiscalYear: "desc" } });
    if (!item) return reply.send(success(request, []));

    const adjustments = await prisma.budgetAdjustment.findMany({
      where: { budgetId: item.id },
      include: { budget: { include: { department: true } }, requester: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send(success(request, adjustments.map(toBudgetAdjustmentRow), { total: adjustments.length }));
  });

  app.post("/budgets/:departmentName/adjustments", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 조정 권한이 없습니다.", 403);

    const input = readBudgetAdjustmentInput(request.body);
    if ("error" in input) return fail(reply, "VALIDATION_ERROR", input.error ?? "예산 조정 입력이 올바르지 않습니다.", 400);
    if (input.idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existingRequest?.afterValue) return reply.send(success(request, existingRequest.afterValue, { idempotencyReplay: true }));
    }

    const params = request.params as { departmentName: string };
    const before = await prisma.budget.findFirst({ where: { department: { name: params.departmentName } }, include: budgetRowInclude, orderBy: { fiscalYear: "desc" } });
    if (!before) return fail(reply, "NOT_FOUND", "등록된 예산을 찾을 수 없습니다.", 404);
    if (input.rowVersion !== undefined && input.rowVersion !== before.rowVersion) return fail(reply, "STALE_BUDGET", "예산 정보가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);

    const closeError = validateBudgetAdjustmentFinancialClose(before, { "배정 예산": formatWon(input.amount) });
    if (closeError) return fail(reply, "CLOSED_PERIOD_CONTROL_FAILED", closeError, 409);

    const requiresApproval = input.amount >= budgetAdjustmentApprovalThreshold;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const adjustment = await tx.budgetAdjustment.create({
          data: {
            budgetId: before.id,
            requestedBy: user.id,
            amount: input.amount,
            reason: input.reason,
            requiresApproval,
            status: requiresApproval ? BudgetAdjustmentStatus.PENDING_APPROVAL : BudgetAdjustmentStatus.APPLIED,
            appliedAt: requiresApproval ? undefined : new Date(),
          },
          include: { budget: { include: { department: true } }, requester: true },
        });

        let budget = before;
        if (!requiresApproval) {
          const nextAllocated = Number(before.allocatedAmount) + input.amount;
          const nextStatus = budgetStatusFor(nextAllocated, before.usedAmount);
          const updateResult = await tx.budget.updateMany({
            where: { id: before.id, rowVersion: before.rowVersion },
            data: {
              allocatedAmount: { increment: input.amount },
              status: nextStatus,
              rowVersion: { increment: 1 },
            },
          });
          if (updateResult.count !== 1) throw new Error("STALE_BUDGET");
          budget = await tx.budget.findUniqueOrThrow({ where: { id: before.id }, include: budgetRowInclude });
        }

        const response = {
          adjustment: toBudgetAdjustmentRow(adjustment),
          budget: toBudgetRow(budget),
          requiresApproval,
        };
        await tx.auditLog.create({
          data: {
            entityType: "budget_adjustment",
            entityId: adjustment.id,
            actorId: user.id,
            action: requiresApproval ? "request" : "apply",
            beforeValue: jsonRow(toBudgetRow(before)),
            afterValue: response as Prisma.InputJsonObject,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            ...auditRequestContext(request),
          },
        });
        return response;
      });
      return reply.send(success(request, result, { requiresApproval }));
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_BUDGET") {
        return fail(reply, "STALE_BUDGET", "예산 정보가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
      }
      throw error;
    }
  });

  app.post("/budgets/:departmentName/adjustments/:adjustmentId/:action", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 조정 상태 변경 권한이 없습니다.", 403);

    const params = request.params as { departmentName: string; adjustmentId: string; action: string };
    const nextStatus = params.action === "cancel"
      ? BudgetAdjustmentStatus.CANCELLED
      : params.action === "reject"
        ? BudgetAdjustmentStatus.REJECTED
        : null;
    if (!nextStatus) return fail(reply, "VALIDATION_ERROR", "지원하지 않는 예산 조정 액션입니다.", 400);

    const record = bodyRecord(request.body);
    const reason = readStringValue(record, ["reason", "처리 사유", "조정 사유"]) || (nextStatus === BudgetAdjustmentStatus.CANCELLED ? "예산 조정 취소" : "예산 조정 반려");
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest?.afterValue) return reply.send(success(request, existingRequest.afterValue, { idempotencyReplay: true }));
    }

    const before = await prisma.budgetAdjustment.findUnique({
      where: { id: params.adjustmentId },
      include: { budget: { include: { department: true } }, requester: true },
    });
    if (!before || before.budget.department.name !== params.departmentName) return fail(reply, "NOT_FOUND", "예산 조정 요청을 찾을 수 없습니다.", 404);
    if (before.status === nextStatus) {
      const budget = await prisma.budget.findUnique({ where: { id: before.budgetId }, include: budgetRowInclude });
      return reply.send(success(request, {
        adjustment: toBudgetAdjustmentRow(before),
        budget: budget ? toBudgetRow(budget) : null,
        rollbackPolicy: "원장 변경 없음",
      }, { idempotencyReplay: true }));
    }
    if (before.status === BudgetAdjustmentStatus.APPLIED) {
      return fail(reply, "LEDGER_ALREADY_APPLIED", "이미 원장에 반영된 조정은 취소/반려할 수 없습니다. 반대 조정 요청 또는 보정 전표로 처리해야 합니다.", 409);
    }
    if (before.status !== BudgetAdjustmentStatus.PENDING_APPROVAL) {
      return fail(reply, "WORKFLOW_LOCKED", "이미 종료된 예산 조정 요청은 상태를 변경할 수 없습니다.", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.budgetAdjustment.updateMany({
        where: { id: before.id, status: BudgetAdjustmentStatus.PENDING_APPROVAL },
        data: { status: nextStatus },
      });
      if (updateResult.count !== 1) throw new Error("BUDGET_ADJUSTMENT_CONFLICT");
      const after = await tx.budgetAdjustment.findUniqueOrThrow({
        where: { id: before.id },
        include: { budget: { include: { department: true } }, requester: true },
      });
      const budget = await tx.budget.findUniqueOrThrow({ where: { id: before.budgetId }, include: budgetRowInclude });
      const response = {
        adjustment: toBudgetAdjustmentRow(after),
        budget: toBudgetRow(budget),
        rollbackPolicy: "원장 미반영 상태에서 종료 · 예산 원장 rollback 없음",
      };
      await tx.auditLog.create({
        data: {
          entityType: "budget_adjustment",
          entityId: before.id,
          actorId: user.id,
          action: params.action,
          beforeValue: jsonRow(toBudgetAdjustmentRow(before)),
          afterValue: response as Prisma.InputJsonObject,
          reason,
          idempotencyKey,
          ...auditRequestContext(request),
        },
      });
      return response;
    }).catch((error) => {
      if (error instanceof Error && error.message === "BUDGET_ADJUSTMENT_CONFLICT") return null;
      throw error;
    });
    if (!result) return fail(reply, "CONFLICT", "예산 조정 요청 상태가 이미 변경되었습니다. 이력을 새로고침해주세요.", 409);
    return reply.send(success(request, result, { action: params.action }));
  });

  app.post("/budgets", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 등록 권한이 없습니다.", 403);

    const row = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.budget.findUnique({ where: { id: existingRequest.entityId }, include: budgetRowInclude });
        if (existingRequest.entityType === "budget" && existingRequest.action === "create" && replay) {
          return reply.send(success(request, toBudgetRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    if (!row.부서) return fail(reply, "VALIDATION_ERROR", "부서명이 필요합니다.", 400);
    const department = await prisma.department.findFirst({ where: { name: row.부서 } });
    if (!department) return fail(reply, "VALIDATION_ERROR", "등록된 부서를 찾을 수 없습니다.", 400);

    const allocated = parseWon(row["배정 예산"]) ?? 0;
    const used = parseWon(row["사용 금액"]) ?? 0;
    const fiscalYear = new Date().getFullYear().toString();
    const duplicate = await prisma.budget.findFirst({ where: { departmentId: department.id, fiscalYear } });
    if (duplicate) return fail(reply, "VALIDATION_ERROR", "해당 부서의 현재 연도 예산이 이미 등록되어 있습니다.", 400);
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.budget.create({
        data: {
          departmentId: department.id,
          fiscalYear,
          allocatedAmount: allocated,
          usedAmount: used,
          status: row.상태 ? toBudgetStatus(row.상태) ?? BudgetStatus.NORMAL : BudgetStatus.NORMAL,
        },
        include: budgetRowInclude,
      });
      await createAudit(tx, request, user, "budget", item.id, "create", null, toBudgetRow(item), row.부서, idempotencyKey);
      return item;
    }).catch((error) => {
      if (isPrismaCode(error, "P2002")) return null;
      throw error;
    });
    if (!created) {
      return idempotencyKey
        ? fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409)
        : fail(reply, "VALIDATION_ERROR", "해당 부서의 현재 연도 예산이 이미 등록되어 있습니다.", 400);
    }
    return reply.send(success(request, toBudgetRow(created), { created: true }));
  });

  app.patch("/budgets/:departmentName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "budget:read")) return fail(reply, "FORBIDDEN", "예산 수정 권한이 없습니다.", 403);

    const params = request.params as { departmentName: string };
    const before = await prisma.budget.findFirst({ where: { department: { name: params.departmentName } }, include: budgetRowInclude, orderBy: { fiscalYear: "desc" } });
    if (!before) return reply.send(success(request, null));

    const patch = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.budget.findUnique({ where: { id: existingRequest.entityId }, include: budgetRowInclude });
        if (existingRequest.entityType === "budget" && existingRequest.action === "update" && replay) {
          return reply.send(success(request, toBudgetRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "예산RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "예산 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "예산 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const closeError = validateBudgetAdjustmentFinancialClose(before, patch);
    if (closeError) return fail(reply, "CLOSED_PERIOD_CONTROL_FAILED", closeError, 409);

    const data: Prisma.BudgetUpdateManyMutationInput = { rowVersion: { increment: 1 } };
    const allocated = parseWon(patch["배정 예산"]);
    const used = parseWon(patch["사용 금액"]);
    if (allocated !== undefined) data.allocatedAmount = allocated;
    if (used !== undefined) data.usedAmount = used;
    if (patch.상태) data.status = toBudgetStatus(patch.상태) ?? before.status;

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.budget.updateMany({ where: { id: before.id, rowVersion: before.rowVersion }, data });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.budget.findUniqueOrThrow({ where: { id: before.id }, include: budgetRowInclude });
      await createAudit(tx, request, user, "budget", before.id, "update", toBudgetRow(before), toBudgetRow(item), patch.상태, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002")) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "예산 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toBudgetRow(updated), { rowVersion: updated.rowVersion }));
  });

  app.post("/budgets/:departmentName/:action", async (request, reply) => {
    const params = request.params as { departmentName: string; action: string };
    const body = bodyRecord(request.body) as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown };
    if (params.action === "adjust") {
      const direct = readStringPatch(request.body);
      const patch = readStringPatch(body.patch);
      const payload: Record<string, unknown> = {
        ...direct,
        ...patch,
        ...(typeof body.reason === "string" && body.reason ? { reason: body.reason } : {}),
        ...(typeof body.idempotencyKey === "string" && body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      };
      for (const key of ["amount", "rowVersion", "예산RowVersion", "조정 금액", "조정금액"]) {
        if (key in body) payload[key] = (body as Record<string, unknown>)[key];
      }
      return app.inject({ method: "POST", url: `/api/budgets/${encodeURIComponent(params.departmentName)}/adjustments`, headers: request.headers as Record<string, string>, cookies: definedCookies(request.cookies), payload }).then((response) => {
        reply.status(response.statusCode).headers(response.headers).send(response.body);
      });
    }
    const patch = readStringPatch(body.patch);
    const payload: Record<string, unknown> = { ...patch };
    if (typeof body.idempotencyKey === "string" && body.idempotencyKey) payload.idempotencyKey = body.idempotencyKey;
    for (const key of ["rowVersion", "예산RowVersion"]) {
      if (key in body) payload[key] = (body as Record<string, unknown>)[key];
    }
    return app.inject({ method: "PATCH", url: `/api/budgets/${encodeURIComponent(params.departmentName)}`, headers: request.headers as Record<string, string>, cookies: definedCookies(request.cookies), payload }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};

export const vendorRoutes: FastifyPluginAsync = async (app) => {
  app.get("/vendors", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "vendor:read")) return fail(reply, "FORBIDDEN", "거래처 조회 권한이 없습니다.", 403);

    const items = await prisma.vendor.findMany({ include: { disbursements: true }, orderBy: { name: "asc" } });
    return reply.send(rowsResponse(request, items.map(toVendorRow)));
  });

  app.get("/vendors/:vendorName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "vendor:read")) return fail(reply, "FORBIDDEN", "거래처 조회 권한이 없습니다.", 403);

    const params = request.params as { vendorName: string };
    const item = await prisma.vendor.findFirst({ where: { name: params.vendorName }, include: { disbursements: true } });
    return reply.send(success(request, item ? toVendorRow(item) : null));
  });

  app.post("/vendors", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "vendor:read")) return fail(reply, "FORBIDDEN", "거래처 등록 권한이 없습니다.", 403);

    const row = readStringPatch(request.body);
    const idempotencyKey = row.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.vendor.findUnique({ where: { id: existingRequest.entityId }, include: { disbursements: true } });
        if (existingRequest.entityType === "vendor" && existingRequest.action === "create" && replay) {
          return reply.send(success(request, toVendorRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    if (!row.거래처명 || !row.사업자번호) return fail(reply, "VALIDATION_ERROR", "거래처명과 사업자번호가 필요합니다.", 400);
    if (!row.은행 || !accountNumberPart(row.은행)) return fail(reply, "VALIDATION_ERROR", "은행명과 계좌번호가 필요합니다.", 400);
    const vendorValidationError = validateVendorRow(row, "create");
    if (vendorValidationError) return fail(reply, "VALIDATION_ERROR", vendorValidationError, 400);
    const duplicate = await prisma.vendor.findFirst({ where: { OR: [{ name: row.거래처명 }, { businessNumber: row.사업자번호 }] } });
    if (duplicate) return fail(reply, "VALIDATION_ERROR", "이미 등록된 거래처명 또는 사업자번호입니다.", 400);
    const bankAccount = accountNumberPart(row.은행);

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.vendor.create({
        data: {
          name: row.거래처명,
          businessNumber: row.사업자번호,
          managerName: row.담당자?.trim() ?? "",
          bankName: firstBankPart(row.은행 ?? ""),
          bankAccountEncrypted: encryptBankAccount(bankAccount),
          bankAccountMasked: maskedAccountPart(row.은행 ?? ""),
          taxInvoiceEmail: row["세금계산서 이메일"]?.trim() ?? "",
          taxInvoiceIssueType: row["세금계산서 발행"]?.trim() || "이메일 발행",
          accountVerificationStatus: row.계좌확인 ? toAccountStatus(row.계좌확인) ?? AccountVerificationStatus.PENDING : AccountVerificationStatus.PENDING,
          status: row.상태 ? toVendorStatus(row.상태) ?? VendorStatus.ACTIVE : VendorStatus.ACTIVE,
          isActive: row.상태 !== "비활성",
        },
        include: { disbursements: true },
      });
      await createAudit(tx, request, user, "vendor", item.id, "create", null, toVendorRow(item), row.거래처명, idempotencyKey);
      return item;
    });
    return reply.send(success(request, toVendorRow(created), { created: true }));
  });

  app.patch("/vendors/:vendorName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "vendor:read")) return fail(reply, "FORBIDDEN", "거래처 수정 권한이 없습니다.", 403);

    const params = request.params as { vendorName: string };
    const before = await prisma.vendor.findFirst({ where: { name: params.vendorName }, include: { disbursements: true } });
    if (!before) return reply.send(success(request, null));

    const patch = readStringPatch(request.body);
    const idempotencyKey = patch.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.vendor.findUnique({ where: { id: existingRequest.entityId }, include: { disbursements: true } });
        if (existingRequest.entityType === "vendor" && existingRequest.action === "update" && replay) {
          return reply.send(success(request, toVendorRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = Number(patch.rowVersion ?? patch.거래처RowVersion);
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "거래처 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const vendorValidationError = validateVendorRow(patch, "update");
    if (vendorValidationError) return fail(reply, "VALIDATION_ERROR", vendorValidationError, 400);
    const duplicateConditions: Prisma.VendorWhereInput[] = [
      ...(patch.거래처명 ? [{ name: patch.거래처명 }] : []),
      ...(patch.사업자번호 ? [{ businessNumber: patch.사업자번호 }] : []),
    ];
    const duplicate = duplicateConditions.length > 0
      ? await prisma.vendor.findFirst({
          where: {
            id: { not: before.id },
            OR: duplicateConditions,
          },
        })
      : null;
    if (duplicate) return fail(reply, "VALIDATION_ERROR", "이미 등록된 거래처명 또는 사업자번호입니다.", 400);

    const data: Prisma.VendorUpdateInput = { rowVersion: { increment: 1 } };
    if (patch.거래처명) data.name = patch.거래처명;
    if (patch.사업자번호) data.businessNumber = patch.사업자번호;
    if (patch.담당자 !== undefined) data.managerName = patch.담당자.trim();
    if (patch.은행) {
      const bankAccount = accountNumberPart(patch.은행);
      if (!bankAccount) return fail(reply, "VALIDATION_ERROR", "은행명과 계좌번호가 필요합니다.", 400);
      data.bankName = firstBankPart(patch.은행);
      data.bankAccountEncrypted = encryptBankAccount(bankAccount);
      data.bankAccountMasked = maskedAccountPart(patch.은행);
    }
    if (patch["세금계산서 이메일"] !== undefined) data.taxInvoiceEmail = patch["세금계산서 이메일"].trim();
    if (patch["세금계산서 발행"]) data.taxInvoiceIssueType = patch["세금계산서 발행"].trim();
    if (patch.계좌확인) data.accountVerificationStatus = toAccountStatus(patch.계좌확인) ?? before.accountVerificationStatus;
    if (patch.상태) {
      data.status = toVendorStatus(patch.상태) ?? before.status;
      data.isActive = patch.상태 !== "비활성";
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.vendor.updateMany({ where: { id: before.id, rowVersion: before.rowVersion }, data });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.vendor.findUniqueOrThrow({ where: { id: before.id }, include: { disbursements: true } });
      const impact = patch.상태 === "비활성" ? await getVendorDeactivationImpact(tx, before.id) : null;
      const afterRow = impact ? withVendorDeactivationImpact(toVendorRow(item), impact) : toVendorRow(item);
      await createAudit(tx, request, user, "vendor", before.id, "update", toVendorRow(before), afterRow, patch.작업사유 ?? patch.상태, idempotencyKey);
      return { item, row: afterRow };
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      throw error;
    });
    if (!result) return fail(reply, "CONFLICT", "거래처 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, result.row, { rowVersion: result.item.rowVersion }));
  });

  app.delete("/vendors/:vendorName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "vendor:read")) return fail(reply, "FORBIDDEN", "거래처 비활성화 권한이 없습니다.", 403);
    const params = request.params as { vendorName: string };
    const before = await prisma.vendor.findFirst({ where: { name: params.vendorName }, include: { disbursements: true } });
    if (!before) return reply.send(success(request, null));
    if (!before.isActive) return reply.send(success(request, toVendorRow(before), { idempotencyReplay: true, rowVersion: before.rowVersion }));
    const body = request.body && typeof request.body === "object" ? (request.body as { idempotencyKey?: unknown; reason?: unknown }) : {};
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : `vendor-delete:${before.id}:${before.rowVersion}`;
    const reason = typeof body.reason === "string" && body.reason ? body.reason : "거래처 비활성화";
    return app.inject({ method: "PATCH", url: `/api/vendors/${encodeURIComponent(params.vendorName)}`, headers: request.headers as Record<string, string>, cookies: definedCookies(request.cookies), payload: { 상태: "비활성", 작업사유: reason, rowVersion: String(before.rowVersion), idempotencyKey } }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });

  app.post("/vendors/:vendorName/:action", async (request, reply) => {
    const params = request.params as { vendorName: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown; rowVersion?: unknown }) : {};
    const actionPatch: Record<string, string> =
      params.action === "deactivate"
        ? { 상태: "비활성" }
        : params.action === "activate"
          ? { 상태: "활성" }
          : params.action === "verify"
            ? { 계좌확인: "확인 완료" }
            : {};
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined;
    const rowVersion = typeof body.rowVersion === "string" || typeof body.rowVersion === "number" ? String(body.rowVersion) : undefined;
    return app.inject({
      method: "PATCH",
      url: `/api/vendors/${encodeURIComponent(params.vendorName)}`,
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: {
        ...readStringPatch(body.patch),
        ...actionPatch,
        ...(reason ? { 작업사유: reason } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(rowVersion ? { rowVersion } : {}),
      },
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reports", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 조회 권한이 없습니다.", 403);

    const items = await prisma.reportRun.findMany({ include: { creator: true }, orderBy: { createdAt: "desc" } });
    return reply.send(rowsResponse(request, items.map(toReportRow)));
  });

  app.get("/reports/schedules", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 예약 조회 권한이 없습니다.", 403);

    const items = await prisma.reportSchedule.findMany({
      where: { userId: user.id },
      include: { definition: true },
      orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }, { updatedAt: "desc" }],
      take: 50,
    });
    return reply.send(success(request, items.map(toReportScheduleDto)));
  });

  app.post("/reports/schedules", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 예약 등록 권한이 없습니다.", 403);

    const input = readReportScheduleInput(request.body);
    if (input.recipients.length === 0) return fail(reply, "VALIDATION_ERROR", "예약 수신자는 1개 이상 필요합니다.", 400);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.reportSchedule.findUnique({ where: { id: existingRequest.entityId }, include: { definition: true } });
        if (existingRequest.entityType === "report_schedule" && existingRequest.action === "create" && replay) {
          return reply.send(success(request, toReportScheduleDto(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const definition = await findOrCreateReportDefinition(tx, user, input);
      const item = await tx.reportSchedule.create({
        data: {
          definitionId: definition.id,
          userId: user.id,
          frequency: toReportScheduleFrequency(input.cycle),
          recipients: reportScheduleDeliveryJson(input),
          isActive: input.isActive ?? true,
          nextRunAt: input.isActive === false ? null : nextReportScheduleRunAt(input),
        },
        include: { definition: true },
      });
      await createAudit(tx, request, user, "report_schedule", item.id, "create", null, toReportScheduleAuditRow(item), input.reportName, idempotencyKey);
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.SYSTEM_SETTING_CHANGED,
          title: "보고서 예약 발송 등록",
          message: `${item.definition.name} 예약이 ${input.cycle} ${input.time} 기준으로 등록되었습니다.`,
          entityType: "report_schedule",
          entityId: item.id,
          linkPath: "#reports",
          expiresAt: notificationExpiresAt(),
        },
      });
      return item;
    }).catch((error) => {
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!created) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    return reply.send(success(request, toReportScheduleDto(created), { created: true }));
  });

  app.patch("/reports/schedules/:scheduleId", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 예약 수정 권한이 없습니다.", 403);

    const params = request.params as { scheduleId: string };
    const before = await prisma.reportSchedule.findFirst({ where: { id: params.scheduleId, userId: user.id }, include: { definition: true } });
    if (!before) return reply.send(success(request, null));
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.reportSchedule.findUnique({ where: { id: existingRequest.entityId }, include: { definition: true } });
        if (existingRequest.entityType === "report_schedule" && existingRequest.action === "update" && replay) {
          return reply.send(success(request, toReportScheduleDto(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "예약RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "보고서 예약 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "보고서 예약 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }

    const beforeDelivery = reportScheduleDeliveryFromJson(before.recipients);
    const input = readReportScheduleInput(request.body, {
      reportName: before.definition.name,
      reportType: displayReportType(before.definition.type),
      recipients: beforeDelivery.recipients,
      cycle: beforeDelivery.cycle,
      time: beforeDelivery.time,
      format: beforeDelivery.format,
      isActive: before.isActive,
    });
    if (input.recipients.length === 0) return fail(reply, "VALIDATION_ERROR", "예약 수신자는 1개 이상 필요합니다.", 400);

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.reportSchedule.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          frequency: toReportScheduleFrequency(input.cycle),
          recipients: reportScheduleDeliveryJson(input),
          isActive: input.isActive ?? before.isActive,
          nextRunAt: input.isActive === false ? null : nextReportScheduleRunAt(input),
          rowVersion: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.reportSchedule.findUniqueOrThrow({ where: { id: before.id }, include: { definition: true } });
      await createAudit(tx, request, user, "report_schedule", before.id, "update", toReportScheduleAuditRow(before), toReportScheduleAuditRow(item), item.isActive ? "예약 수정/재개" : "예약 중지", idempotencyKey);
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.SYSTEM_SETTING_CHANGED,
          title: item.isActive ? "보고서 예약 발송 수정" : "보고서 예약 발송 중지",
          message: item.isActive ? `${item.definition.name} 예약이 ${input.cycle} ${input.time} 기준으로 갱신되었습니다.` : `${item.definition.name} 예약 발송이 중지되었습니다.`,
          entityType: "report_schedule",
          entityId: item.id,
          linkPath: "#reports",
          expiresAt: notificationExpiresAt(),
        },
      });
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "보고서 예약 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toReportScheduleDto(updated)));
  });

  app.delete("/reports/schedules/:scheduleId", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 예약 삭제 권한이 없습니다.", 403);

    const params = request.params as { scheduleId: string };
    const before = await prisma.reportSchedule.findFirst({ where: { id: params.scheduleId, userId: user.id }, include: { definition: true } });
    if (!before) return reply.send(success(request, null));
    if (!before.isActive) return reply.send(success(request, toReportScheduleDto(before), { deleted: true, idempotencyReplay: true, rowVersion: before.rowVersion }));
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]) || `report-schedule-delete:${before.id}:${before.rowVersion}`;
    const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
    if (existingRequest) {
      const replay = await prisma.reportSchedule.findUnique({ where: { id: existingRequest.entityId }, include: { definition: true } });
      if (existingRequest.entityType === "report_schedule" && existingRequest.action === "delete" && replay) {
        return reply.send(success(request, toReportScheduleDto(replay), { deleted: true, idempotencyReplay: true, rowVersion: replay.rowVersion }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "예약RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "보고서 예약 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "보고서 예약 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.reportSchedule.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          isActive: false,
          nextRunAt: null,
          rowVersion: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.reportSchedule.findUniqueOrThrow({ where: { id: before.id }, include: { definition: true } });
      await createAudit(tx, request, user, "report_schedule", before.id, "delete", toReportScheduleAuditRow(before), toReportScheduleAuditRow(item), before.definition.name, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002")) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "보고서 예약 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toReportScheduleDto(updated), { deleted: true }));
  });

  app.get("/reports/:reportName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 조회 권한이 없습니다.", 403);

    const item = await prisma.reportRun.findFirst({ where: { name: (request.params as { reportName: string }).reportName }, include: { creator: true } });
    return reply.send(success(request, item ? toReportRow(item) : null));
  });

  app.get("/reports/:reportName/download", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 다운로드 권한이 없습니다.", 403);

    const format = readReportDownloadFormat(request);
    if (!format) return fail(reply, "VALIDATION_ERROR", "보고서 다운로드 형식은 csv 또는 pdf만 지원합니다.", 400);

    const item = await prisma.reportRun.findFirst({ where: { name: (request.params as { reportName: string }).reportName }, include: { creator: true } });
    if (!item) return fail(reply, "NOT_FOUND", "보고서를 찾을 수 없습니다.", 404);

    const rowLimitIssue = reportDownloadLimitIssue({ rowCount: item.rowCount });
    if (rowLimitIssue) return fail(reply, rowLimitIssue.code, rowLimitIssue.message, 413);

    let artifactItem: ReportRunWithCreator;
    let download: Awaited<ReturnType<typeof readReportArtifactDownload>>;
    try {
      artifactItem = await ensureReportArtifact(item);
      download = await readReportArtifactDownload(artifactItem, format);
    } catch {
      return fail(reply, "REPORT_ARTIFACT_UNAVAILABLE", "보고서 산출물 저장소에서 파일을 읽을 수 없습니다.", 500);
    }
    if (!download) return fail(reply, "REPORT_ARTIFACT_INVALID", "저장된 보고서 산출물 형식이 올바르지 않습니다.", 500);

    const sizeLimitIssue = reportDownloadLimitIssue({ rowCount: artifactItem.rowCount, contentBytes: download.limits.contentBytes });
    if (sizeLimitIssue) return fail(reply, sizeLimitIssue.code, sizeLimitIssue.message, 413);

    await prisma.auditLog.create({
      data: {
        entityType: "report_run",
        entityId: artifactItem.id,
        actorId: user.id,
        action: `download_${format}`,
        afterValue: jsonRow({
          보고서명: artifactItem.name,
          형식: format,
          파일명: download.fileName,
          행수: String(artifactItem.rowCount),
          contentBytes: String(download.limits.contentBytes),
          artifactKey: artifactItem.artifactKey ?? "",
        }),
        reason: "보고서 다운로드",
        ...auditRequestContext(request),
      },
    });
    return reply.send(success(request, download, { format, artifactKey: artifactItem.artifactKey ?? "" }));
  });

  app.post("/reports", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 생성 권한이 없습니다.", 403);

    const row = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.reportRun.findUnique({ where: { id: existingRequest.entityId }, include: { creator: true } });
        if (existingRequest.entityType === "report_run" && existingRequest.action === "create" && replay) {
          return reply.send(success(request, toReportRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const period = parseReportPeriod(row.기간);
    const created = await prisma.$transaction(async (tx) => {
      const drilldownSnapshot = await buildReportDrilldownSnapshot(tx, row);
      const snapshotRowCount = Object.values(drilldownSnapshot.sections).reduce((sum, section) => sum + section.rows.length, 0);
      const item = await tx.reportRun.create({
        data: {
          createdBy: user.id,
          name: row.보고서명 || `보고서 ${new Date().toISOString().slice(0, 10)}`,
          type: toReportType(row.유형 ?? "종합"),
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: ReportRunStatus.READY,
          summary: writeReportSummaryMeta(row.요약 ?? "사용자 생성 보고서", row.공유권한 ?? row.공유, drilldownSnapshot, { department: row.부서, vendor: row.거래처 }),
          rowCount: Number(row.행수 ?? row.rowCount ?? 0) || snapshotRowCount,
        },
        include: { creator: true },
      });
      await createAudit(tx, request, user, "report_run", item.id, "create", null, toReportRow(item), row.요약, idempotencyKey);
      return item;
    }).catch((error) => {
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!created) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    try {
      const artifact = await writeReportArtifact(created);
      const artifactItem = await prisma.reportRun.update({
        where: { id: created.id },
        data: { artifactKey: artifact.artifactKey },
        include: { creator: true },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "report_run",
          entityId: artifactItem.id,
          actorId: user.id,
          action: "artifact_stored",
          afterValue: jsonRow({
            보고서명: artifactItem.name,
            artifactKey: artifact.artifactKey,
            byteSize: String(artifact.byteSize),
            checksum: artifact.checksum,
            storedAt: artifact.storedAt,
          }),
          reason: "보고서 artifact object storage 저장",
          ...auditRequestContext(request),
        },
      });
      return reply.send(success(request, toReportRow(artifactItem), { created: true, artifactKey: artifact.artifactKey }));
    } catch {
      await prisma.reportRun.update({ where: { id: created.id }, data: { status: ReportRunStatus.FAILED } }).catch(() => undefined);
      return fail(reply, "REPORT_ARTIFACT_STORE_FAILED", "보고서 산출물 저장에 실패했습니다.", 500);
    }
  });

  app.patch("/reports/:reportName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 수정 권한이 없습니다.", 403);

    const before = await prisma.reportRun.findFirst({ where: { name: (request.params as { reportName: string }).reportName }, include: { creator: true } });
    if (!before) return reply.send(success(request, null));
    const patch = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.reportRun.findUnique({ where: { id: existingRequest.entityId }, include: { creator: true } });
        if (existingRequest.entityType === "report_run" && existingRequest.action === "update" && replay) {
          return reply.send(success(request, toReportRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "보고서RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "보고서 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "보고서 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const beforeSummaryMeta = readReportSummaryMeta(before.summary);
      const nextSummary = patch.요약 !== undefined || patch.공유권한 !== undefined || patch.공유 !== undefined || patch.부서 !== undefined || patch.거래처 !== undefined
        ? writeReportSummaryMeta(
          patch.요약 ?? beforeSummaryMeta.summary,
          patch.공유권한 ?? patch.공유 ?? beforeSummaryMeta.access,
          beforeSummaryMeta.drilldown,
          { department: patch.부서 ?? beforeSummaryMeta.department, vendor: patch.거래처 ?? beforeSummaryMeta.vendor },
        )
        : before.summary;
      const updateResult = await tx.reportRun.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          name: patch.보고서명 || before.name,
          type: patch.유형 ? toReportType(patch.유형) : before.type,
          summary: nextSummary,
          rowVersion: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.reportRun.findUniqueOrThrow({ where: { id: before.id }, include: { creator: true } });
      await createAudit(tx, request, user, "report_run", before.id, "update", toReportRow(before), toReportRow(item), patch.요약, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "보고서 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    try {
      const artifact = await writeReportArtifact(updated);
      const artifactItem = updated.artifactKey === artifact.artifactKey
        ? updated
        : await prisma.reportRun.update({ where: { id: updated.id }, data: { artifactKey: artifact.artifactKey }, include: { creator: true } });
      return reply.send(success(request, toReportRow(artifactItem), { artifactKey: artifact.artifactKey }));
    } catch {
      return fail(reply, "REPORT_ARTIFACT_STORE_FAILED", "보고서 산출물 갱신에 실패했습니다.", 500);
    }
  });

  app.delete("/reports/:reportName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!can(user, "report:read")) return fail(reply, "FORBIDDEN", "보고서 삭제 권한이 없습니다.", 403);
    const before = await prisma.reportRun.findFirst({ where: { name: (request.params as { reportName: string }).reportName }, include: { creator: true } });
    if (!before) return reply.send(success(request, null));
    if (before.status === ReportRunStatus.EXPIRED) return reply.send(success(request, toReportRow(before), { deleted: true, idempotencyReplay: true, rowVersion: before.rowVersion }));
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]) || `report-delete:${before.id}:${before.rowVersion}`;
    const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
    if (existingRequest) {
      const replay = await prisma.reportRun.findUnique({ where: { id: existingRequest.entityId }, include: { creator: true } });
      if (existingRequest.entityType === "report_run" && existingRequest.action === "delete" && replay) {
        return reply.send(success(request, toReportRow(replay), { deleted: true, idempotencyReplay: true, rowVersion: replay.rowVersion }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "보고서RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "보고서 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "보고서 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.reportRun.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: { status: ReportRunStatus.EXPIRED, rowVersion: { increment: 1 } },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.reportRun.findUniqueOrThrow({ where: { id: before.id }, include: { creator: true } });
      await createAudit(tx, request, user, "report_run", before.id, "delete", toReportRow(before), toReportRow(item), before.name, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002")) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "보고서 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toReportRow(updated), { deleted: true }));
  });

  app.post("/reports/:reportName/:action", async (request, reply) => {
    const params = request.params as { reportName: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; idempotencyKey?: unknown; rowVersion?: unknown; 보고서RowVersion?: unknown }) : {};
    const direct = readStringPatch(request.body);
    const patch = readStringPatch(body.patch);
    const metadata: Record<string, unknown> = {
      ...(typeof body.idempotencyKey === "string" && body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      ...(typeof body.rowVersion === "string" || typeof body.rowVersion === "number" ? { rowVersion: body.rowVersion } : {}),
      ...(typeof body.보고서RowVersion === "string" || typeof body.보고서RowVersion === "number" ? { 보고서RowVersion: body.보고서RowVersion } : {}),
      ...(direct.idempotencyKey ? { idempotencyKey: direct.idempotencyKey } : {}),
      ...(direct.rowVersion ? { rowVersion: direct.rowVersion } : {}),
      ...(direct.보고서RowVersion ? { 보고서RowVersion: direct.보고서RowVersion } : {}),
    };
    if (params.action === "delete" || params.action === "archive") {
      return app.inject({
        method: "DELETE",
        url: `/api/reports/${encodeURIComponent(params.reportName)}`,
        headers: request.headers as Record<string, string>,
        cookies: definedCookies(request.cookies),
        payload: metadata,
      }).then((response) => {
        reply.status(response.statusCode).headers(response.headers).send(response.body);
      });
    }
    return app.inject({
      method: "PATCH",
      url: `/api/reports/${encodeURIComponent(params.reportName)}`,
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: { ...patch, ...metadata },
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};

export const settingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings/history", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 변경 이력 조회 권한이 없습니다.", 403);

    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "system_setting" },
          { entityType: "role", action: { startsWith: "settings_" } },
          { entityType: "user", action: { startsWith: "settings_" } },
        ],
      },
      include: { actor: { include: { department: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return reply.send(success(request, logs.map(toSettingsHistoryRow)));
  });

  app.get("/settings/config", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 조회 권한이 없습니다.", 403);

    const latestEntries = await Promise.all(
      Object.entries(systemSettingIds).map(async ([key, entityId]) => {
        const latest = await prisma.auditLog.findFirst({
          where: { entityType: "system_setting", entityId },
          orderBy: { createdAt: "desc" },
        });
        return [key, latest] as const;
      }),
    );
    const entries = latestEntries.map(([key, latest]) => [key, latest?.afterValue ?? null] as const);
    const metaEntries = latestEntries.map(([key, latest]) => [key, systemSettingMeta(latest)] as const);

    return reply.send(success(request, { ...Object.fromEntries(entries), __meta: Object.fromEntries(metaEntries) }));
  });

  app.patch("/settings/config/:settingKey", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 저장 권한이 없습니다.", 403);

    const key = systemSettingKeySchema.parse((request.params as { settingKey: string }).settingKey) as SystemSettingKey;
    const entityId = systemSettingIds[key];
    const before = await prisma.auditLog.findFirst({
      where: { entityType: "system_setting", entityId },
      orderBy: { createdAt: "desc" },
    });
    const input = readSystemSettingSaveBody(request.body);
    if (!input.expectedAuditLogIdValid) return fail(reply, "VALIDATION_ERROR", "설정 스냅샷 버전 정보가 올바르지 않습니다.", 400);

    const action = `settings_${key}_save`;
    if (input.idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existingRequest) {
        if (existingRequest.entityType === "system_setting" && existingRequest.entityId === entityId && existingRequest.action === action) {
          return reply.send(success(request, existingRequest.afterValue, { key, saved: true, idempotencyReplay: true, auditLogId: existingRequest.id }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }

    const currentAuditLogId = before?.id ?? null;
    if (input.hasExpectedAuditLogId && input.expectedAuditLogId !== currentAuditLogId) {
      return fail(reply, "CONFLICT", "시스템 설정이 이미 변경되었습니다. 설정 화면을 새로고침한 뒤 다시 저장해주세요.", 409);
    }

    const saved = await prisma.auditLog.create({
      data: {
        entityType: "system_setting",
        entityId,
        actorId: user.id,
        action,
        beforeValue: before?.afterValue ?? undefined,
        afterValue: toInputJson(input.snapshot),
        reason: input.reason || key,
        idempotencyKey: input.idempotencyKey || undefined,
        ...auditRequestContext(request),
      },
    }).catch(async (error) => {
      if (input.idempotencyKey && isPrismaCode(error, "P2002")) {
        const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existingRequest?.entityType === "system_setting" && existingRequest.entityId === entityId && existingRequest.action === action) return existingRequest;
      }
      throw error;
    });

    return reply.send(success(request, saved.afterValue, { key, saved: true, auditLogId: saved.id }));
  });

  app.post("/settings/integrations/:integrationId/test", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "외부 연동 테스트 권한이 없습니다.", 403);

    const params = request.params as { integrationId: string };
    const idempotencyKey = readStringValue(bodyRecord(request.body), ["idempotencyKey"]);
    if (!idempotencyKey) return fail(reply, "VALIDATION_ERROR", "외부 연동 테스트에는 idempotencyKey가 필요합니다.", 400);
    const entityId = systemSettingIds.integrations;
    const before = await prisma.auditLog.findFirst({
      where: { entityType: "system_setting", entityId },
      orderBy: { createdAt: "desc" },
    });
    const settings = readIntegrationSettings(before?.afterValue);
    const target = settings.find((setting) => setting.id === params.integrationId || setting.name === params.integrationId);
    if (!target) return fail(reply, "INTEGRATION_NOT_FOUND", "외부 연동 설정을 찾을 수 없습니다.", 404);

    const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
    if (existingRequest) {
      if (existingRequest.entityType === "system_setting" && existingRequest.entityId === entityId && existingRequest.action === "settings_integration_test") {
        const replaySettings = readIntegrationSettings(existingRequest.afterValue);
        const replaySetting = replaySettings.find((setting) => setting.id === target.id || setting.name === target.name);
        if (replaySetting) {
          return reply.send(success(request, integrationTestResultFromSetting(replaySetting, existingRequest.createdAt.toISOString()), { idempotencyReplay: true }));
        }
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }

    const result = await executeIntegrationTest(target);
    const updatedSettings = settings.map((setting) =>
      setting.id === target.id
        ? {
            ...setting,
            status: result.status,
            lastSynced: result.lastSynced,
            lastTestedAt: result.testedAt,
            lastFailureReason: result.failureReason,
          }
        : setting,
    );

    await prisma.auditLog.create({
      data: {
        entityType: "system_setting",
        entityId,
        actorId: user.id,
        action: "settings_integration_test",
        beforeValue: before?.afterValue ?? undefined,
        afterValue: updatedSettings as Prisma.InputJsonArray,
        reason: target.id,
        idempotencyKey,
        ...auditRequestContext(request),
      },
    });

    return reply.send(success(request, {
      ...result,
      setting: updatedSettings.find((setting) => setting.id === target.id),
    }));
  });

  app.get("/settings/roles", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "권한 그룹 조회 권한이 없습니다.", 403);

    const items = await prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    });
    return reply.send(success(request, items.map(toRoleSettingsDto)));
  });

  app.post("/settings/roles", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "권한 그룹 생성 권한이 없습니다.", 403);

    const body = request.body && typeof request.body === "object" ? (request.body as { name?: unknown; tag?: unknown; permissions?: unknown; status?: unknown; idempotencyKey?: unknown }) : {};
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.role.findUnique({ where: { id: existingRequest.entityId }, include: { _count: { select: { users: true } } } });
        if (existingRequest.entityType === "role" && existingRequest.action === "settings_role_create" && replay) {
          return reply.send(success(request, toRoleSettingsDto(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(reply, "VALIDATION_ERROR", "권한 그룹명이 필요합니다.", 400);
    const duplicate = await prisma.role.findFirst({ where: { name } });
    if (duplicate) return fail(reply, "VALIDATION_ERROR", "이미 등록된 권한 그룹명입니다.", 400);

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.role.create({
        data: {
          code: roleCodeFromName(name),
          name,
          permissions: normalizeRolePermissions(body.permissions),
          isActive: body.status !== "비활성",
        },
        include: { _count: { select: { users: true } } },
      });
      await createAudit(tx, request, user, "role", item.id, "settings_role_create", null, toRoleAuditRow(item), typeof body.tag === "string" ? body.tag : undefined, idempotencyKey);
      return item;
    });
    return reply.send(success(request, toRoleSettingsDto(created), { created: true }));
  });

  app.patch("/settings/roles/:roleId", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "권한 그룹 수정 권한이 없습니다.", 403);

    const params = request.params as { roleId: string };
    const before = await prisma.role.findFirst({
      where: { OR: [{ id: params.roleId }, { name: params.roleId }, { code: params.roleId }] },
      include: { _count: { select: { users: true } } },
    });
    if (!before) return reply.send(success(request, null));

    const body = request.body && typeof request.body === "object" ? (request.body as { name?: unknown; permissions?: unknown; status?: unknown; tag?: unknown; rowVersion?: unknown; idempotencyKey?: unknown }) : {};
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.role.findUnique({ where: { id: existingRequest.entityId }, include: { _count: { select: { users: true } } } });
        if (existingRequest.entityType === "role" && existingRequest.action === "settings_role_update" && replay) {
          return reply.send(success(request, toRoleSettingsDto(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = Number(body.rowVersion);
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "권한 그룹 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const nextName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : before.name;
    if (nextName !== before.name) {
      const duplicate = await prisma.role.findFirst({ where: { id: { not: before.id }, name: nextName } });
      if (duplicate) return fail(reply, "VALIDATION_ERROR", "이미 등록된 권한 그룹명입니다.", 400);
    }
    const shouldRevokeSessions = roleSessionInvalidationNeeded(before, body);

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.role.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          name: nextName,
          ...(Array.isArray(body.permissions) ? { permissions: normalizeRolePermissions(body.permissions) } : {}),
          ...(typeof body.status === "string" ? { isActive: body.status === "활성" } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.role.findUniqueOrThrow({ where: { id: before.id }, include: { _count: { select: { users: true } } } });
      await createAudit(tx, request, user, "role", before.id, "settings_role_update", toRoleAuditRow(before), toRoleAuditRow(item), typeof body.tag === "string" ? body.tag : undefined, idempotencyKey);
      if (!shouldRevokeSessions) return { item, sessionsRevoked: 0 };

      const affectedUsers = await tx.userRole.findMany({ where: { roleId: before.id }, select: { userId: true } });
      const sessionsRevoked = await revokeActiveSessionsForUsers(tx, affectedUsers.map((item) => item.userId));
      if (sessionsRevoked > 0) {
        await createAudit(tx, request, user, "role", before.id, "settings_role_session_revoke", null, {
          id: before.id,
          name: before.name,
          sessionsRevoked: String(sessionsRevoked),
          affectedUsers: String(affectedUsers.length),
          policy: "권한 그룹 permission/status 변경 즉시 재로그인 요구",
        }, "권한 변경 즉시 반영");
      }
      return { item, sessionsRevoked };
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "권한 그룹 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toRoleSettingsDto(updated.item), {
      sessionsRevoked: updated.sessionsRevoked,
      sessionPolicy: shouldRevokeSessions ? "권한 그룹 변경 대상 사용자는 다음 요청부터 재로그인이 필요합니다." : "권한에 영향 없는 변경입니다.",
    }));
  });

  app.delete("/settings/roles/:roleId", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "권한 그룹 삭제 권한이 없습니다.", 403);

    const params = request.params as { roleId: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { rowVersion?: unknown; idempotencyKey?: unknown }) : {};
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        if (existingRequest.entityType === "role" && existingRequest.action === "settings_role_delete") {
          return reply.send(success(request, null, { idempotencyReplay: true }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const before = await prisma.role.findFirst({
      where: { OR: [{ id: params.roleId }, { name: params.roleId }, { code: params.roleId }] },
      include: { _count: { select: { users: true } } },
    });
    if (!before) return reply.send(success(request, null));
    const expectedRowVersion = Number(body.rowVersion);
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "권한 그룹 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    if (before._count.users > 0) return fail(reply, "ROLE_IN_USE", "사용자가 배정된 권한 그룹은 삭제할 수 없습니다. 먼저 사용자를 다른 권한 그룹으로 이동하거나 그룹을 비활성화하세요.", 409);

    const deleted = await prisma.$transaction(async (tx) => {
      const deleteResult = await tx.role.deleteMany({ where: { id: before.id, rowVersion: before.rowVersion } });
      if (deleteResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      await createAudit(tx, request, user, "role", before.id, "settings_role_delete", toRoleAuditRow(before), null, before.name, idempotencyKey);
      return before;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      throw error;
    });
    if (!deleted) return fail(reply, "CONFLICT", "권한 그룹 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toRoleSettingsDto(deleted), { deleted: true }));
  });

  app.get("/settings", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 조회 권한이 없습니다.", 403);

    const items = await prisma.user.findMany({ include: { department: true, roles: { include: { role: true } } }, orderBy: { name: "asc" } });
    return reply.send(rowsResponse(request, items.map(toSettingRow)));
  });

  app.get("/settings/:userName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 조회 권한이 없습니다.", 403);
    const item = await prisma.user.findFirst({ where: { name: (request.params as { userName: string }).userName }, include: { department: true, roles: { include: { role: true } } } });
    return reply.send(success(request, item ? toSettingRow(item) : null));
  });

  app.post("/settings", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 등록 권한이 없습니다.", 403);

    const row = readStringPatch(request.body);
    const idempotencyKey = row.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.user.findUnique({ where: { id: existingRequest.entityId }, include: { department: true, roles: { include: { role: true } } } });
        if (existingRequest.entityType === "user" && existingRequest.action === "settings_create" && replay) {
          return reply.send(success(request, toSettingRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    if (!row.사용자) return fail(reply, "VALIDATION_ERROR", "사용자명이 필요합니다.", 400);
    const duplicateUser = await prisma.user.findFirst({ where: { name: row.사용자 } });
    if (duplicateUser) return fail(reply, "VALIDATION_ERROR", "이미 등록된 사용자명입니다. 기존 사용자 권한을 수정해주세요.", 400);
    const department = row.부서 ? await prisma.department.findFirst({ where: { name: row.부서 } }) : await prisma.department.findFirst();
    if (!department) return fail(reply, "VALIDATION_ERROR", "등록된 부서를 찾을 수 없습니다.", 400);

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.user.create({
        data: {
          name: row.사용자,
          email: `${Date.now()}-${row.사용자.replace(/\s+/g, "")}@example.local`,
          departmentId: department.id,
          passwordHash: "pending-production-password-hash",
          isActive: row.상태 !== "비활성",
        },
        include: { department: true, roles: { include: { role: true } } },
      });
      const role = row.권한그룹 ? await tx.role.findFirst({ where: { OR: [{ name: row.권한그룹 }, { code: row.권한그룹 }] } }) : null;
      if (role) await tx.userRole.create({ data: { userId: item.id, roleId: role.id } });
      const after = await tx.user.findUniqueOrThrow({ where: { id: item.id }, include: { department: true, roles: { include: { role: true } } } });
      await createAudit(tx, request, user, "user", item.id, "settings_create", null, toSettingRow(after), row.권한그룹, idempotencyKey);
      return after;
    });
    return reply.send(success(request, toSettingRow(created), { created: true }));
  });

  app.patch("/settings/:userName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "시스템 설정 수정 권한이 없습니다.", 403);

    const before = await prisma.user.findFirst({ where: { name: (request.params as { userName: string }).userName }, include: { department: true, roles: { include: { role: true } } } });
    if (!before) return reply.send(success(request, null));
    const patch = readStringPatch(request.body);
    const idempotencyKey = patch.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.user.findUnique({ where: { id: existingRequest.entityId }, include: { department: true, roles: { include: { role: true } } } });
        if (existingRequest.entityType === "user" && existingRequest.action === "settings_update" && replay) {
          return reply.send(success(request, toSettingRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = Number(patch.rowVersion ?? patch.사용자RowVersion);
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "사용자 권한 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const shouldRevokeSessions = patch.권한그룹 !== undefined || patch.상태 !== undefined || patch.부서 !== undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const department = patch.부서 ? await tx.department.findFirst({ where: { name: patch.부서 } }) : null;
      const updateResult = await tx.user.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          name: patch.사용자 || before.name,
          isActive: patch.상태 ? patch.상태 === "활성" : before.isActive,
          rowVersion: { increment: 1 },
          ...(department ? { departmentId: department.id } : {}),
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      if (patch.권한그룹) {
        const role = await tx.role.findFirst({ where: { OR: [{ name: patch.권한그룹 }, { code: patch.권한그룹 }] } });
        if (role) {
          await tx.userRole.deleteMany({ where: { userId: before.id } });
          await tx.userRole.create({ data: { userId: before.id, roleId: role.id } });
        }
      }
      const after = await tx.user.findUniqueOrThrow({ where: { id: before.id }, include: { department: true, roles: { include: { role: true } } } });
      await createAudit(tx, request, user, "user", before.id, "settings_update", toSettingRow(before), toSettingRow(after), patch.권한그룹 ?? patch.상태, idempotencyKey);
      const sessionsRevoked = shouldRevokeSessions ? await revokeActiveSessionsForUsers(tx, [before.id]) : 0;
      if (sessionsRevoked > 0) {
        await createAudit(tx, request, user, "user", before.id, "settings_user_session_revoke", null, {
          사용자: after.name,
          부서: after.department.name,
          sessionsRevoked: String(sessionsRevoked),
          policy: "사용자 권한/상태/부서 변경 즉시 재로그인 요구",
        }, "사용자 권한 변경 즉시 반영");
      }
      return { item: after, sessionsRevoked };
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "사용자 권한 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toSettingRow(updated.item), {
      sessionsRevoked: updated.sessionsRevoked,
      sessionPolicy: shouldRevokeSessions ? "대상 사용자는 다음 요청부터 재로그인이 필요합니다." : "세션에 영향 없는 변경입니다.",
    }));
  });

  app.delete("/settings/:userName", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) return fail(reply, "FORBIDDEN", "사용자 비활성화 권한이 없습니다.", 403);
    const params = request.params as { userName: string };
    const direct = readStringPatch(request.body);
    const before = await prisma.user.findFirst({ where: { name: params.userName }, include: { department: true, roles: { include: { role: true } } } });
    if (!before) return reply.send(success(request, null));
    if (!before.isActive) return reply.send(success(request, toSettingRow(before), { deleted: true, alreadyInactive: true }));
    const rowVersion = direct.rowVersion ?? direct.사용자RowVersion ?? String(before.rowVersion);
    return app.inject({ method: "PATCH", url: `/api/settings/${encodeURIComponent(params.userName)}`, headers: request.headers as Record<string, string>, cookies: definedCookies(request.cookies), payload: { 상태: "비활성", rowVersion, 사용자RowVersion: rowVersion, idempotencyKey: direct.idempotencyKey ?? `settings-user-deactivate-${before.id}-${before.rowVersion}` } }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });

  app.post("/settings/:userName/:action", async (request, reply) => {
    const params = request.params as { userName: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown }) : {};
    const direct = readStringPatch(request.body);
    const patch = readStringPatch(body.patch);
    const actionPatch = params.action === "deactivate" ? { 상태: "비활성" } : params.action === "activate" ? { 상태: "활성" } : {};
    const rowVersion = patch.rowVersion ?? patch.사용자RowVersion ?? direct.rowVersion ?? direct.사용자RowVersion;
    const idempotencyKey = patch.idempotencyKey ?? direct.idempotencyKey;
    return app.inject({
      method: "PATCH",
      url: `/api/settings/${encodeURIComponent(params.userName)}`,
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: { ...patch, ...actionPatch, ...(rowVersion ? { rowVersion, 사용자RowVersion: rowVersion } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) },
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};

export const favoriteRoutes: FastifyPluginAsync = async (app) => {
  app.get("/favorites", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "favorite:read")) return fail(reply, "FORBIDDEN", "즐겨찾기 조회 권한이 없습니다.", 403);

    const items = await prisma.favoriteItem.findMany({ where: { userId: user.id }, include: { user: true }, orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }] });
    return reply.send(rowsResponse(request, items.map(toFavoriteRow)));
  });

  app.get("/favorites/:label", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "favorite:read")) return fail(reply, "FORBIDDEN", "즐겨찾기 조회 권한이 없습니다.", 403);
    const item = await prisma.favoriteItem.findFirst({ where: { userId: user.id, label: (request.params as { label: string }).label }, include: { user: true } });
    return reply.send(success(request, item ? toFavoriteRow(item) : null));
  });

  app.post("/favorites", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "favorite:read")) return fail(reply, "FORBIDDEN", "즐겨찾기 저장 권한이 없습니다.", 403);
    const row = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.favoriteItem.findUnique({ where: { id: existingRequest.entityId }, include: { user: true } });
        if (existingRequest.entityType === "favorite_item" && existingRequest.action === "create" && replay) {
          return reply.send(success(request, toFavoriteRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    if (!row.항목명) return fail(reply, "VALIDATION_ERROR", "즐겨찾기 항목명이 필요합니다.", 400);

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.favoriteItem.create({
        data: {
          userId: user.id,
          label: row.항목명,
          kind: toFavoriteKind(row.유형 ?? "바로가기"),
          pageKey: favoritePageKeyFromRow(row),
          targetPath: row.설명?.startsWith("#") ? row.설명 : undefined,
          filters: favoriteFiltersFromRow(row),
          sortOrder: favoriteSortOrder(row.순서, 100),
        },
        include: { user: true },
      });
      await createAudit(tx, request, user, "favorite_item", item.id, "create", null, toFavoriteRow(item), row.항목명, idempotencyKey);
      return item;
    }).catch((error) => {
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!created) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    return reply.send(success(request, toFavoriteRow(created), { created: true }));
  });

  app.patch("/favorites/:label", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "favorite:read")) return fail(reply, "FORBIDDEN", "즐겨찾기 수정 권한이 없습니다.", 403);
    const before = await prisma.favoriteItem.findFirst({ where: { userId: user.id, label: (request.params as { label: string }).label }, include: { user: true } });
    if (!before) return reply.send(success(request, null));
    const patch = readStringPatch(request.body);
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.favoriteItem.findUnique({ where: { id: existingRequest.entityId }, include: { user: true } });
        if (existingRequest.entityType === "favorite_item" && existingRequest.action === "update" && replay) {
          return reply.send(success(request, toFavoriteRow(replay), { idempotencyReplay: true, rowVersion: replay.rowVersion }));
        }
        return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      }
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "즐겨찾기RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "즐겨찾기 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "즐겨찾기 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const beforeFilters = favoriteFiltersFromJson(before.filters);
    const nextLastUsedAt = favoriteLastUsedAtFromRow(patch);
    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.favoriteItem.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: {
          label: patch.항목명 || before.label,
          kind: patch.유형 ? toFavoriteKind(patch.유형) : before.kind,
          pageKey: (patch.대상화면 || patch.설명) ? favoritePageKeyFromRow(patch, before.pageKey) : before.pageKey,
          targetPath: patch.설명?.startsWith("#") ? patch.설명 : before.targetPath,
          ...(patch.필터 !== undefined || patch.공유 !== undefined || patch.필터JSON !== undefined || patch.정렬 !== undefined
            ? {
                filters: favoriteFiltersFromRow({
                  필터: patch.필터 ?? beforeFilters.tags.join(", "),
                  공유: patch.공유 ?? beforeFilters.shared,
                  필터JSON: patch.필터JSON ?? JSON.stringify(beforeFilters.filters),
                  정렬: patch.정렬 ?? favoriteSortToText(beforeFilters.sort),
                }),
              }
            : {}),
          ...(patch.순서 !== undefined ? { sortOrder: favoriteSortOrder(patch.순서, before.sortOrder) } : {}),
          isActive: patch.상태 ? patch.상태 === "활성" : before.isActive,
          ...(nextLastUsedAt ? { lastUsedAt: nextLastUsedAt } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.favoriteItem.findUniqueOrThrow({ where: { id: before.id }, include: { user: true } });
      await createAudit(tx, request, user, "favorite_item", before.id, "update", toFavoriteRow(before), toFavoriteRow(item), patch.항목명 ?? patch.상태, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002") && idempotencyKey) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "즐겨찾기 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toFavoriteRow(updated)));
  });

  app.delete("/favorites/:label", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "favorite:read")) return fail(reply, "FORBIDDEN", "즐겨찾기 삭제 권한이 없습니다.", 403);
    const before = await prisma.favoriteItem.findFirst({ where: { userId: user.id, label: (request.params as { label: string }).label }, include: { user: true } });
    if (!before) return reply.send(success(request, null));
    if (!before.isActive) return reply.send(success(request, toFavoriteRow(before), { deleted: true, idempotencyReplay: true, rowVersion: before.rowVersion }));
    const record = bodyRecord(request.body);
    const idempotencyKey = readStringValue(record, ["idempotencyKey"]) || `favorite-delete:${before.id}:${before.rowVersion}`;
    const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
    if (existingRequest) {
      const replay = await prisma.favoriteItem.findUnique({ where: { id: existingRequest.entityId }, include: { user: true } });
      if (existingRequest.entityType === "favorite_item" && existingRequest.action === "delete" && replay) {
        return reply.send(success(request, toFavoriteRow(replay), { deleted: true, idempotencyReplay: true, rowVersion: replay.rowVersion }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }
    const expectedRowVersion = readOptionalIntegerValue(record, ["rowVersion", "즐겨찾기RowVersion"]);
    if (Number.isNaN(expectedRowVersion)) return fail(reply, "VALIDATION_ERROR", "즐겨찾기 버전 정보가 올바르지 않습니다.", 400);
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "즐겨찾기 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.favoriteItem.updateMany({
        where: { id: before.id, rowVersion: before.rowVersion },
        data: { isActive: false, rowVersion: { increment: 1 } },
      });
      if (updateResult.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
      const item = await tx.favoriteItem.findUniqueOrThrow({ where: { id: before.id }, include: { user: true } });
      await createAudit(tx, request, user, "favorite_item", before.id, "delete", toFavoriteRow(before), toFavoriteRow(item), before.label, idempotencyKey);
      return item;
    }).catch((error) => {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") return null;
      if (isPrismaCode(error, "P2002")) return null;
      throw error;
    });
    if (!updated) return fail(reply, "CONFLICT", "즐겨찾기 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    return reply.send(success(request, toFavoriteRow(updated), { deleted: true }));
  });

  app.post("/favorites/:label/:action", async (request, reply) => {
    const params = request.params as { label: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; idempotencyKey?: unknown; rowVersion?: unknown; 즐겨찾기RowVersion?: unknown }) : {};
    const direct = readStringPatch(request.body);
    const patch = readStringPatch(body.patch);
    const metadata: Record<string, unknown> = {
      ...(typeof body.idempotencyKey === "string" && body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      ...(typeof body.rowVersion === "string" || typeof body.rowVersion === "number" ? { rowVersion: body.rowVersion } : {}),
      ...(typeof body.즐겨찾기RowVersion === "string" || typeof body.즐겨찾기RowVersion === "number" ? { 즐겨찾기RowVersion: body.즐겨찾기RowVersion } : {}),
      ...(direct.idempotencyKey ? { idempotencyKey: direct.idempotencyKey } : {}),
      ...(direct.rowVersion ? { rowVersion: direct.rowVersion } : {}),
      ...(direct.즐겨찾기RowVersion ? { 즐겨찾기RowVersion: direct.즐겨찾기RowVersion } : {}),
    };
    if (params.action === "delete") {
      return app.inject({
        method: "DELETE",
        url: `/api/favorites/${encodeURIComponent(params.label)}`,
        headers: request.headers as Record<string, string>,
        cookies: definedCookies(request.cookies),
        payload: metadata,
      }).then((response) => {
        reply.status(response.statusCode).headers(response.headers).send(response.body);
      });
    }
    const actionPatch = params.action === "open" ? { 상태: "활성", 최근사용: new Date().toISOString() } : {};
    return app.inject({
      method: "PATCH",
      url: `/api/favorites/${encodeURIComponent(params.label)}`,
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: { ...patch, ...actionPatch, ...metadata },
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};
