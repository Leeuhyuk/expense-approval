import type { FastifyPluginAsync } from "fastify";
import { ApprovalStatus, BudgetStatus, NotificationType, PaymentRequestStatus, type Prisma } from "../../generated/prisma/index.js";
import { z } from "zod";
import { hasPermission, requireAuth } from "../auth/session.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { fail, success } from "../utils/response.js";
import { addDays, auditRequestContext, definedCookies, filterAndSortRows, formatDate, formatWon, forwardableHeaders, jsonRow, paginateRows, readListFilters, readStringPatch, type TableRow } from "./rowUtils.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  sort: z.string().optional(),
});

type ApprovalPaymentRequest = Prisma.PaymentRequestGetPayload<{
  include: {
    department: true;
    requester: true;
    vendor: true;
    approvalSteps: {
      include: {
        approver: true;
      };
    };
  };
}>;

function displayApprovalStatus(status: PaymentRequestStatus) {
  const map: Record<PaymentRequestStatus, string> = {
    DRAFT: "승인 대기",
    SUBMITTED: "승인 대기",
    APPROVAL_PENDING: "승인 대기",
    APPROVAL_IN_PROGRESS: "승인 진행 중",
    APPROVED: "승인 완료",
    REJECTED: "반려",
    HELD: "보류",
  };
  return map[status];
}

function toApprovalStatus(value: string) {
  const map: Record<string, ApprovalStatus> = {
    "승인 완료": ApprovalStatus.APPROVED,
    "승인 진행 중": ApprovalStatus.APPROVED,
    반려: ApprovalStatus.REJECTED,
    보류: ApprovalStatus.HELD,
    "승인 대기": ApprovalStatus.PENDING,
  };
  return map[value];
}

function currentApprovalStep(item: ApprovalPaymentRequest) {
  return [...item.approvalSteps].sort((a, b) => a.stepOrder - b.stepOrder).find((step) => step.status === ApprovalStatus.PENDING) ?? [...item.approvalSteps].sort((a, b) => b.stepOrder - a.stepOrder)[0] ?? null;
}

function currentPendingApprovalStep(item: ApprovalPaymentRequest) {
  return [...item.approvalSteps].sort((a, b) => a.stepOrder - b.stepOrder).find((step) => step.status === ApprovalStatus.PENDING) ?? null;
}

const openApprovalStatuses: PaymentRequestStatus[] = [
  PaymentRequestStatus.SUBMITTED,
  PaymentRequestStatus.APPROVAL_PENDING,
  PaymentRequestStatus.APPROVAL_IN_PROGRESS,
];

function isOpenApprovalStatus(status: PaymentRequestStatus) {
  return openApprovalStatuses.includes(status);
}

function budgetStatusFor(allocatedAmount: unknown, usedAmount: unknown) {
  const allocated = Number(allocatedAmount);
  const used = Number(usedAmount);
  if (allocated > 0 && used > allocated) return BudgetStatus.EXCEEDED;
  if (allocated > 0 && used / allocated >= 0.9) return BudgetStatus.WARNING;
  return BudgetStatus.NORMAL;
}

function toApprovalRow(item: ApprovalPaymentRequest): TableRow {
  const sortedSteps = [...item.approvalSteps].sort((a, b) => a.stepOrder - b.stepOrder);
  const currentStep = currentApprovalStep(item);
  const remainingCount = sortedSteps.filter((step) => step.status === ApprovalStatus.PENDING).length;
  const assignee = currentStep?.approver.name ?? sortedSteps.at(-1)?.approver.name ?? "-";

  return {
    요청번호: item.requestCode,
    요청일: formatDate(item.requestedAt),
    부서: item.department.name,
    요청자: item.requester.name,
    거래처: item.vendor.name,
    금액: formatWon(item.amount),
    결재상태: displayApprovalStatus(item.status),
    예산확인: item.budgetItemId ? "확인 완료" : "확인 전",
    결재선: remainingCount > 1 ? `${assignee} 외 ${remainingCount - 1}명` : assignee,
    처리기한: formatDate(addDays(item.requestedAt, 3)),
    요청RowVersion: String(item.rowVersion),
    결재StepID: currentStep?.id ?? "",
    결재RowVersion: currentStep ? String(currentStep.rowVersion) : "",
  };
}

export function validateApprovalActor(item: ApprovalPaymentRequest, actorId: string, nextStepStatus: ApprovalStatus) {
  if (nextStepStatus === ApprovalStatus.APPROVED && item.requesterId === actorId) {
    return "요청자는 본인 결제 요청을 승인할 수 없습니다.";
  }
  return "";
}

async function findApprovalPaymentRequest(requestCode: string) {
  return prisma.paymentRequest.findUnique({
    where: { requestCode },
    include: {
      department: true,
      requester: true,
      vendor: true,
      approvalSteps: {
        include: {
          approver: true,
        },
        orderBy: { stepOrder: "asc" },
      },
    },
  });
}

function readApprovalIdempotencyKey(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).idempotencyKey;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalRowVersion(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function approvalConflictMessage(code: string) {
  const map: Record<string, string> = {
    IDEMPOTENCY_REPLAY: "이미 처리된 승인 요청입니다.",
    STALE_APPROVAL_STEP: "다른 사용자가 먼저 결재 단계를 처리했습니다. 목록을 새로고침한 뒤 다시 확인해주세요.",
    STALE_PAYMENT_REQUEST: "결제 요청 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해주세요.",
    BUDGET_ITEM_NOT_FOUND: "승인 요청의 예산 항목을 찾을 수 없습니다.",
  };
  return map[code] ?? "승인 처리 중 충돌이 발생했습니다.";
}

async function applyBudgetUsageOnFinalApproval(
  tx: Prisma.TransactionClient,
  item: { requestCode: string; budgetItemId: string | null; amount: unknown; status: PaymentRequestStatus },
  nextPaymentStatus: PaymentRequestStatus,
) {
  if (nextPaymentStatus !== PaymentRequestStatus.APPROVED || item.status === PaymentRequestStatus.APPROVED || !item.budgetItemId) return null;

  const budgetItem = await tx.budgetItem.findUnique({
    where: { id: item.budgetItemId },
    include: { budget: true },
  });
  if (!budgetItem) throw new Error("BUDGET_ITEM_NOT_FOUND");

  const amount = Number(item.amount);
  const nextItemUsed = Number(budgetItem.usedAmount) + amount;
  const nextBudgetUsed = Number(budgetItem.budget.usedAmount) + amount;
  const itemStatus = budgetStatusFor(budgetItem.allocatedAmount, nextItemUsed);
  const budgetStatus = budgetStatusFor(budgetItem.budget.allocatedAmount, nextBudgetUsed);

  await tx.budgetItem.update({
    where: { id: budgetItem.id },
    data: {
      usedAmount: { increment: amount },
      status: itemStatus,
    },
  });
  await tx.budget.update({
    where: { id: budgetItem.budgetId },
    data: {
      usedAmount: { increment: amount },
      status: budgetStatus,
      rowVersion: { increment: 1 },
    },
  });

  return {
    budgetId: budgetItem.budgetId,
    budgetItemId: budgetItem.id,
    amount,
    itemStatus,
    budgetStatus,
  };
}

export const approvalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/approvals", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const canReadAll = hasPermission(user, "payment_request:read_all");
    const canReadAssigned = hasPermission(user, "approval:read_assigned");
    if (!canReadAll && !canReadAssigned) {
      return fail(reply, "FORBIDDEN", "승인 목록 조회 권한이 없습니다.", 403);
    }

    const parsed = listQuerySchema.parse(request.query);
    const items = await prisma.paymentRequest.findMany({
      // 소프트 삭제된 결제 요청은 승인 목록에서도 제외한다.
      where: canReadAll
        ? { deletedAt: null }
        : { deletedAt: null, approvalSteps: { some: { approverId: user.id } } },
      include: {
        department: true,
        requester: true,
        vendor: true,
        approvalSteps: {
          include: {
            approver: true,
          },
          orderBy: { stepOrder: "asc" },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    const rows = filterAndSortRows(items.map(toApprovalRow), {
      ...parsed,
      filters: readListFilters(request.query),
    });
    return reply.send(success(request, paginateRows(rows, parsed)));
  });

  app.get("/approvals/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { requestCode: string };
    const item = await findApprovalPaymentRequest(params.requestCode);
    if (!item) return reply.send(success(request, null));

    const canReadAll = hasPermission(user, "payment_request:read_all");
    const canReadAssigned = hasPermission(user, "approval:read_assigned") && item.approvalSteps.some((step) => step.approverId === user.id);
    if (!canReadAll && !canReadAssigned) {
      return fail(reply, "FORBIDDEN", "해당 승인 건 조회 권한이 없습니다.", 403);
    }

    return reply.send(success(request, toApprovalRow(item)));
  });

  app.patch("/approvals/:requestCode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "approval:act")) {
      return fail(reply, "FORBIDDEN", "승인 처리 권한이 없습니다.", 403);
    }

    const params = request.params as { requestCode: string };
    const before = await findApprovalPaymentRequest(params.requestCode);
    if (!before) return reply.send(success(request, null));

    if (!isOpenApprovalStatus(before.status)) {
      return fail(reply, "WORKFLOW_LOCKED", "이미 종료된 승인 건은 다시 처리할 수 없습니다.", 409);
    }

    const currentStep = currentPendingApprovalStep(before);
    if (!currentStep) {
      return fail(reply, "CONFLICT", "처리할 결재 단계가 없습니다.", 409);
    }
    if (currentStep.approverId !== user.id && !hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "현재 결재 단계 처리자가 아닙니다.", 403);
    }

    const patch = readStringPatch(request.body);
    const idempotencyKey = readApprovalIdempotencyKey(request.body);
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) return fail(reply, "IDEMPOTENCY_REPLAY", approvalConflictMessage("IDEMPOTENCY_REPLAY"), 409);
    }
    const nextStepStatus = toApprovalStatus(patch.결재상태 ?? "승인 완료");
    if (!nextStepStatus) return fail(reply, "VALIDATION_ERROR", "지원하지 않는 승인 상태입니다.", 400);
    if (nextStepStatus === ApprovalStatus.PENDING) return fail(reply, "VALIDATION_ERROR", "승인 대기 상태로 되돌릴 수 없습니다.", 400);
    const expectedRequestRowVersion = readOptionalRowVersion(patch.요청RowVersion);
    const expectedStepRowVersion = readOptionalRowVersion(patch.결재RowVersion);
    if (expectedRequestRowVersion !== null && expectedRequestRowVersion !== before.rowVersion) {
      return fail(reply, "CONFLICT", approvalConflictMessage("STALE_PAYMENT_REQUEST"), 409);
    }
    if (expectedStepRowVersion !== null && expectedStepRowVersion !== currentStep.rowVersion) {
      return fail(reply, "CONFLICT", approvalConflictMessage("STALE_APPROVAL_STEP"), 409);
    }
    const actorError = validateApprovalActor(before, user.id, nextStepStatus);
    if (actorError) return fail(reply, "APPROVAL_CONTROL_FAILED", actorError, 409);

    let updated: ApprovalPaymentRequest;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const stepUpdate = await tx.approvalStep.updateMany({
          where: {
            id: currentStep.id,
            status: ApprovalStatus.PENDING,
            rowVersion: currentStep.rowVersion,
          },
          data: {
            status: nextStepStatus,
            reason: patch["처리 사유"] || undefined,
            actedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        if (stepUpdate.count !== 1) throw new Error("STALE_APPROVAL_STEP");

        const nextSteps = await tx.approvalStep.findMany({
          where: { paymentRequestId: before.id },
          orderBy: { stepOrder: "asc" },
        });
        const allApproved = nextSteps.every((step) => step.id === currentStep.id ? nextStepStatus === ApprovalStatus.APPROVED : step.status === ApprovalStatus.APPROVED);
        const nextPendingStep = nextSteps.find((step) => step.status === ApprovalStatus.PENDING) ?? null;
        const nextPaymentStatus =
          nextStepStatus === ApprovalStatus.REJECTED
            ? PaymentRequestStatus.REJECTED
            : nextStepStatus === ApprovalStatus.HELD
              ? PaymentRequestStatus.HELD
              : allApproved
                ? PaymentRequestStatus.APPROVED
                : PaymentRequestStatus.APPROVAL_IN_PROGRESS;

        const requestUpdate = await tx.paymentRequest.updateMany({
          where: {
            id: before.id,
            rowVersion: before.rowVersion,
            status: before.status,
          },
          data: {
            status: nextPaymentStatus,
            rowVersion: { increment: 1 },
          },
        });
        if (requestUpdate.count !== 1) throw new Error("STALE_PAYMENT_REQUEST");

        const budgetUsage = await applyBudgetUsageOnFinalApproval(tx, before, nextPaymentStatus);

        const notificationRows: Prisma.NotificationCreateManyInput[] = [];
        if (nextStepStatus === ApprovalStatus.REJECTED) {
          notificationRows.push({
            userId: before.requesterId,
            type: NotificationType.APPROVAL_REJECTED,
            title: "결재 반려",
            message: `${before.requestCode} ${before.reason} 결재가 반려되었습니다.`,
            entityType: "PAYMENT_REQUEST",
            entityId: before.requestCode,
            linkPath: "#payment-request",
            expiresAt: notificationExpiresAt(),
          });
        } else if (nextStepStatus === ApprovalStatus.HELD) {
          notificationRows.push({
            userId: before.requesterId,
            type: NotificationType.APPROVAL_HELD,
            title: "결재 보류",
            message: `${before.requestCode} ${before.reason} 결재가 보류되었습니다.`,
            entityType: "PAYMENT_REQUEST",
            entityId: before.requestCode,
            linkPath: "#approval",
            expiresAt: notificationExpiresAt(),
          });
        } else if (allApproved) {
          notificationRows.push({
            userId: before.requesterId,
            type: NotificationType.APPROVAL_COMPLETED,
            title: "승인 완료",
            message: `${before.requestCode} ${before.reason} 결재가 최종 승인되었습니다.`,
            entityType: "PAYMENT_REQUEST",
            entityId: before.requestCode,
            linkPath: "#payment-request",
            expiresAt: notificationExpiresAt(),
          });
        } else if (nextPendingStep) {
          notificationRows.push({
            userId: nextPendingStep.approverId,
            type: NotificationType.APPROVAL_REQUESTED,
            title: "승인 요청",
            message: `${before.requestCode} ${before.reason} 다음 결재가 배정되었습니다.`,
            entityType: "PAYMENT_REQUEST",
            entityId: before.requestCode,
            linkPath: "#approval",
            expiresAt: notificationExpiresAt(),
          });
        }
        if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows });

        const after = await tx.paymentRequest.findUniqueOrThrow({
          where: { id: before.id },
          include: {
            department: true,
            requester: true,
            vendor: true,
            approvalSteps: {
              include: {
                approver: true,
              },
              orderBy: { stepOrder: "asc" },
            },
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "approval_step",
            entityId: currentStep.id,
            actorId: user.id,
            action: nextStepStatus.toLowerCase(),
            beforeValue: jsonRow(toApprovalRow(before)),
            afterValue: jsonRow(toApprovalRow(after)),
            reason: patch["처리 사유"] ?? patch.결재상태 ?? undefined,
            idempotencyKey,
            ...auditRequestContext(request),
          },
        });
        if (budgetUsage) {
          await tx.auditLog.create({
            data: {
              entityType: "budget_item",
              entityId: budgetUsage.budgetItemId,
              actorId: user.id,
              action: "approval_budget_usage",
              afterValue: {
                requestCode: before.requestCode,
                budgetId: budgetUsage.budgetId,
                budgetItemId: budgetUsage.budgetItemId,
                amount: budgetUsage.amount,
                itemStatus: budgetUsage.itemStatus,
                budgetStatus: budgetUsage.budgetStatus,
              },
              reason: patch["처리 사유"] ?? patch.결재상태 ?? undefined,
              ...auditRequestContext(request),
            },
          });
        }

        return after;
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CONFLICT";
      return fail(reply, "CONFLICT", approvalConflictMessage(code), 409);
    }

    return reply.send(success(request, toApprovalRow(updated), { rowVersion: updated.rowVersion }));
  });

  app.post("/approvals/:requestCode/:action", async (request, reply) => {
    const params = request.params as { requestCode: string; action: string };
    const body = request.body && typeof request.body === "object" ? (request.body as { patch?: unknown; reason?: unknown; idempotencyKey?: unknown }) : {};
    const actionStatus: Record<string, string> = {
      approve: "승인 완료",
      reject: "반려",
      hold: "보류",
    };
    const patch: TableRow = {
      ...readStringPatch(body.patch),
      결재상태: actionStatus[params.action] ?? readStringPatch(body.patch).결재상태 ?? "승인 완료",
      ...(typeof body.reason === "string" && body.reason ? { "처리 사유": body.reason } : {}),
      ...(typeof body.idempotencyKey === "string" && body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
    };

    return app.inject({
      method: "PATCH",
      url: `/api/approvals/${encodeURIComponent(params.requestCode)}`,
      headers: forwardableHeaders(request.headers),
      cookies: definedCookies(request.cookies),
      payload: patch,
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};
