import type { FastifyPluginAsync } from "fastify";
import { AccountVerificationStatus, ApprovalStatus, BudgetStatus, NotificationType, PaymentRequestStatus, type Prisma } from "../../generated/prisma/index.js";
import { z } from "zod";
import { hasPermission, requireAuth } from "../auth/session.js";
import { validatePaymentSubmitFinancialClose } from "../controls/financialClose.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { fail, success } from "../utils/response.js";
import { auditRequestContext, definedCookies, formatDate, formatWon, forwardableHeaders, jsonRow, parseWon, readStringPatch, type TableRow } from "./rowUtils.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  sort: z.string().optional(),
});

function displayStatus(status: string) {
  const map: Record<string, string> = {
    DRAFT: "임시 저장",
    SUBMITTED: "제출",
    APPROVAL_PENDING: "승인 대기",
    APPROVAL_IN_PROGRESS: "승인 진행 중",
    APPROVED: "승인 완료",
    REJECTED: "반려",
    HELD: "보류",
  };
  return map[status] ?? status;
}

function toPaymentRequestStatus(value: string) {
  const map: Record<string, PaymentRequestStatus> = {
    "임시 저장": PaymentRequestStatus.DRAFT,
    제출: PaymentRequestStatus.SUBMITTED,
    "승인 대기": PaymentRequestStatus.APPROVAL_PENDING,
    "승인 진행 중": PaymentRequestStatus.APPROVAL_IN_PROGRESS,
    "승인 완료": PaymentRequestStatus.APPROVED,
    반려: PaymentRequestStatus.REJECTED,
    보류: PaymentRequestStatus.HELD,
  };
  return map[value];
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

function displayAccountStatus(status: AccountVerificationStatus) {
  const map: Record<AccountVerificationStatus, string> = {
    VERIFIED: "확인 완료",
    PENDING: "검증 대기",
    MISMATCH: "계좌 불일치",
    INACTIVE: "비활성",
  };
  return map[status];
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((permission): permission is string => typeof permission === "string");
}

function canUsePaymentMasterData(user: NonNullable<Awaited<ReturnType<typeof requireAuth>>>) {
  return canReadPaymentRequests(user) || hasPermission(user, "payment_request:create") || hasPermission(user, "payment_request:update_own");
}

function hasApprovalPermission(permissions: Set<string>) {
  return permissions.has("*") || permissions.has("approval:act") || permissions.has("system:manage");
}

const approvalPolicySettingId = "91000000-0000-4000-8000-000000000001";

function defaultApprovalStepCount(amount: unknown) {
  return Number(amount) > 10_000_000 ? 3 : 2;
}

function readNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function approvalStepCountFromPolicy(amount: unknown, policy: unknown) {
  const amountValue = readNumber(amount);
  if (amountValue === null || !policy || typeof policy !== "object" || Array.isArray(policy)) return defaultApprovalStepCount(amount);
  const limits = Array.isArray((policy as { approvalLimits?: unknown }).approvalLimits) ? (policy as { approvalLimits: unknown[] }).approvalLimits : [];
  const matchedLimit = limits.find((limit) => {
    if (!limit || typeof limit !== "object" || Array.isArray(limit)) return false;
    const source = limit as Record<string, unknown>;
    if (source.status && source.status !== "활성") return false;
    const min = readNumber(source.min) ?? 0;
    const max = source.max === null || source.max === undefined ? null : readNumber(source.max);
    return amountValue >= min && (max === null || amountValue <= max);
  });
  if (!matchedLimit || typeof matchedLimit !== "object" || Array.isArray(matchedLimit)) return defaultApprovalStepCount(amount);
  const requiredApprovers = readNumber((matchedLimit as Record<string, unknown>).requiredApprovers);
  if (requiredApprovers === null) return defaultApprovalStepCount(amount);
  return Math.max(1, Math.min(8, Math.trunc(requiredApprovers)));
}

async function approvalStepCount(tx: Prisma.TransactionClient, amount: unknown) {
  const latestPolicy = await tx.auditLog.findFirst({
    where: { entityType: "system_setting", entityId: approvalPolicySettingId },
    orderBy: { createdAt: "desc" },
  });
  return approvalStepCountFromPolicy(amount, latestPolicy?.afterValue);
}

type ApprovalCandidateUser = Prisma.UserGetPayload<{
  include: {
    department: true;
    roles: {
      include: {
        role: true;
      };
    };
  };
}>;

function toApprovalCandidate(candidate: ApprovalCandidateUser, excludeUserId?: string) {
  if (candidate.id === excludeUserId) return null;
  const activeRoles = candidate.roles.map(({ role }) => role).filter((role) => role.isActive);
  const permissions = new Set(activeRoles.flatMap((role) => normalizePermissions(role.permissions)));
  if (!hasApprovalPermission(permissions)) return null;
  const primaryRole = activeRoles.find((role) => normalizePermissions(role.permissions).some((permission) => ["*", "approval:act", "system:manage"].includes(permission))) ?? activeRoles[0];
  return {
    id: candidate.id,
    name: candidate.name,
    departmentName: candidate.department.name,
    roleLabel: primaryRole?.name ?? "승인자",
  };
}

async function nextRequestCode(tx: Prisma.TransactionClient) {
  const prefix = `PR-${new Date().getFullYear()}-`;
  const existingCount = await tx.paymentRequest.count({ where: { requestCode: { startsWith: prefix } } });
  for (let offset = 1; offset < 1000; offset += 1) {
    const code = `${prefix}${String(existingCount + offset).padStart(4, "0")}`;
    const existing = await tx.paymentRequest.findUnique({ where: { requestCode: code } });
    if (!existing) return code;
  }
  throw new Error("REQUEST_CODE_EXHAUSTED");
}

async function firstBudgetItemForDepartment(tx: Prisma.TransactionClient, departmentId: string) {
  const budget = await tx.budget.findFirst({
    where: { departmentId, status: { not: BudgetStatus.CLOSED } },
    include: { items: { where: { status: { not: BudgetStatus.CLOSED } }, orderBy: { name: "asc" } } },
    orderBy: { fiscalYear: "desc" },
  });
  return budget?.items[0] ?? null;
}

async function ensurePendingApprovalSteps(
  tx: Prisma.TransactionClient,
  item: { id: string; requestCode: string; requesterId: string; amount: unknown; reason: string },
) {
  const existingCount = await tx.approvalStep.count({ where: { paymentRequestId: item.id } });
  if (existingCount > 0) return existingCount;

  const users = await tx.user.findMany({
    where: { isActive: true },
    include: {
      department: true,
      roles: {
        include: {
          role: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const requiredApproverCount = await approvalStepCount(tx, item.amount);
  const eligibleCandidates = users.flatMap((candidate) => {
    const mapped = toApprovalCandidate(candidate, item.requesterId);
    return mapped ? [mapped] : [];
  });

  // 결재선 후보가 아예 없으면 승인 자체가 불가능하므로 막는다.
  if (eligibleCandidates.length === 0) throw new Error("APPROVAL_CANDIDATES_NOT_FOUND");
  // 정책상 필요한 결재 인원보다 후보가 적으면(예: 요청자가 유일한 승인자와 겹치는 경우)
  // 제출이 영구히 막히지 않도록 확보 가능한 후보 수만큼으로 단계를 구성한다.
  const candidates = eligibleCandidates.slice(0, Math.max(1, Math.min(requiredApproverCount, eligibleCandidates.length)));

  await tx.approvalStep.createMany({
    data: candidates.map((candidate, index) => ({
      paymentRequestId: item.id,
      stepOrder: index + 1,
      approverId: candidate.id,
      status: ApprovalStatus.PENDING,
    })),
  });
  await tx.notification.createMany({
    data: candidates.map((candidate) => ({
      userId: candidate.id,
      type: NotificationType.APPROVAL_REQUESTED,
      title: "승인 요청",
      message: `${item.requestCode} ${item.reason} 결재가 배정되었습니다.`,
      entityType: "PAYMENT_REQUEST",
      entityId: item.requestCode,
      linkPath: "#approval",
      expiresAt: notificationExpiresAt(),
    })),
  });

  return candidates.length;
}

async function countReadyAttachments(tx: Prisma.TransactionClient, paymentRequestId: string) {
  return tx.attachment.count({
    where: {
      ownerType: "PAYMENT_REQUEST",
      ownerId: paymentRequestId,
      NOT: [
        { checksum: "pending" },
        { checksum: { startsWith: "blocked:" } },
      ],
    },
  });
}

function readPaymentAttachmentIds(body: unknown) {
  const rawValues: string[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value !== "string") return;
    value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => rawValues.push(item));
  };

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const source = body as Record<string, unknown>;
    collect(source.attachmentIds);
    collect(source["첨부파일ID"]);
    collect(source["첨부파일IDs"]);
    collect(source["첨부 파일 ID"]);
  }

  const uniqueIds = [...new Set(rawValues)];
  const invalidId = uniqueIds.find((id) => !z.string().uuid().safeParse(id).success);
  if (invalidId) throw new Error("INVALID_ATTACHMENT_ID");
  return uniqueIds;
}

async function linkPaymentAttachments(tx: Prisma.TransactionClient, item: { id: string }, userId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return 0;

  const attachments = await tx.attachment.findMany({
    where: {
      id: { in: attachmentIds },
      ownerType: "PAYMENT_REQUEST",
      uploadedBy: userId,
    },
    select: {
      id: true,
      ownerId: true,
      checksum: true,
    },
  });
  if (attachments.length !== attachmentIds.length) throw new Error("ATTACHMENT_NOT_FOUND");
  if (attachments.some((attachment) => attachment.checksum === "pending")) throw new Error("ATTACHMENT_NOT_READY");
  if (attachments.some((attachment) => attachment.checksum.startsWith("blocked:"))) throw new Error("ATTACHMENT_BLOCKED");
  if (attachments.some((attachment) => attachment.ownerId !== item.id)) throw new Error("ATTACHMENT_OWNER_MISMATCH");

  const result = await tx.attachment.updateMany({
    where: {
      id: { in: attachmentIds },
      ownerType: "PAYMENT_REQUEST",
      ownerId: item.id,
      uploadedBy: userId,
    },
    data: {
      ownerType: "PAYMENT_REQUEST",
      ownerId: item.id,
    },
  });
  return result.count;
}

async function assertSubmitReady(tx: Prisma.TransactionClient, item: { id: string; status: PaymentRequestStatus }) {
  if (item.status !== PaymentRequestStatus.SUBMITTED && item.status !== PaymentRequestStatus.APPROVAL_PENDING) return;
  const submitScope = await tx.paymentRequest.findUnique({
    where: { id: item.id },
    include: {
      budgetItem: {
        include: {
          budget: true,
        },
      },
    },
  });
  const closeError = validatePaymentSubmitFinancialClose(submitScope ?? item);
  if (closeError) throw new Error("CLOSED_PERIOD_SUBMISSION");
  const readyAttachmentCount = await countReadyAttachments(tx, item.id);
  if (readyAttachmentCount === 0) throw new Error("ATTACHMENT_REQUIRED");
}

type PaymentRequestWithRelations = Prisma.PaymentRequestGetPayload<{
  include: {
    department: true;
    requester: true;
    vendor: true;
  };
}>;

function toPaymentRequestRow(item: PaymentRequestWithRelations): TableRow {
  return {
    요청번호: item.requestCode,
    요청일: formatDate(item.requestedAt),
    거래처: item.vendor.name,
    요청자: item.requester.name,
    부서: item.department.name,
    금액: formatWon(item.amount),
    상태: displayStatus(item.status),
    "요청 사유": item.reason,
    예산항목ID: item.budgetItemId ?? "",
    rowVersion: String(item.rowVersion),
    요청RowVersion: String(item.rowVersion),
  };
}

function toPaymentRequestAuditValue(item: PaymentRequestWithRelations, attachmentIds: string[], linkedAttachmentCount: number) {
  const value: Record<string, unknown> = toPaymentRequestRow(item);
  if (attachmentIds.length > 0) {
    value.첨부파일ID = attachmentIds;
    value.첨부파일수 = linkedAttachmentCount;
  }
  return value as Prisma.InputJsonObject;
}

async function buildPaymentRequestUpdateData(patch: TableRow) {
  const data: Prisma.PaymentRequestUpdateInput = {
    rowVersion: { increment: 1 },
  };

  const status = patch.상태 ? toPaymentRequestStatus(patch.상태) : undefined;
  if (patch.상태 && !status) {
    throw new Error("INVALID_STATUS");
  }
  if (status) data.status = status;

  const amount = parseWon(patch.금액);
  if (amount !== undefined) data.amount = amount;

  if (patch["요청 사유"]) data.reason = patch["요청 사유"];
  if (patch.요청일) data.requestedAt = new Date(patch.요청일);

  if (patch.거래처) {
    const vendor = await prisma.vendor.findFirst({ where: { name: patch.거래처 } });
    if (!vendor) throw new Error("VENDOR_NOT_FOUND");
    data.vendor = { connect: { id: vendor.id } };
  }

  if (patch.부서) {
    const department = await prisma.department.findFirst({ where: { name: patch.부서 } });
    if (!department) throw new Error("DEPARTMENT_NOT_FOUND");
    data.department = { connect: { id: department.id } };
  }

  if ("예산항목ID" in patch) {
    const budgetItemId = patch.예산항목ID.trim();
    if (budgetItemId) {
      const budgetItem = await prisma.budgetItem.findUnique({
        where: { id: budgetItemId },
        include: { budget: { include: { department: true } } },
      });
      if (!budgetItem) throw new Error("BUDGET_ITEM_NOT_FOUND");
      if (patch.부서 && budgetItem.budget.department.name !== patch.부서) throw new Error("BUDGET_ITEM_DEPARTMENT_MISMATCH");
      data.budgetItem = { connect: { id: budgetItem.id } };
    } else {
      data.budgetItem = { disconnect: true };
    }
  }

  return data;
}

function paymentMutationRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function readPaymentIdempotencyKey(body: unknown) {
  const value = paymentMutationRecord(body).idempotencyKey;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPaymentExpectedRowVersion(body: unknown, patch: TableRow) {
  const record = paymentMutationRecord(body);
  const value = record.rowVersion ?? record.요청RowVersion ?? patch.rowVersion ?? patch.요청RowVersion;
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("INVALID_ROW_VERSION");
  return parsed;
}

async function findPaymentIdempotencyReplay(idempotencyKey: string, action: "create" | "update") {
  const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
  if (!existingRequest) return { item: null, conflict: false };
  const item = existingRequest.entityType === "payment_request" && existingRequest.action === action
    ? await prisma.paymentRequest.findUnique({
        where: { id: existingRequest.entityId },
        include: {
          department: true,
          requester: true,
          vendor: true,
        },
      })
    : null;
  return { item, conflict: !item };
}

function isPrismaCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function validationMessage(code: string) {
  const map: Record<string, string> = {
    INVALID_STATUS: "지원하지 않는 결제 요청 상태입니다.",
    VENDOR_NOT_FOUND: "활성 거래처를 찾을 수 없습니다.",
    DEPARTMENT_NOT_FOUND: "활성 부서를 찾을 수 없습니다.",
    BUDGET_ITEM_NOT_FOUND: "예산 항목을 찾을 수 없습니다.",
    BUDGET_ITEM_DEPARTMENT_MISMATCH: "선택한 부서와 예산 항목이 일치하지 않습니다.",
    CLOSED_PERIOD_SUBMISSION: "마감된 예산 기간에는 신규 결제 요청을 제출할 수 없습니다.",
    APPROVAL_CANDIDATES_NOT_FOUND: "승인 가능한 결재선 후보가 없습니다.",
    ATTACHMENT_REQUIRED: "제출하려면 실제 업로드가 완료된 증빙 파일이 1개 이상 필요합니다.",
    INVALID_ATTACHMENT_ID: "첨부 파일 식별자를 확인해주세요.",
    ATTACHMENT_NOT_FOUND: "업로드 완료된 첨부 파일 metadata를 찾을 수 없습니다.",
    ATTACHMENT_NOT_READY: "업로드 완료 전인 첨부 파일은 결제 요청에 연결할 수 없습니다.",
    ATTACHMENT_BLOCKED: "보안 검사에서 차단된 첨부 파일은 결제 요청에 연결할 수 없습니다.",
    ATTACHMENT_OWNER_MISMATCH: "다른 결제 요청에 연결된 첨부 파일은 현재 요청에 포함할 수 없습니다.",
    REQUEST_CODE_EXHAUSTED: "새 요청번호를 생성하지 못했습니다.",
    INVALID_DATE: "요청일을 확인해주세요.",
    INVALID_ROW_VERSION: "결제 요청 버전 정보가 올바르지 않습니다.",
  };
  return map[code] ?? "결제 요청 입력값을 확인해주세요.";
}

function canReadPaymentRequests(user: Awaited<ReturnType<typeof requireAuth>>) {
  if (!user) return false;
  return hasPermission(user, "payment_request:read_all") || hasPermission(user, "payment_request:read_own") || hasPermission(user, "approval:read_assigned");
}

function canUpdatePaymentRequest(user: NonNullable<Awaited<ReturnType<typeof requireAuth>>>, item: { requesterId: string }) {
  return hasPermission(user, "payment_request:read_all") || (hasPermission(user, "payment_request:update_own") && item.requesterId === user.id);
}

// 삭제 규칙: 관리자(system:manage)는 상태와 무관하게 삭제할 수 있고,
// 그 외에는 본인이 작성한 임시 저장 건만 삭제할 수 있다. (제출 이후 건은 감사 추적 대상)
function canDeletePaymentRequest(
  user: NonNullable<Awaited<ReturnType<typeof requireAuth>>>,
  item: { requesterId: string; status: PaymentRequestStatus },
) {
  if (hasPermission(user, "system:manage")) return true;
  return item.status === PaymentRequestStatus.DRAFT
    && item.requesterId === user.id
    && hasPermission(user, "payment_request:update_own");
}

export const paymentRequestRoutes: FastifyPluginAsync = async (app) => {
  app.get("/payment-requests", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    if (!canReadPaymentRequests(user)) {
      return fail(reply, "FORBIDDEN", "결제 요청 목록 조회 권한이 없습니다.", 403);
    }

    const canReadAll = hasPermission(user, "payment_request:read_all");
    const canReadAssigned = hasPermission(user, "approval:read_assigned");
    const query = listQuerySchema.parse(request.query);
    // 소프트 삭제된 요청은 목록에서 제외한다.
    const whereItems: Prisma.PaymentRequestWhereInput[] = [{ deletedAt: null }];

    if (query.search) {
      whereItems.push({
          OR: [
            { requestCode: { contains: query.search, mode: "insensitive" as const } },
            { vendor: { name: { contains: query.search, mode: "insensitive" as const } } },
            { requester: { name: { contains: query.search, mode: "insensitive" as const } } },
            { department: { name: { contains: query.search, mode: "insensitive" as const } } },
          ],
        });
    }

    if (!canReadAll) {
      whereItems.push(
        canReadAssigned
          ? { approvalSteps: { some: { approverId: user.id } } }
          : { requesterId: user.id },
      );
    }

    const where: Prisma.PaymentRequestWhereInput | undefined = whereItems.length ? { AND: whereItems } : undefined;

    const [items, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        include: {
          department: true,
          requester: true,
          vendor: true,
        },
        orderBy: { requestedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.paymentRequest.count({ where }),
    ]);

    const rows = items.map(toPaymentRequestRow);

    return reply.send(
      success(request, {
        rows,
        total,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  });

  app.get("/payment-requests/master-data", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    if (!canUsePaymentMasterData(user)) {
      return fail(reply, "FORBIDDEN", "결제 요청 기준정보 조회 권한이 없습니다.", 403);
    }

    const [vendors, departments, users] = await Promise.all([
      prisma.vendor.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.department.findMany({
        where: { isActive: true },
        include: {
          budgets: {
            include: {
              items: true,
            },
            orderBy: { fiscalYear: "desc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: { isActive: true },
        include: {
          department: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const departmentRows = departments.map((department) => {
      const latestBudget = department.budgets[0] ?? null;
      const allocated = latestBudget ? Number(latestBudget.allocatedAmount) : 0;
      const used = latestBudget ? Number(latestBudget.usedAmount) : 0;
      return {
        name: department.name,
        budgetRemaining: allocated - used,
        budgetStatus: latestBudget ? displayBudgetStatus(latestBudget.status) : "미등록",
      };
    });

    const budgetItems = departments.flatMap((department) => {
      const latestBudget = department.budgets[0] ?? null;
      if (!latestBudget) return [];
      return latestBudget.items.map((budgetItem) => ({
        id: budgetItem.id,
        departmentName: department.name,
        name: budgetItem.name,
        remaining: Number(budgetItem.allocatedAmount) - Number(budgetItem.usedAmount),
        status: displayBudgetStatus(budgetItem.status),
      }));
    });

    const approvalCandidates = users.flatMap((candidate) => {
      const mapped = toApprovalCandidate(candidate, user.id);
      return mapped ? [mapped] : [];
    });

    return reply.send(
      success(request, {
        vendors: vendors.map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
          businessNumber: vendor.businessNumber,
          managerName: vendor.managerName,
          taxInvoiceEmail: vendor.taxInvoiceEmail,
          taxInvoiceIssueType: vendor.taxInvoiceIssueType,
          status: vendor.isActive ? "활성" : "비활성",
          accountStatus: displayAccountStatus(vendor.accountVerificationStatus),
        })),
        departments: departmentRows,
        budgetItems,
        approvalCandidates,
      }),
    );
  });

  app.post("/payment-requests", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    if (!hasPermission(user, "payment_request:create")) {
      return fail(reply, "FORBIDDEN", "결제 요청 생성 권한이 없습니다.", 403);
    }

    const patch = readStringPatch(request.body);
    const idempotencyKey = readPaymentIdempotencyKey(request.body);
    if (idempotencyKey) {
      const replay = await findPaymentIdempotencyReplay(idempotencyKey, "create");
      if (replay.item) return reply.send(success(request, toPaymentRequestRow(replay.item), { idempotencyReplay: true, rowVersion: replay.item.rowVersion }));
      if (replay.conflict) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }
    let attachmentIds: string[];
    try {
      attachmentIds = readPaymentAttachmentIds(request.body);
    } catch (error) {
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }
    const status = patch.상태 ? toPaymentRequestStatus(patch.상태) : PaymentRequestStatus.DRAFT;
    if (patch.상태 && !status) {
      return fail(reply, "VALIDATION_ERROR", validationMessage("INVALID_STATUS"), 400);
    }

    let created: PaymentRequestWithRelations;
    try {
      created = await prisma.$transaction(async (tx) => {
        let requestCode = patch.요청번호?.trim() ?? "";
        if (!requestCode || (await tx.paymentRequest.findUnique({ where: { requestCode } }))) {
          requestCode = await nextRequestCode(tx);
        }

        const department =
          (patch.부서 ? await tx.department.findFirst({ where: { name: patch.부서, isActive: true } }) : null) ??
          (await tx.department.findFirst({ where: { id: user.departmentId, isActive: true } }));
        if (!department) throw new Error("DEPARTMENT_NOT_FOUND");

        const vendor =
          (patch.거래처 ? await tx.vendor.findFirst({ where: { name: patch.거래처, isActive: true } }) : null) ??
          (await tx.vendor.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } }));
        if (!vendor) throw new Error("VENDOR_NOT_FOUND");

        const requestedAt = patch.요청일 ? new Date(patch.요청일) : new Date();
        if (Number.isNaN(requestedAt.getTime())) throw new Error("INVALID_DATE");

        const explicitBudgetItem = patch.예산항목ID
          ? await tx.budgetItem.findUnique({ where: { id: patch.예산항목ID }, include: { budget: true } })
          : null;
        if (patch.예산항목ID && !explicitBudgetItem) throw new Error("BUDGET_ITEM_NOT_FOUND");
        if (explicitBudgetItem && explicitBudgetItem.budget.departmentId !== department.id) throw new Error("BUDGET_ITEM_DEPARTMENT_MISMATCH");
        const budgetItem = explicitBudgetItem ?? (await firstBudgetItemForDepartment(tx, department.id));

        const item = await tx.paymentRequest.create({
          data: {
            requestCode,
            requesterId: user.id,
            departmentId: department.id,
            vendorId: vendor.id,
            budgetItemId: budgetItem?.id,
            amount: parseWon(patch.금액) ?? 0,
            status,
            reason: patch["요청 사유"]?.trim() || "임시 저장",
            requestedAt,
          },
          include: {
            department: true,
            requester: true,
            vendor: true,
          },
        });

        const linkedAttachmentCount = await linkPaymentAttachments(tx, item, user.id, attachmentIds);
        if (item.status === PaymentRequestStatus.SUBMITTED || item.status === PaymentRequestStatus.APPROVAL_PENDING) {
          await assertSubmitReady(tx, item);
          await ensurePendingApprovalSteps(tx, item);
        }

        await tx.auditLog.create({
          data: {
            entityType: "payment_request",
            entityId: item.id,
            actorId: user.id,
            action: "create",
            afterValue: toPaymentRequestAuditValue(item, attachmentIds, linkedAttachmentCount),
            reason: patch["요청 사유"] ?? patch.상태 ?? undefined,
            idempotencyKey,
            ...auditRequestContext(request),
          },
        });

        return item;
      });
    } catch (error) {
      if (isPrismaCode(error, "P2002") && idempotencyKey) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }

    return reply.code(201).send(success(request, toPaymentRequestRow(created), { rowVersion: created.rowVersion }));
  });

  app.get("/payment-requests/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!canReadPaymentRequests(user)) {
      return fail(reply, "FORBIDDEN", "결제 요청 상세 조회 권한이 없습니다.", 403);
    }

    const params = request.params as { requestCode: string };
    const item = await prisma.paymentRequest.findUnique({
      where: { requestCode: params.requestCode },
      include: {
        department: true,
        requester: true,
        vendor: true,
      },
    });
    if (!item || item.deletedAt) return reply.send(success(request, null));

    const canReadAll = hasPermission(user, "payment_request:read_all");
    const canReadAssigned = hasPermission(user, "approval:read_assigned");
    if (!canReadAll && !canReadAssigned && item.requesterId !== user.id) {
      return fail(reply, "FORBIDDEN", "해당 결제 요청을 조회할 권한이 없습니다.", 403);
    }

    return reply.send(success(request, toPaymentRequestRow(item)));
  });

  app.patch("/payment-requests/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { requestCode: string };
    const before = await prisma.paymentRequest.findUnique({
      where: { requestCode: params.requestCode },
      include: {
        department: true,
        requester: true,
        vendor: true,
      },
    });
    if (!before) return reply.send(success(request, null));
    if (!canUpdatePaymentRequest(user, before)) {
      return fail(reply, "FORBIDDEN", "결제 요청 수정 권한이 없습니다.", 403);
    }

    const patch = readStringPatch(request.body);
    const idempotencyKey = readPaymentIdempotencyKey(request.body);
    if (idempotencyKey) {
      const replay = await findPaymentIdempotencyReplay(idempotencyKey, "update");
      if (replay.item) return reply.send(success(request, toPaymentRequestRow(replay.item), { idempotencyReplay: true, rowVersion: replay.item.rowVersion }));
      if (replay.conflict) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }
    let expectedRowVersion: number | undefined;
    try {
      expectedRowVersion = readPaymentExpectedRowVersion(request.body, patch);
    } catch (error) {
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }
    if (expectedRowVersion !== undefined && expectedRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", "결제 요청 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
    }
    let attachmentIds: string[];
    try {
      attachmentIds = readPaymentAttachmentIds(request.body);
    } catch (error) {
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }
    let updateData: Prisma.PaymentRequestUpdateInput;
    try {
      updateData = await buildPaymentRequestUpdateData(patch);
    } catch (error) {
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }

    let updated: PaymentRequestWithRelations;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const item = await tx.paymentRequest.update({
          where: { id: before.id, rowVersion: before.rowVersion } as Prisma.PaymentRequestWhereUniqueInput,
          data: updateData,
          include: {
            department: true,
            requester: true,
            vendor: true,
          },
        });
        const linkedAttachmentCount = await linkPaymentAttachments(tx, item, user.id, attachmentIds);
        if (item.status === PaymentRequestStatus.SUBMITTED || item.status === PaymentRequestStatus.APPROVAL_PENDING) {
          await assertSubmitReady(tx, item);
          await ensurePendingApprovalSteps(tx, item);
        }
        await tx.auditLog.create({
          data: {
            entityType: "payment_request",
            entityId: before.id,
            actorId: user.id,
            action: "update",
            beforeValue: jsonRow(toPaymentRequestRow(before)),
            afterValue: toPaymentRequestAuditValue(item, attachmentIds, linkedAttachmentCount),
            reason: patch["요청 사유"] ?? patch.상태 ?? undefined,
            idempotencyKey,
            ...auditRequestContext(request),
          },
        });
        return item;
      });
    } catch (error) {
      if (isPrismaCode(error, "P2025")) return fail(reply, "CONFLICT", "결제 요청 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
      if (isPrismaCode(error, "P2002") && idempotencyKey) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }

    return reply.send(success(request, toPaymentRequestRow(updated), { rowVersion: updated.rowVersion }));
  });

  // 결제 요청 소프트 삭제. 행은 보존하고 deletedAt만 채워 목록/조회에서 제외하며, 감사 로그를 남긴다.
  app.delete("/payment-requests/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { requestCode: string };
    const before = await prisma.paymentRequest.findUnique({
      where: { requestCode: params.requestCode },
      include: {
        department: true,
        requester: true,
        vendor: true,
      },
    });
    if (!before) return reply.send(success(request, null));
    // 이미 삭제된 건은 멱등하게 성공 처리한다.
    if (before.deletedAt) return reply.send(success(request, toPaymentRequestRow(before), { idempotencyReplay: true }));
    if (!canDeletePaymentRequest(user, before)) {
      return fail(reply, "FORBIDDEN", "결제 요청 삭제 권한이 없습니다. 임시 저장 건은 작성자만, 진행 중 건은 관리자만 삭제할 수 있습니다.", 403);
    }

    const body = request.body && typeof request.body === "object" ? (request.body as { reason?: unknown; idempotencyKey?: unknown }) : {};
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "결제 요청 삭제";
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined;

    let deleted: PaymentRequestWithRelations;
    try {
      deleted = await prisma.$transaction(async (tx) => {
        const item = await tx.paymentRequest.update({
          where: { id: before.id, rowVersion: before.rowVersion } as Prisma.PaymentRequestWhereUniqueInput,
          data: { deletedAt: new Date(), deletedById: user.id, deleteReason: reason },
          include: {
            department: true,
            requester: true,
            vendor: true,
          },
        });
        await tx.auditLog.create({
          data: {
            entityType: "payment_request",
            entityId: before.id,
            actorId: user.id,
            action: "delete",
            beforeValue: jsonRow(toPaymentRequestRow(before)),
            afterValue: jsonRow({ ...toPaymentRequestRow(item), 삭제: "삭제됨" }),
            reason,
            idempotencyKey,
            ...auditRequestContext(request),
          },
        });
        return item;
      });
    } catch (error) {
      if (isPrismaCode(error, "P2025")) return fail(reply, "CONFLICT", "결제 요청 정보가 이미 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해주세요.", 409);
      if (isPrismaCode(error, "P2002") && idempotencyKey) return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
      const code = error instanceof Error ? error.message : "VALIDATION_ERROR";
      return fail(reply, "VALIDATION_ERROR", validationMessage(code), 400);
    }

    return reply.send(success(request, toPaymentRequestRow(deleted), { deleted: true }));
  });

  app.post("/payment-requests/:requestCode/:action", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { requestCode: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown }) : {};
    const patch: TableRow = {
      ...readStringPatch(body.patch),
      ...(typeof body.reason === "string" && body.reason ? { "처리 사유": body.reason } : {}),
    };
    if (params.action === "submit" && !patch.상태) patch.상태 = "제출";

    const payload: Record<string, unknown> = { ...patch };
    const copyAttachmentField = (source: Record<string, unknown>, key: string) => {
      if (key in source) payload[key] = source[key];
    };
    if (body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)) {
      const nestedPatch = body.patch as Record<string, unknown>;
      copyAttachmentField(nestedPatch, "attachmentIds");
      copyAttachmentField(nestedPatch, "첨부파일ID");
      copyAttachmentField(nestedPatch, "첨부파일IDs");
      copyAttachmentField(nestedPatch, "첨부 파일 ID");
    }
    copyAttachmentField(body as Record<string, unknown>, "attachmentIds");
    copyAttachmentField(body as Record<string, unknown>, "첨부파일ID");
    copyAttachmentField(body as Record<string, unknown>, "첨부파일IDs");
    copyAttachmentField(body as Record<string, unknown>, "첨부 파일 ID");
    copyAttachmentField(body as Record<string, unknown>, "rowVersion");
    copyAttachmentField(body as Record<string, unknown>, "요청RowVersion");
    if (typeof body.idempotencyKey === "string") payload.idempotencyKey = body.idempotencyKey;

    request.body = payload;
    return app.inject({
      method: "PATCH",
      url: `/api/payment-requests/${encodeURIComponent(params.requestCode)}`,
      headers: forwardableHeaders(request.headers),
      cookies: definedCookies(request.cookies),
      payload,
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};
