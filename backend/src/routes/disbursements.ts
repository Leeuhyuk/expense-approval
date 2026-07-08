import type { FastifyPluginAsync } from "fastify";
import { AccountVerificationStatus, ApprovalStatus, DisbursementStatus, NotificationType, PaymentRequestStatus, VendorStatus, type Prisma } from "../../generated/prisma/index.js";
import { z } from "zod";
import { hasPermission, requireAuth } from "../auth/session.js";
import { validateDisbursementFinancialClose } from "../controls/financialClose.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { internalBankAccountVerificationPolicy, verifyBankAccount, type BankAccountVerificationResult } from "../integrations/bankAccountVerification.js";
import { decryptBankAccount } from "../security/bankAccountCrypto.js";
import { fail, success } from "../utils/response.js";
import { auditRequestContext, definedCookies, filterAndSortRows, formatDate, formatWon, jsonRow, paginateRows, readListFilters, readStringPatch, type TableRow } from "./rowUtils.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  sort: z.string().optional(),
});

type DisbursementWithRelations = Prisma.DisbursementGetPayload<{
  include: {
    vendor: true;
    paymentRequest: {
      include: {
        approvalSteps: true;
        budgetItem: {
          include: {
            budget: true;
          };
        };
        department: true;
        requester: true;
      };
    };
  };
}>;

type DisbursementMutationAction = "execute" | "hold" | "retry" | "verify" | "reschedule" | "update";
const executionApprovalAction = "execution_approval";

type BankTransferExportDisbursement = Prisma.DisbursementGetPayload<{
  include: {
    vendor: true;
    paymentRequest: {
      include: {
        approvalSteps: true;
        department: true;
        requester: true;
      };
    };
  };
}>;

type BankTransferExportFilters = {
  scheduledFrom?: string;
  scheduledTo?: string;
  bank?: string;
  department?: string;
  status?: string;
};

type BankTransferExportRow = {
  지급번호: string;
  승인번호: string;
  지급예정일: string;
  거래처: string;
  사업자번호: string;
  은행: string;
  계좌번호: string;
  금액: number;
  요청부서: string;
  요청자: string;
  지급상태: string;
  계좌확인: string;
  거래처계좌확인: string;
  결재상태: string;
  결재단계확인: string;
};

type BankResultInput = {
  disbursementCode: string;
  approvalCode?: string;
  amount: number;
  status: "SUCCESS" | "FAILED";
  bankResultId?: string;
  message?: string;
};

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

function displayAccountStatus(status: AccountVerificationStatus) {
  const map: Record<AccountVerificationStatus, string> = {
    VERIFIED: "확인 완료",
    PENDING: "확인 대기",
    MISMATCH: "계좌 불일치",
    INACTIVE: "비활성",
  };
  return map[status];
}

function toDisbursementStatus(value: string) {
  const map: Record<string, DisbursementStatus> = {
    "지급 예정": DisbursementStatus.SCHEDULED,
    "오늘 지급": DisbursementStatus.DUE_TODAY,
    "지급 완료": DisbursementStatus.COMPLETED,
    오류: DisbursementStatus.ERROR,
    보류: DisbursementStatus.HELD,
  };
  return map[value];
}

function toAccountStatus(value: string) {
  const map: Record<string, AccountVerificationStatus> = {
    "확인 완료": AccountVerificationStatus.VERIFIED,
    "확인 대기": AccountVerificationStatus.PENDING,
    "계좌 불일치": AccountVerificationStatus.MISMATCH,
    비활성: AccountVerificationStatus.INACTIVE,
  };
  return map[value];
}

function accountVerificationPolicy(item: DisbursementWithRelations): BankAccountVerificationResult {
  return internalBankAccountVerificationPolicy({
    currentDisbursementStatus: item.accountVerificationStatus,
    currentVendorStatus: item.vendor.accountVerificationStatus,
    vendorActive: item.vendor.isActive && item.vendor.status === VendorStatus.ACTIVE,
  });
}

function disbursementRetryPolicy(item: DisbursementWithRelations, accountPolicy = accountVerificationPolicy(item)) {
  if (item.status !== DisbursementStatus.ERROR) {
    return {
      canRetry: false,
      code: "NOT_ERROR_STATUS",
      message: "오류 상태의 지급 건만 재처리할 수 있습니다.",
    };
  }
  if (accountPolicy.status !== AccountVerificationStatus.VERIFIED) {
    return {
      canRetry: false,
      code: accountPolicy.code,
      message: `${accountPolicy.message} 계좌 재확인 완료 후 재처리할 수 있습니다.`,
    };
  }
  return {
    canRetry: true,
    code: "RETRY_READY",
    message: "계좌 확인이 완료되어 지급 예정 상태로 되돌린 뒤 재처리할 수 있습니다.",
  };
}

function toDisbursementRow(item: DisbursementWithRelations): TableRow {
  const accountPolicy = accountVerificationPolicy(item);
  const retryPolicy = disbursementRetryPolicy(item, accountPolicy);
  const scheduleWarning = validateDisbursementScheduledDate(formatDate(item.scheduledDate));
  return {
    지급번호: item.disbursementCode,
    지급예정일: formatDate(item.scheduledDate),
    지급예정일업무일: scheduleWarning ? "불가" : "가능",
    지급일정정책: disbursementSchedulePolicyDescription,
    다음지급가능일: nextBankBusinessDate(),
    지급일정경고: scheduleWarning,
    거래처: item.vendor.name,
    은행: `${item.vendor.bankName} ${item.vendor.bankAccountMasked}`,
    계좌확인: displayAccountStatus(item.accountVerificationStatus),
    거래처계좌확인: displayAccountStatus(item.vendor.accountVerificationStatus),
    계좌검증Adapter: accountPolicy.adapter,
    계좌검증코드: accountPolicy.code,
    계좌검증사유: accountPolicy.message,
    계좌검증재시도: accountPolicy.retryable ? "가능" : "불가",
    재처리가능: retryPolicy.canRetry ? "가능" : "불가",
    재처리차단코드: retryPolicy.code,
    재처리정책: retryPolicy.message,
    금액: formatWon(item.amount),
    지급상태: displayDisbursementStatus(item.status),
    승인번호: item.paymentRequest.requestCode,
    부서: item.paymentRequest.department.name,
    담당자: item.paymentRequest.requester.name,
    rowVersion: String(item.rowVersion),
    지급RowVersion: String(item.rowVersion),
  };
}

async function findDisbursement(disbursementCode: string) {
  return prisma.disbursement.findUnique({
    where: { disbursementCode },
    include: {
      vendor: true,
      paymentRequest: {
        include: {
          approvalSteps: true,
          budgetItem: {
            include: {
              budget: true,
            },
          },
          department: true,
          requester: true,
        },
      },
    },
  });
}

function canUpdateDisbursement(user: NonNullable<Awaited<ReturnType<typeof requireAuth>>>, patch: TableRow) {
  const nextStatus = patch.지급상태;
  if (nextStatus === "지급 완료") return hasPermission(user, "disbursement:execute");
  if (nextStatus === "보류") return hasPermission(user, "disbursement:hold");
  return hasPermission(user, "disbursement:execute") || hasPermission(user, "disbursement:hold");
}

function isExecutePatch(patch: TableRow) {
  return patch.지급상태 === "지급 완료";
}

const executableDisbursementStatuses: DisbursementStatus[] = [DisbursementStatus.SCHEDULED, DisbursementStatus.DUE_TODAY, DisbursementStatus.HELD];
const holdableDisbursementStatuses: DisbursementStatus[] = [DisbursementStatus.SCHEDULED, DisbursementStatus.DUE_TODAY, DisbursementStatus.ERROR];
const bankTransferExportStatuses: DisbursementStatus[] = [DisbursementStatus.SCHEDULED, DisbursementStatus.DUE_TODAY];
const bankScheduleCutoffHourKst = 16;
const defaultBankHolidayDates = new Set([
  "2026-01-01",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-01",
  "2026-05-05",
  "2026-05-24",
  "2026-08-15",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-10-03",
  "2026-10-09",
  "2026-12-25",
]);
const disbursementSchedulePolicyDescription = `은행 영업일만 선택 가능 · 주말/휴일 제외 · KST ${bankScheduleCutoffHourKst}:00 이후 당일 변경 불가`;

function configuredBankHolidayDates() {
  const configured = (process.env.ERP_BANK_HOLIDAYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return new Set([...defaultBankHolidayDates, ...configured]);
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatDate(date) !== value ? null : date;
}

function dateOnlyInKst(now: Date) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

function currentHourInKst(now: Date) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

function isBankBusinessDate(date: Date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !configuredBankHolidayDates().has(formatDate(date));
}

function nextBankBusinessDate(from = new Date()) {
  const start = dateOnlyInKst(from);
  const candidate = new Date(start);
  if (currentHourInKst(from) >= bankScheduleCutoffHourKst) candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (!isBankBusinessDate(candidate)) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return formatDate(candidate);
}

function validateDisbursementScheduledDate(value: string, now = new Date()) {
  const date = parseDateOnly(value);
  if (!date) return "유효한 지급 예정일이 필요합니다.";
  if (!isBankBusinessDate(date)) return `지급 예정일은 은행 영업일이어야 합니다. ${disbursementSchedulePolicyDescription}`;
  const today = dateOnlyInKst(now);
  if (formatDate(date) === formatDate(today) && currentHourInKst(now) >= bankScheduleCutoffHourKst) {
    return `KST ${bankScheduleCutoffHourKst}:00 이후에는 당일 지급 예정일로 변경할 수 없습니다. 다음 가능일: ${nextBankBusinessDate(now)}`;
  }
  return "";
}

function resolveDisbursementAction(before: DisbursementWithRelations, patch: TableRow): DisbursementMutationAction {
  if (isExecutePatch(patch)) return "execute";
  if (patch.지급상태 === "보류") return "hold";
  if (patch.계좌확인 === "확인 완료") return "verify";
  if (patch.지급상태 === "지급 예정" && before.status === DisbursementStatus.ERROR) return "retry";
  if (patch.지급예정일) return "reschedule";
  return "update";
}

function validateMutationRequestControls(before: DisbursementWithRelations, patch: TableRow) {
  const idempotencyKey = patch.idempotencyKey?.trim();
  const rowVersion = Number(patch.rowVersion);
  if (!idempotencyKey) return "지급 처리에는 idempotencyKey가 필요합니다.";
  if (!Number.isInteger(rowVersion) || rowVersion !== before.rowVersion) return "지급 건이 이미 변경되었습니다. 새로고침 후 다시 시도해주세요.";
  if (!patch.지급상태 && !patch.계좌확인 && !patch.지급예정일) return "변경할 지급 항목이 필요합니다.";
  return "";
}

export function validateExecutionSeparation(before: DisbursementWithRelations, actorId: string) {
  if (before.paymentRequest.requesterId === actorId) return "요청자는 본인 결제 요청의 지급 실행 또는 지급 실행 확인을 할 수 없습니다.";
  if (before.paymentRequest.approvalSteps.some((step) => step.approverId === actorId)) {
    return "결재 승인자는 같은 건의 지급 실행 또는 지급 실행 확인을 할 수 없습니다.";
  }
  return "";
}

export function validateExecutionControls(before: DisbursementWithRelations, patch: TableRow) {
  const mutationError = validateMutationRequestControls(before, patch);
  if (mutationError) return mutationError;
  if (before.status === DisbursementStatus.COMPLETED) return "이미 지급 완료된 건은 다시 지급할 수 없습니다.";
  if (!executableDisbursementStatuses.includes(before.status)) {
    return "지급 예정, 오늘 지급, 보류 상태만 지급 실행할 수 있습니다.";
  }
  const accountPolicy = accountVerificationPolicy(before);
  if (accountPolicy.status !== AccountVerificationStatus.VERIFIED) return accountPolicy.message;
  if (before.paymentRequest.status !== PaymentRequestStatus.APPROVED) return "승인 완료된 결제 요청만 지급 실행할 수 있습니다.";
  if (before.paymentRequest.approvalSteps.length > 0 && before.paymentRequest.approvalSteps.some((step) => step.status !== ApprovalStatus.APPROVED)) {
    return "모든 결재 단계가 승인 완료되어야 지급 실행할 수 있습니다.";
  }
  if (patch.승인번호 && patch.승인번호 !== before.paymentRequest.requestCode) return "승인번호가 지급 대상과 일치하지 않습니다.";
  if (patch.거래처 && patch.거래처 !== before.vendor.name) return "거래처가 지급 대상과 일치하지 않습니다.";
  const requestedAmount = patch.금액 ? Number(patch.금액.replace(/[^\d.-]/g, "")) : Number(before.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount !== Number(before.amount)) return "지급 금액이 원장과 일치하지 않습니다.";
  return "";
}

type ExecutionApprovalRecord = {
  actorId: string;
  rowVersion: number;
};

function readExecutionApprovalRecord(log: { actorId: string; afterValue: Prisma.JsonValue | null }): ExecutionApprovalRecord | null {
  const value = log.afterValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rowVersion = Number((value as Record<string, unknown>).rowVersion);
  if (!Number.isInteger(rowVersion)) return null;
  const actorId = typeof (value as Record<string, unknown>).actorId === "string" ? String((value as Record<string, unknown>).actorId) : log.actorId;
  return { actorId, rowVersion };
}

export function validateExecutionApprovalRequirement(before: DisbursementWithRelations, executorId: string, approval: ExecutionApprovalRecord | null) {
  if (!approval) return "다른 재무 담당자의 지급 실행 2인 확인이 필요합니다.";
  if (approval.actorId === executorId) return "지급 실행 확인자와 실행자는 서로 달라야 합니다.";
  if (approval.rowVersion !== before.rowVersion) return "지급 건 변경 후 다시 지급 실행 확인이 필요합니다.";
  return "";
}

async function findExecutionApproval(before: DisbursementWithRelations, executorId: string) {
  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: "disbursement",
      entityId: before.id,
      action: executionApprovalAction,
      actorId: { not: executorId },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return logs.map(readExecutionApprovalRecord).find((record) => record?.rowVersion === before.rowVersion) ?? null;
}

export function validateDisbursementMutationControls(before: DisbursementWithRelations, patch: TableRow, action = resolveDisbursementAction(before, patch)) {
  const mutationError = validateMutationRequestControls(before, patch);
  if (mutationError) return mutationError;
  const closeError = validateDisbursementFinancialClose(before, action);
  if (closeError) return closeError;

  if (action === "hold") {
    if (!holdableDisbursementStatuses.includes(before.status)) return "지급 예정, 오늘 지급, 오류 상태만 보류할 수 있습니다.";
    if (!((patch["지급 보류 사유"] ?? patch["지급 오류 메모"] ?? "").trim())) return "지급 보류 사유가 필요합니다.";
    return "";
  }

  if (action === "retry") {
    const retryPolicy = disbursementRetryPolicy(before);
    if (!retryPolicy.canRetry) return retryPolicy.message;
    return "";
  }

  if (action === "verify") {
    if (before.status === DisbursementStatus.COMPLETED) return "지급 완료 건은 계좌 재확인으로 상태를 변경할 수 없습니다.";
    if (accountVerificationPolicy(before).code === "VENDOR_ACCOUNT_INACTIVE") return "비활성 거래처 계좌는 지급 건에서 재확인할 수 없습니다.";
    if (patch.지급상태 && patch.지급상태 !== "지급 예정") return "계좌 재확인은 지급 예정 상태 복구만 함께 처리할 수 있습니다.";
    return "";
  }

  if (action === "reschedule") {
    if (before.status === DisbursementStatus.COMPLETED) return "지급 완료 건은 지급 예정일을 변경할 수 없습니다.";
    const scheduleError = validateDisbursementScheduledDate(patch.지급예정일);
    if (scheduleError) return scheduleError;
    return "";
  }

  if (before.status === DisbursementStatus.COMPLETED) return "지급 완료 건은 관리자 복구 절차 없이 변경할 수 없습니다.";
  return "";
}

async function findIdempotencyReplay(idempotencyKey?: string) {
  if (!idempotencyKey) return null;
  return prisma.auditLog.findUnique({ where: { idempotencyKey } });
}

function escapeCsvCell(value: string | number) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function parseIsoDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function compactDateTime(value: Date) {
  return value.toISOString().replace(/\D/g, "").slice(0, 14);
}

function isAllFilter(value?: string) {
  return !value || value === "전체" || value.startsWith("전체 ");
}

function readBankTransferExportFilters(query: unknown): BankTransferExportFilters {
  const filters = readListFilters(query);
  const direct = query && typeof query === "object" && !Array.isArray(query) ? (query as Record<string, unknown>) : {};
  const readValue = (key: string) => (typeof direct[key] === "string" ? direct[key] : filters[key])?.trim();
  return {
    scheduledFrom: readValue("scheduledFrom"),
    scheduledTo: readValue("scheduledTo"),
    bank: readValue("bank") ?? readValue("은행"),
    department: readValue("department") ?? readValue("부서"),
    status: readValue("status") ?? readValue("지급상태"),
  };
}

function statusFilterToDisbursementStatus(value?: string) {
  if (isAllFilter(value)) return undefined;
  return toDisbursementStatus(value ?? "");
}

export function validateBankTransferExportCandidate(item: BankTransferExportDisbursement, decryptedAccount: string | null) {
  if (!bankTransferExportStatuses.includes(item.status)) return "지급 예정 또는 오늘 지급 상태만 이체 파일에 포함할 수 있습니다.";
  if (item.accountVerificationStatus !== AccountVerificationStatus.VERIFIED) return "지급 건 계좌 확인이 완료되어야 합니다.";
  if (item.vendor.accountVerificationStatus !== AccountVerificationStatus.VERIFIED) return "거래처 계좌 확인이 완료되어야 합니다.";
  if (!item.vendor.isActive || item.vendor.status !== VendorStatus.ACTIVE) return "활성 거래처만 이체 파일에 포함할 수 있습니다.";
  if (item.paymentRequest.status !== PaymentRequestStatus.APPROVED) return "승인 완료된 결제 요청만 이체 파일에 포함할 수 있습니다.";
  if (item.paymentRequest.approvalSteps.some((step) => step.status !== ApprovalStatus.APPROVED)) return "모든 결재 단계가 승인 완료되어야 합니다.";
  if (!decryptedAccount) return "복호화 가능한 거래처 계좌번호가 필요합니다.";
  return "";
}

function normalizeBankResultStatus(value: unknown): BankResultInput["status"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "OK", "PAID", "완료", "성공"].includes(normalized)) return "SUCCESS";
  if (["FAILED", "FAIL", "ERROR", "REJECTED", "오류", "실패", "반려"].includes(normalized)) return "FAILED";
  return null;
}

function parseBankResultAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function readBankResultRows(body: unknown): BankResultInput[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const rows = Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const source = row as Record<string, unknown>;
    const disbursementCode = String(source.disbursementCode ?? source.지급번호 ?? "").trim();
    const status = normalizeBankResultStatus(source.status ?? source.상태 ?? source.은행결과);
    const amount = parseBankResultAmount(source.amount ?? source.금액);
    if (!disbursementCode || !status || !Number.isFinite(amount)) return [];
    return [{
      disbursementCode,
      approvalCode: String(source.approvalCode ?? source.승인번호 ?? "").trim() || undefined,
      amount,
      status,
      bankResultId: String(source.bankResultId ?? source.은행처리번호 ?? "").trim() || undefined,
      message: String(source.message ?? source.메시지 ?? source.사유 ?? "").trim() || undefined,
    }];
  });
}

function bankResultJson(row: BankResultInput) {
  return {
    disbursementCode: row.disbursementCode,
    approvalCode: row.approvalCode ?? "",
    amount: row.amount,
    status: row.status,
    bankResultId: row.bankResultId ?? "",
    message: row.message ?? "",
  };
}

export function validateBankResultReconciliation(item: DisbursementWithRelations, result: BankResultInput) {
  if (item.disbursementCode !== result.disbursementCode) return "지급번호가 일치하지 않습니다.";
  if (item.status !== DisbursementStatus.COMPLETED) return "ERP에서 지급 완료 처리된 건만 은행 결과와 대사할 수 있습니다.";
  if (result.approvalCode && result.approvalCode !== item.paymentRequest.requestCode) return "승인번호가 ERP 지급 건과 일치하지 않습니다.";
  if (result.amount !== Number(item.amount)) return "은행 결과 금액이 ERP 지급 금액과 일치하지 않습니다.";
  if (!["SUCCESS", "FAILED"].includes(result.status)) return "은행 결과 상태가 유효하지 않습니다.";
  return "";
}

function buildBankTransferCsv(rows: BankTransferExportRow[]) {
  const columns = ["지급번호", "승인번호", "지급예정일", "거래처", "사업자번호", "은행", "계좌번호", "금액", "요청부서", "요청자"] as const;
  return [
    columns.map(escapeCsvCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(",")),
  ].join("\r\n");
}

export function buildBankTransferExportSummary(rows: BankTransferExportRow[], filters: BankTransferExportFilters = {}, generatedAt = new Date()) {
  const vendorKeys = new Set(rows.map((row) => `${row.거래처}|${row.사업자번호}`));
  const accountVerifiedCount = rows.filter((row) => row.계좌확인 === "확인 완료" && row.거래처계좌확인 === "확인 완료").length;
  const approvalVerifiedCount = rows.filter((row) => row.결재상태 === "승인 완료" && row.결재단계확인 === "확인 완료").length;
  return {
    targetCount: rows.length,
    exportedCount: rows.length,
    blockedCount: 0,
    totalAmount: rows.reduce((sum, row) => sum + Number(row.금액), 0),
    vendorCount: vendorKeys.size,
    accountVerifiedCount,
    disbursementAccountVerifiedCount: rows.filter((row) => row.계좌확인 === "확인 완료").length,
    vendorAccountVerifiedCount: rows.filter((row) => row.거래처계좌확인 === "확인 완료").length,
    approvalVerifiedCount,
    scheduledCount: rows.filter((row) => row.지급상태 === "지급 예정").length,
    dueTodayCount: rows.filter((row) => row.지급상태 === "오늘 지급").length,
    scheduledFrom: filters.scheduledFrom ?? "",
    scheduledTo: filters.scheduledTo ?? "",
    bank: filters.bank ?? "",
    department: filters.department ?? "",
    status: filters.status ?? "",
    generatedAt: generatedAt.toISOString(),
    disbursementCodes: rows.map((row) => row.지급번호),
    reconciliationRows: rows.map((row) => ({
      disbursementCode: row.지급번호,
      approvalCode: row.승인번호,
      scheduledDate: row.지급예정일,
      vendor: row.거래처,
      businessNumber: row.사업자번호,
      bank: row.은행,
      amount: row.금액,
      department: row.요청부서,
      requester: row.요청자,
      disbursementStatus: row.지급상태,
      accountVerificationStatus: row.계좌확인,
      vendorAccountVerificationStatus: row.거래처계좌확인,
      approvalStatus: row.결재상태,
      approvalStepStatus: row.결재단계확인,
    })),
  };
}

export const disbursementRoutes: FastifyPluginAsync = async (app) => {
  app.get("/disbursements", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "disbursement:read")) {
      return fail(reply, "FORBIDDEN", "지급 목록 조회 권한이 없습니다.", 403);
    }

    const parsed = listQuerySchema.parse(request.query);
    const items = await prisma.disbursement.findMany({
      include: {
        vendor: true,
        paymentRequest: {
          include: {
            approvalSteps: true,
            budgetItem: {
              include: {
                budget: true,
              },
            },
            department: true,
            requester: true,
          },
        },
      },
      orderBy: { scheduledDate: "asc" },
    });
    const rows = filterAndSortRows(items.map(toDisbursementRow), {
      ...parsed,
      filters: readListFilters(request.query),
    });

    return reply.send(success(request, paginateRows(rows, parsed)));
  });

  app.get("/disbursements/bank-transfer-export", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "disbursement:execute")) {
      return fail(reply, "FORBIDDEN", "은행 이체 파일 생성 권한이 없습니다.", 403);
    }

    const filters = readBankTransferExportFilters(request.query);
    const scheduledFrom = parseIsoDate(filters.scheduledFrom);
    const scheduledTo = parseIsoDate(filters.scheduledTo);
    const requestedStatus = statusFilterToDisbursementStatus(filters.status);
    const statuses = requestedStatus && bankTransferExportStatuses.includes(requestedStatus) ? [requestedStatus] : requestedStatus ? [] : bankTransferExportStatuses;
    if (requestedStatus && statuses.length === 0) {
      return fail(reply, "NO_EXPORTABLE_DISBURSEMENTS", "선택한 지급 상태에는 은행 이체 파일 대상이 없습니다.", 409);
    }

    const where: Prisma.DisbursementWhereInput = {
      status: { in: statuses },
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      vendor: {
        accountVerificationStatus: AccountVerificationStatus.VERIFIED,
        isActive: true,
        status: VendorStatus.ACTIVE,
        ...(isAllFilter(filters.bank) ? {} : { bankName: filters.bank }),
      },
      paymentRequest: {
        status: PaymentRequestStatus.APPROVED,
        ...(isAllFilter(filters.department)
          ? {}
          : {
              department: {
                name: filters.department,
              },
            }),
      },
      ...(scheduledFrom || scheduledTo
        ? {
            scheduledDate: {
              ...(scheduledFrom ? { gte: scheduledFrom } : {}),
              ...(scheduledTo ? { lte: scheduledTo } : {}),
            },
          }
        : {}),
    };

    const candidates = await prisma.disbursement.findMany({
      where,
      include: {
        vendor: true,
        paymentRequest: {
          include: {
            approvalSteps: true,
            department: true,
            requester: true,
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { disbursementCode: "asc" }],
    });

    const rows: BankTransferExportRow[] = [];
    const blocked: string[] = [];
    for (const item of candidates) {
      const decryptedAccount = decryptBankAccount(item.vendor.bankAccountEncrypted);
      const error = validateBankTransferExportCandidate(item, decryptedAccount);
      if (error) {
        blocked.push(`${item.disbursementCode}: ${error}`);
        continue;
      }
      rows.push({
        지급번호: item.disbursementCode,
        승인번호: item.paymentRequest.requestCode,
        지급예정일: formatDate(item.scheduledDate),
        거래처: item.vendor.name,
        사업자번호: item.vendor.businessNumber,
        은행: item.vendor.bankName,
        계좌번호: decryptedAccount ?? "",
        금액: Number(item.amount),
        요청부서: item.paymentRequest.department.name,
        요청자: item.paymentRequest.requester.name,
        지급상태: displayDisbursementStatus(item.status),
        계좌확인: displayAccountStatus(item.accountVerificationStatus),
        거래처계좌확인: displayAccountStatus(item.vendor.accountVerificationStatus),
        결재상태: "승인 완료",
        결재단계확인: item.paymentRequest.approvalSteps.every((step) => step.status === ApprovalStatus.APPROVED) ? "확인 완료" : "확인 필요",
      });
    }

    if (blocked.length > 0) {
      return fail(reply, "BANK_TRANSFER_EXPORT_BLOCKED", `이체 파일 생성 차단: ${blocked.slice(0, 3).join(" / ")}`, 409);
    }
    if (rows.length === 0) {
      return fail(reply, "NO_EXPORTABLE_DISBURSEMENTS", "현재 조건에 맞는 은행 이체 파일 대상이 없습니다.", 409);
    }

    const generatedAt = new Date();
    const summary = buildBankTransferExportSummary(rows, filters, generatedAt);

    await prisma.auditLog.create({
      data: {
        entityType: "disbursement_export",
        entityId: user.id,
        actorId: user.id,
        action: "bank_transfer_export",
        beforeValue: undefined,
        afterValue: summary as Prisma.InputJsonObject,
        reason: "은행 이체 파일 생성",
        ...auditRequestContext(request),
      },
    });

    return reply.send(success(request, {
      fileName: `bank-transfer-${compactDateTime(generatedAt)}.csv`,
      contentType: "text/csv;charset=utf-8",
      csv: buildBankTransferCsv(rows),
      summary,
    }));
  });

  app.post("/disbursements/bank-result-reconcile", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "disbursement:execute")) {
      return fail(reply, "FORBIDDEN", "은행 결과 대사 권한이 없습니다.", 403);
    }

    const body = request.body && typeof request.body === "object" ? (request.body as { idempotencyKey?: unknown; rows?: unknown }) : {};
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : undefined;
    if (!idempotencyKey) return fail(reply, "VALIDATION_ERROR", "은행 결과 대사에는 idempotencyKey가 필요합니다.", 400);

    const replay = await findIdempotencyReplay(idempotencyKey);
    if (replay) {
      if (replay.entityType === "disbursement_bank_result" && replay.action === "bank_result_reconcile") {
        return reply.send(success(request, replay.afterValue, { idempotencyReplay: true }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }

    const resultRows = readBankResultRows(request.body);
    if (resultRows.length === 0) return fail(reply, "VALIDATION_ERROR", "대사할 은행 결과 행이 필요합니다.", 400);

    const items = await prisma.disbursement.findMany({
      where: {
        disbursementCode: { in: resultRows.map((row) => row.disbursementCode) },
      },
      include: {
        vendor: true,
        paymentRequest: {
          include: {
            approvalSteps: true,
            budgetItem: {
              include: {
                budget: true,
              },
            },
            department: true,
            requester: true,
          },
        },
      },
    });
    const itemByCode = new Map(items.map((item) => [item.disbursementCode, item]));
    const rows = resultRows.map((result) => {
      const item = itemByCode.get(result.disbursementCode);
      if (!item) {
        return { ...bankResultJson(result), outcome: "MISMATCH", message: "ERP 지급 건을 찾을 수 없습니다." };
      }
      const error = validateBankResultReconciliation(item, result);
      if (error) return { ...bankResultJson(result), outcome: "MISMATCH", message: error };
      return {
        ...bankResultJson(result),
        outcome: result.status === "SUCCESS" ? "MATCHED" : "BANK_FAILED",
        message: result.message ?? (result.status === "SUCCESS" ? "은행 지급 성공 대사 완료" : "은행 지급 실패 결과 반영"),
      };
    });
    const mismatches = rows.filter((row) => row.outcome === "MISMATCH");
    if (mismatches.length > 0) {
      return fail(reply, "BANK_RESULT_RECONCILE_MISMATCH", `은행 결과 대사 불일치: ${mismatches.slice(0, 3).map((row) => `${row.disbursementCode} ${row.message}`).join(" / ")}`, 409);
    }

    const summary = await prisma.$transaction(async (tx) => {
      for (const row of rows.filter((item) => item.outcome === "BANK_FAILED")) {
        const item = itemByCode.get(row.disbursementCode);
        if (!item) continue;
        await tx.disbursement.update({
          where: { id: item.id },
          data: {
            status: DisbursementStatus.ERROR,
            rowVersion: { increment: 1 },
          },
        });
      }

      const afterRows = await tx.disbursement.findMany({
        where: {
          disbursementCode: { in: rows.map((row) => row.disbursementCode) },
        },
        include: {
          vendor: true,
          paymentRequest: {
            include: {
              approvalSteps: true,
              budgetItem: {
                include: {
                  budget: true,
                },
              },
              department: true,
              requester: true,
            },
          },
        },
        orderBy: { disbursementCode: "asc" },
      });
      const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
      const payload = {
        targetCount: rows.length,
        matchedCount: rows.filter((row) => row.outcome === "MATCHED").length,
        bankFailedCount: rows.filter((row) => row.outcome === "BANK_FAILED").length,
        mismatchCount: 0,
        totalAmount,
        reconciledAt: new Date().toISOString(),
        rows,
        afterRows: afterRows.map(toDisbursementRow),
      };

      await tx.auditLog.create({
        data: {
          entityType: "disbursement_bank_result",
          entityId: user.id,
          actorId: user.id,
          action: "bank_result_reconcile",
          beforeValue: {
            rows: resultRows.map(bankResultJson),
          },
          afterValue: payload as Prisma.InputJsonObject,
          reason: "은행 결과 파일 대사",
          idempotencyKey,
          ...auditRequestContext(request),
        },
      });

      return payload;
    });

    return reply.send(success(request, summary));
  });

  app.get("/disbursements/:disbursementCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "disbursement:read")) {
      return fail(reply, "FORBIDDEN", "지급 상세 조회 권한이 없습니다.", 403);
    }

    const params = request.params as { disbursementCode: string };
    const item = await findDisbursement(params.disbursementCode);
    return reply.send(success(request, item ? toDisbursementRow(item) : null));
  });

  app.patch("/disbursements/:disbursementCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const patch = readStringPatch(request.body);
    if (!canUpdateDisbursement(user, patch)) {
      return fail(reply, "FORBIDDEN", "지급 처리 권한이 없습니다.", 403);
    }

    const params = request.params as { disbursementCode: string };
    const before = await findDisbursement(params.disbursementCode);
    if (!before) return reply.send(success(request, null));

    const executing = isExecutePatch(patch);
    const workflowAction = resolveDisbursementAction(before, patch);
    const idempotencyKey = patch.idempotencyKey?.trim() || undefined;
    const replay = await findIdempotencyReplay(idempotencyKey);
    if (replay) {
      if (replay.entityType === "disbursement" && replay.entityId === before.id && replay.action === workflowAction) {
        return reply.send(success(request, toDisbursementRow(before), { idempotencyReplay: true, rowVersion: before.rowVersion }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }

    if (executing) {
      const controlError = validateExecutionControls(before, patch);
      if (controlError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", controlError, 409);
      const separationError = validateExecutionSeparation(before, user.id);
      if (separationError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", separationError, 409);
      const approvalError = validateExecutionApprovalRequirement(before, user.id, await findExecutionApproval(before, user.id));
      if (approvalError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", approvalError, 409);
    } else if (workflowAction === "update" && before.status === DisbursementStatus.COMPLETED && !hasPermission(user, "system:manage")) {
      return fail(reply, "WORKFLOW_LOCKED", "지급 완료 건은 관리자 복구 절차 없이 변경할 수 없습니다.", 409);
    } else if (before.status === DisbursementStatus.COMPLETED && !hasPermission(user, "system:manage")) {
      const controlError = validateDisbursementMutationControls(before, patch, workflowAction);
      if (controlError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", controlError, 409);
    } else {
      const controlError = validateDisbursementMutationControls(before, patch, workflowAction);
      if (controlError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", controlError, 409);
    }

    let bankVerificationResult: BankAccountVerificationResult | null = null;
    if (workflowAction === "verify") {
      bankVerificationResult = await verifyBankAccount({
        bankName: before.vendor.bankName,
        accountEncrypted: before.vendor.bankAccountEncrypted,
        accountHolder: before.vendor.name,
        businessNumber: before.vendor.businessNumber,
        disbursementCode: before.disbursementCode,
        currentDisbursementStatus: before.accountVerificationStatus,
        currentVendorStatus: before.vendor.accountVerificationStatus,
        vendorActive: before.vendor.isActive && before.vendor.status === VendorStatus.ACTIVE,
      });
      if (bankVerificationResult.status !== AccountVerificationStatus.VERIFIED) {
        return fail(reply, "BANK_ACCOUNT_VERIFICATION_FAILED", bankVerificationResult.message, 409);
      }
    }

    const data: Prisma.DisbursementUpdateInput = {
      rowVersion: { increment: 1 },
    };
    if (patch.지급상태) {
      const status = toDisbursementStatus(patch.지급상태);
      if (!status) return fail(reply, "VALIDATION_ERROR", "지원하지 않는 지급 상태입니다.", 400);
      data.status = status;
      if (status === DisbursementStatus.COMPLETED) data.executedAt = new Date();
    }
    if (patch.계좌확인) {
      const accountStatus = toAccountStatus(patch.계좌확인);
      if (!accountStatus) return fail(reply, "VALIDATION_ERROR", "지원하지 않는 계좌 확인 상태입니다.", 400);
      data.accountVerificationStatus = accountStatus;
    }
    if (patch.지급예정일) {
      const scheduledDate = parseDateOnly(patch.지급예정일);
      if (!scheduledDate) return fail(reply, "VALIDATION_ERROR", "유효한 지급 예정일이 필요합니다.", 400);
      data.scheduledDate = scheduledDate;
    }

    let updated: DisbursementWithRelations;
    try {
      updated = await prisma.$transaction(async (tx) => {
        if (executing) {
          const result = await tx.disbursement.updateMany({
            where: {
              id: before.id,
              rowVersion: Number(patch.rowVersion),
              status: { in: executableDisbursementStatuses },
              accountVerificationStatus: AccountVerificationStatus.VERIFIED,
            },
            data: {
              status: DisbursementStatus.COMPLETED,
              executedAt: new Date(),
              rowVersion: { increment: 1 },
            },
          });
          if (result.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
        } else {
          const result = await tx.disbursement.updateMany({
            where: {
              id: before.id,
              rowVersion: Number(patch.rowVersion),
            },
            data,
          });
          if (result.count !== 1) throw new Error("ROW_VERSION_CONFLICT");
          if (workflowAction === "verify") {
            await tx.vendor.update({
              where: { id: before.vendorId },
              data: {
                accountVerificationStatus: AccountVerificationStatus.VERIFIED,
                rowVersion: { increment: 1 },
              },
            });
          }
        }
        const item = await tx.disbursement.findUniqueOrThrow({
          where: { id: before.id },
          include: {
            vendor: true,
            paymentRequest: {
              include: {
                approvalSteps: true,
                budgetItem: {
                  include: {
                    budget: true,
                  },
                },
                department: true,
                requester: true,
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            entityType: "disbursement",
            entityId: before.id,
            actorId: user.id,
            action: workflowAction,
            beforeValue: jsonRow(toDisbursementRow(before)),
            afterValue: jsonRow(toDisbursementRow(item)),
            reason: patch["지급 보류 사유"] ?? patch["지급 오류 메모"] ?? bankVerificationResult?.message ?? undefined,
            idempotencyKey,
            ...auditRequestContext(request),
          },
        });
        if (executing) {
          await tx.notification.create({
            data: {
              userId: before.paymentRequest.requesterId,
              type: NotificationType.DISBURSEMENT_COMPLETED,
              title: "지급 완료",
              message: `${before.disbursementCode} 지급이 완료되었습니다.`,
              entityType: "DISBURSEMENT",
              entityId: before.disbursementCode,
              linkPath: "#disbursement",
              expiresAt: notificationExpiresAt(),
            },
          });
        }
        return item;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "ROW_VERSION_CONFLICT") {
        return fail(reply, "CONFLICT", "지급 건이 이미 변경되었습니다. 새로고침 후 다시 시도해주세요.", 409);
      }
      throw error;
    }

    return reply.send(success(request, toDisbursementRow(updated), { rowVersion: updated.rowVersion }));
  });

  app.post("/disbursements/:disbursementCode/execution-approval", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "disbursement:execute")) {
      return fail(reply, "FORBIDDEN", "지급 실행 확인 권한이 없습니다.", 403);
    }

    const params = request.params as { disbursementCode: string };
    const before = await findDisbursement(params.disbursementCode);
    if (!before) return reply.send(success(request, null));

    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown; rowVersion?: unknown }) : {};
    const patch: TableRow = {
      ...readStringPatch(body.patch),
      지급상태: "지급 완료",
      ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
      ...(typeof body.rowVersion === "string" || typeof body.rowVersion === "number" ? { rowVersion: String(body.rowVersion) } : {}),
      ...(typeof body.reason === "string" && body.reason ? { "지급 실행 확인 사유": body.reason } : {}),
    };
    const idempotencyKey = patch.idempotencyKey?.trim() || undefined;
    const replay = await findIdempotencyReplay(idempotencyKey);
    if (replay) {
      if (replay.entityType === "disbursement" && replay.entityId === before.id && replay.action === executionApprovalAction) {
        return reply.send(success(request, toDisbursementRow(before), { idempotencyReplay: true, executionApproved: true, rowVersion: before.rowVersion }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }

    const controlError = validateExecutionControls(before, patch);
    if (controlError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", controlError, 409);
    const separationError = validateExecutionSeparation(before, user.id);
    if (separationError) return fail(reply, "DISBURSEMENT_CONTROL_FAILED", separationError, 409);

    await prisma.auditLog.create({
      data: {
        entityType: "disbursement",
        entityId: before.id,
        actorId: user.id,
        action: executionApprovalAction,
        beforeValue: jsonRow(toDisbursementRow(before)),
        afterValue: {
          actorId: user.id,
          actorName: user.name,
          disbursementCode: before.disbursementCode,
          rowVersion: before.rowVersion,
          amount: Number(before.amount),
          vendorName: before.vendor.name,
          accountVerificationStatus: displayAccountStatus(before.accountVerificationStatus),
          approvedAt: new Date().toISOString(),
        },
        reason: patch["지급 실행 확인 사유"] ?? "지급 실행 2인 확인",
        idempotencyKey,
        ...auditRequestContext(request),
      },
    });

    return reply.send(success(request, toDisbursementRow(before), { executionApproved: true, rowVersion: before.rowVersion }));
  });

  app.post("/disbursements/:disbursementCode/:action", async (request, reply) => {
    const params = request.params as { disbursementCode: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown; rowVersion?: unknown }) : {};
    const bodyPatch = readStringPatch(body.patch);
    const actionPatch: Record<string, TableRow> = {
      execute: { 지급상태: "지급 완료" },
      hold: { 지급상태: "보류" },
      retry: { 지급상태: "지급 예정" },
      verify: { 계좌확인: "확인 완료", 지급상태: "지급 예정" },
    };
    const patch: TableRow = {
      ...bodyPatch,
      ...(actionPatch[params.action] ?? {}),
      ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
      ...(typeof body.rowVersion === "string" || typeof body.rowVersion === "number" ? { rowVersion: String(body.rowVersion) } : {}),
      ...(typeof body.reason === "string" && body.reason ? { "지급 오류 메모": body.reason } : {}),
    };

    return app.inject({
      method: "PATCH",
      url: `/api/disbursements/${encodeURIComponent(params.disbursementCode)}`,
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: patch,
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};
