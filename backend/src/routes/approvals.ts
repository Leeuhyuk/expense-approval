import type { FastifyPluginAsync } from "fastify";
import { ApprovalStatus, BudgetStatus, NotificationType, PaymentRequestStatus, type Prisma } from "../../generated/prisma/index.js";
import { z } from "zod";
import { hasPermission, requireAuth } from "../auth/session.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { fail, success } from "../utils/response.js";
import { addDays, auditRequestContext, definedCookies, filterAndSortRows, formatDate, formatWon, jsonRow, paginateRows, readListFilters, readStringPatch, type TableRow } from "./rowUtils.js";

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

function displayApprovalStepStatus(status: ApprovalStatus) {
  const map: Record<ApprovalStatus, string> = {
    PENDING: "승인 대기",
    APPROVED: "승인 완료",
    REJECTED: "반려",
    HELD: "보류",
    SKIPPED: "건너뜀",
  };
  return map[status];
}

function formatDateTime(value: Date | null) {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "";
}

function approvalStepLabel(stepOrder: number, totalSteps: number) {
  if (totalSteps <= 1 || stepOrder === totalSteps) return "최종 결재";
  return `${stepOrder}차 결재`;
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

function budgetStatusSeverity(status: BudgetStatus) {
  if (status === BudgetStatus.EXCEEDED) return 2;
  if (status === BudgetStatus.WARNING) return 1;
  return 0;
}

function normalizeRolePermissions(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function canReceiveBudgetAlert(permissions: string[]) {
  return permissions.includes("*") || permissions.includes("system:manage") || permissions.includes("budget:read");
}

async function findBudgetAlertRecipientIds(tx: Prisma.TransactionClient) {
  const users = await tx.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      roles: {
        select: {
          role: {
            select: {
              isActive: true,
              permissions: true,
            },
          },
        },
      },
    },
  });

  return users
    .filter((item) => item.roles.some(({ role }) => role.isActive && canReceiveBudgetAlert(normalizeRolePermissions(role.permissions))))
    .map((item) => item.id);
}

type BudgetAlertEvent = {
  entityType: "BUDGET" | "BUDGET_ITEM";
  entityId: string;
  title: string;
  message: string;
  status: "WARNING" | "EXCEEDED";
};

function budgetAlertEvent(input: {
  entityType: BudgetAlertEvent["entityType"];
  entityId: string;
  label: string;
  requestCode: string;
  beforeStatus: BudgetStatus;
  nextStatus: BudgetStatus;
  allocatedAmount: unknown;
  nextUsedAmount: number;
  approvedAmount: number;
}) {
  if (budgetStatusSeverity(input.nextStatus) <= budgetStatusSeverity(input.beforeStatus) || budgetStatusSeverity(input.nextStatus) === 0) {
    return null;
  }
  if (input.nextStatus !== BudgetStatus.WARNING && input.nextStatus !== BudgetStatus.EXCEEDED) {
    return null;
  }
  const allocated = Number(input.allocatedAmount);
  const usageRate = allocated > 0 ? Math.round((input.nextUsedAmount / allocated) * 100) : 0;
  const isExceeded = input.nextStatus === BudgetStatus.EXCEEDED;
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    status: input.nextStatus,
    title: isExceeded ? "예산 초과" : "예산 주의",
    message: `${input.requestCode} 승인 반영 후 ${input.label} 사용률이 ${usageRate}%입니다. 승인 금액 ${formatWon(input.approvedAmount)} 기준으로 backend 예산 rule이 ${isExceeded ? "초과" : "주의"} 상태를 생성했습니다.`,
  } satisfies BudgetAlertEvent;
}

async function budgetAlertNotificationRows(tx: Prisma.TransactionClient, alerts: BudgetAlertEvent[]) {
  if (alerts.length === 0) return [];
  const recipientIds = await findBudgetAlertRecipientIds(tx);
  if (recipientIds.length === 0) return [];

  const alertEntityIds = alerts.map((alert) => `${alert.entityType}:${alert.entityId}:${alert.status}`);
  const existing = await tx.notification.findMany({
    where: {
      userId: { in: recipientIds },
      type: NotificationType.BUDGET_EXCEEDED,
      entityId: { in: alertEntityIds },
    },
    select: {
      userId: true,
      entityId: true,
    },
  });
  const existingKeys = new Set(existing.map((item) => `${item.userId}:${item.entityId}`));

  return recipientIds.flatMap((userId) =>
    alerts.flatMap((alert) => {
      const entityId = `${alert.entityType}:${alert.entityId}:${alert.status}`;
      if (existingKeys.has(`${userId}:${entityId}`)) return [];
      return [{
        userId,
        type: NotificationType.BUDGET_EXCEEDED,
        title: alert.title,
        message: alert.message,
        entityType: alert.entityType,
        entityId,
        linkPath: "#budget",
        expiresAt: notificationExpiresAt(),
      } satisfies Prisma.NotificationCreateManyInput];
    }),
  );
}

function toApprovalRow(item: ApprovalPaymentRequest): TableRow {
  const sortedSteps = [...item.approvalSteps].sort((a, b) => a.stepOrder - b.stepOrder);
  const currentStep = currentApprovalStep(item);
  const currentPendingStep = isOpenApprovalStatus(item.status) ? currentPendingApprovalStep(item) : null;
  const remainingCount = sortedSteps.filter((step) => step.status === ApprovalStatus.PENDING).length;
  const assignee = currentStep?.approver.name ?? sortedSteps.at(-1)?.approver.name ?? "-";
  const actedSteps = sortedSteps.filter((step) => step.actedAt || step.status !== ApprovalStatus.PENDING);
  const lastActedStep = actedSteps.at(-1) ?? null;
  const approvalStepRows = sortedSteps.map((step) => {
    const status = displayApprovalStepStatus(step.status);
    const actedAt = formatDateTime(step.actedAt);
    return {
      id: step.id,
      stepOrder: String(step.stepOrder),
      step: approvalStepLabel(step.stepOrder, sortedSteps.length),
      approverId: step.approverId,
      approverName: step.approver.name,
      role: "승인자",
      status,
      reason: step.reason ?? "",
      actedAt,
      isCurrent: currentPendingStep?.id === step.id,
      rowVersion: String(step.rowVersion),
    };
  });
  const historyText = approvalStepRows
    .filter((step) => step.actedAt || step.status !== "승인 대기")
    .map((step) => `${step.actedAt || "-"} ${step.approverName} ${step.step} ${step.status}${step.reason ? ` - ${step.reason}` : ""}`)
    .join(" | ");

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
    "요청 사유": item.reason,
    "처리 사유": lastActedStep?.reason ?? "",
    처리시간: formatDateTime(lastActedStep?.actedAt ?? null),
    "처리 이력": historyText,
    결재단계JSON: JSON.stringify(approvalStepRows),
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
    include: { budget: { include: { department: true } } },
  });
  if (!budgetItem) throw new Error("BUDGET_ITEM_NOT_FOUND");

  const amount = Number(item.amount);
  const nextItemUsed = Number(budgetItem.usedAmount) + amount;
  const nextBudgetUsed = Number(budgetItem.budget.usedAmount) + amount;
  const itemStatus = budgetStatusFor(budgetItem.allocatedAmount, nextItemUsed);
  const budgetStatus = budgetStatusFor(budgetItem.budget.allocatedAmount, nextBudgetUsed);
  const alerts = [
    budgetAlertEvent({
      entityType: "BUDGET_ITEM",
      entityId: budgetItem.id,
      label: `${budgetItem.budget.department.name} ${budgetItem.name}`,
      requestCode: item.requestCode,
      beforeStatus: budgetItem.status,
      nextStatus: itemStatus,
      allocatedAmount: budgetItem.allocatedAmount,
      nextUsedAmount: nextItemUsed,
      approvedAmount: amount,
    }),
    budgetAlertEvent({
      entityType: "BUDGET",
      entityId: budgetItem.budgetId,
      label: `${budgetItem.budget.department.name} 전체 예산`,
      requestCode: item.requestCode,
      beforeStatus: budgetItem.budget.status,
      nextStatus: budgetStatus,
      allocatedAmount: budgetItem.budget.allocatedAmount,
      nextUsedAmount: nextBudgetUsed,
      approvedAmount: amount,
    }),
  ].filter((alert): alert is BudgetAlertEvent => Boolean(alert));

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
    alerts,
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
      where: canReadAll ? undefined : { approvalSteps: { some: { approverId: user.id } } },
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
        if (budgetUsage) {
          const budgetNotificationRows = await budgetAlertNotificationRows(tx, budgetUsage.alerts);
          notificationRows.push(...budgetNotificationRows);
        }
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
      headers: request.headers as Record<string, string>,
      cookies: definedCookies(request.cookies),
      payload: patch,
    }).then((response) => {
      reply.status(response.statusCode).headers(response.headers).send(response.body);
    });
  });
};
