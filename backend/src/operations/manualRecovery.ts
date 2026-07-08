import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  AccountVerificationStatus,
  DisbursementStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import type { AuthUser } from "../auth/session.js";
import { auditRequestContext } from "../routes/rowUtils.js";

export type ManualRecoveryDecision = "approve" | "reject";

export class ManualRecoveryError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ManualRecoveryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type ManualRecoveryDb = PrismaClient;

type ManualRecoveryInput = {
  targetType: string;
  targetCode: string;
  nextStatus: string;
  accountStatus?: string;
  scheduledDate?: string;
  reason: string;
  idempotencyKey?: string;
};

type ManualRecoveryReviewInput = {
  reason: string;
  idempotencyKey?: string;
};

type ManualRecoverySnapshot = {
  manualRecoveryId: string;
  targetType: "disbursement";
  targetId: string;
  targetCode: string;
  reviewerId: string;
  reviewerName: string;
  requestedAt: string;
  expectedRowVersion: number;
  before: Record<string, unknown>;
  proposed: Record<string, unknown>;
  status: "pending";
};

const manualRecoveryEntityType = "manual_recovery";
const manualRecoveryRequestAction = "manual_recovery_requested";
const manualRecoveryApproveAction = "manual_recovery_approved";
const manualRecoveryRejectAction = "manual_recovery_rejected";
const manualRecoveryActions = [manualRecoveryRequestAction, manualRecoveryApproveAction, manualRecoveryRejectAction];

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readRecoveryId(log: { id: string; afterValue: Prisma.JsonValue | null }) {
  const value = readRecord(log.afterValue);
  return typeof value?.manualRecoveryId === "string" ? value.manualRecoveryId : log.id;
}

function toDisbursementStatus(value: string) {
  const map: Record<string, DisbursementStatus> = {
    SCHEDULED: DisbursementStatus.SCHEDULED,
    DUE_TODAY: DisbursementStatus.DUE_TODAY,
    ERROR: DisbursementStatus.ERROR,
    HELD: DisbursementStatus.HELD,
    "지급 예정": DisbursementStatus.SCHEDULED,
    "오늘 지급": DisbursementStatus.DUE_TODAY,
    오류: DisbursementStatus.ERROR,
    보류: DisbursementStatus.HELD,
  };
  return map[value];
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

function toAccountStatus(value: string | undefined) {
  if (!value) return undefined;
  const map: Record<string, AccountVerificationStatus> = {
    VERIFIED: AccountVerificationStatus.VERIFIED,
    PENDING: AccountVerificationStatus.PENDING,
    MISMATCH: AccountVerificationStatus.MISMATCH,
    INACTIVE: AccountVerificationStatus.INACTIVE,
    "확인 완료": AccountVerificationStatus.VERIFIED,
    "확인 대기": AccountVerificationStatus.PENDING,
    "계좌 불일치": AccountVerificationStatus.MISMATCH,
    비활성: AccountVerificationStatus.INACTIVE,
  };
  return map[value];
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

function parseDateOnly(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

type ManualRecoveryDisbursement = Prisma.DisbursementGetPayload<{
  include: {
    vendor: true;
    paymentRequest: {
      include: {
        department: true;
        requester: true;
      };
    };
  };
}>;

function disbursementSnapshot(item: ManualRecoveryDisbursement) {
  return {
    지급번호: item.disbursementCode,
    지급예정일: formatDate(item.scheduledDate),
    지급일시: item.executedAt?.toISOString() ?? null,
    거래처: item.vendor.name,
    금액: Number(item.amount),
    지급상태: displayDisbursementStatus(item.status),
    계좌확인: displayAccountStatus(item.accountVerificationStatus),
    승인번호: item.paymentRequest.requestCode,
    부서: item.paymentRequest.department.name,
    담당자: item.paymentRequest.requester.name,
    rowVersion: item.rowVersion,
  };
}

function readManualRecoveryInput(body: unknown): ManualRecoveryInput {
  const record = readRecord(body) ?? {};
  return {
    targetType: typeof record.targetType === "string" ? record.targetType.trim() : "disbursement",
    targetCode: typeof record.targetCode === "string" ? record.targetCode.trim() : "",
    nextStatus: typeof record.nextStatus === "string" ? record.nextStatus.trim() : "",
    accountStatus: typeof record.accountStatus === "string" ? record.accountStatus.trim() : undefined,
    scheduledDate: typeof record.scheduledDate === "string" ? record.scheduledDate.trim() : undefined,
    reason: typeof record.reason === "string" ? record.reason.trim() : "",
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey.trim() : undefined,
  };
}

function readReviewInput(body: unknown): ManualRecoveryReviewInput {
  const record = readRecord(body) ?? {};
  return {
    reason: typeof record.reason === "string" ? record.reason.trim() : "",
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey.trim() : undefined,
  };
}

async function findDisbursementByCode(db: ManualRecoveryDb, targetCode: string) {
  return db.disbursement.findUnique({
    where: { disbursementCode: targetCode },
    include: {
      vendor: true,
      paymentRequest: {
        include: {
          department: true,
          requester: true,
        },
      },
    },
  });
}

function buildManualRecoveryPatch(input: ManualRecoveryInput, before: ManualRecoveryDisbursement) {
  const nextStatus = toDisbursementStatus(input.nextStatus);
  if (!nextStatus) throw new ManualRecoveryError("VALIDATION_ERROR", "지원하지 않는 복구 지급 상태입니다.", 400);
  if (nextStatus === DisbursementStatus.COMPLETED) {
    throw new ManualRecoveryError("WORKFLOW_LOCKED", "지급 완료 처리는 수동 복구가 아니라 지급 실행 2인 확인 절차를 사용해야 합니다.", 409);
  }
  const accountStatus = toAccountStatus(input.accountStatus);
  const scheduledDate = parseDateOnly(input.scheduledDate);
  if (input.accountStatus && !accountStatus) throw new ManualRecoveryError("VALIDATION_ERROR", "지원하지 않는 계좌 확인 상태입니다.", 400);
  if (scheduledDate === null) throw new ManualRecoveryError("VALIDATION_ERROR", "유효한 지급 예정일이 필요합니다.", 400);

  const proposed = {
    지급상태: displayDisbursementStatus(nextStatus),
    계좌확인: accountStatus ? displayAccountStatus(accountStatus) : displayAccountStatus(before.accountVerificationStatus),
    지급예정일: scheduledDate ? formatDate(scheduledDate) : formatDate(before.scheduledDate),
  };
  const updateData: Prisma.DisbursementUpdateManyMutationInput = {
    status: nextStatus,
    rowVersion: { increment: 1 },
    executedAt: null,
  };
  if (accountStatus) updateData.accountVerificationStatus = accountStatus;
  if (scheduledDate) updateData.scheduledDate = scheduledDate;
  return { proposed, updateData };
}

function recoverySnapshotFromLog(log: {
  id: string;
  createdAt: Date;
  actor: { id: string; name: string; email: string } | null;
  afterValue: Prisma.JsonValue | null;
}) {
  const value = readRecord(log.afterValue);
  if (!value) return null;
  return {
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    actor: log.actor ? { id: log.actor.id, name: log.actor.name, email: log.actor.email } : null,
    value,
  };
}

export async function getManualRecoverySummary(db: ManualRecoveryDb = prisma) {
  const logs = await db.auditLog.findMany({
    where: {
      entityType: manualRecoveryEntityType,
      action: { in: manualRecoveryActions },
    },
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const requests = new Map<string, ReturnType<typeof recoverySnapshotFromLog>>();
  const outcomes = new Map<string, ReturnType<typeof recoverySnapshotFromLog>>();
  for (const log of logs) {
    const recoveryId = readRecoveryId(log);
    const snapshot = recoverySnapshotFromLog(log);
    if (!snapshot) continue;
    if (log.action === manualRecoveryRequestAction && !requests.has(recoveryId)) requests.set(recoveryId, snapshot);
    if ((log.action === manualRecoveryApproveAction || log.action === manualRecoveryRejectAction) && !outcomes.has(recoveryId)) outcomes.set(recoveryId, snapshot);
  }

  const items = Array.from(requests.entries()).map(([recoveryId, requestSnapshot]) => {
    const outcome = outcomes.get(recoveryId);
    const requestValue = requestSnapshot?.value ?? {};
    const outcomeValue = outcome?.value ?? {};
    const decision = outcomeValue.decision === "rejected" ? "rejected" : outcomeValue.decision === "approved" ? "approved" : "pending";
    return {
      id: recoveryId,
      status: decision,
      targetType: requestValue.targetType,
      targetCode: requestValue.targetCode,
      reviewerName: requestValue.reviewerName,
      approverName: typeof outcomeValue.approverName === "string" ? outcomeValue.approverName : "",
      requestedAt: requestSnapshot?.createdAt ?? "",
      reviewedAt: outcome?.createdAt ?? "",
      reason: typeof requestValue.reason === "string" ? requestValue.reason : "",
      approvalReason: typeof outcomeValue.reason === "string" ? outcomeValue.reason : "",
      expectedRowVersion: Number(requestValue.expectedRowVersion ?? 0),
      proposed: readRecord(requestValue.proposed) ?? {},
    };
  });

  const pending = items.filter((item) => item.status === "pending");
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      pending: pending.length,
      approved: items.filter((item) => item.status === "approved").length,
      rejected: items.filter((item) => item.status === "rejected").length,
    },
    items,
    pending,
  };
}

export async function requestManualRecovery(
  body: unknown,
  actor: AuthUser,
  request: FastifyRequest,
  db: ManualRecoveryDb = prisma,
) {
  const input = readManualRecoveryInput(body);
  if (input.targetType !== "disbursement") throw new ManualRecoveryError("VALIDATION_ERROR", "현재 수동 복구는 지급 건만 지원합니다.", 400);
  if (!input.targetCode) throw new ManualRecoveryError("VALIDATION_ERROR", "복구 대상 지급번호가 필요합니다.", 400);
  if (!input.reason) throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 사유가 필요합니다.", 400);
  if (!input.idempotencyKey) throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 요청에는 idempotencyKey가 필요합니다.", 400);

  const existing = await db.auditLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.entityType === manualRecoveryEntityType && existing.action === manualRecoveryRequestAction) {
      return { idempotencyReplay: true, recoveryId: existing.id, summary: await getManualRecoverySummary(db) };
    }
    throw new ManualRecoveryError("IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
  }

  const before = await findDisbursementByCode(db, input.targetCode);
  if (!before) throw new ManualRecoveryError("NOT_FOUND", "복구 대상 지급 건을 찾을 수 없습니다.", 404);
  const { proposed } = buildManualRecoveryPatch(input, before);
  const recoveryId = randomUUID();
  const now = new Date();
  const afterValue: ManualRecoverySnapshot & { reason: string } = {
    manualRecoveryId: recoveryId,
    targetType: "disbursement",
    targetId: before.id,
    targetCode: before.disbursementCode,
    reviewerId: actor.id,
    reviewerName: actor.name,
    requestedAt: now.toISOString(),
    expectedRowVersion: before.rowVersion,
    before: disbursementSnapshot(before),
    proposed,
    status: "pending",
    reason: input.reason,
  };

  await db.auditLog.create({
    data: {
      id: recoveryId,
      entityType: manualRecoveryEntityType,
      entityId: before.id,
      actorId: actor.id,
      action: manualRecoveryRequestAction,
      beforeValue: disbursementSnapshot(before) as Prisma.InputJsonObject,
      afterValue: afterValue as unknown as Prisma.InputJsonObject,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      ...auditRequestContext(request),
    },
  });

  return { idempotencyReplay: false, recoveryId, summary: await getManualRecoverySummary(db) };
}

export async function reviewManualRecovery(
  recoveryId: string,
  decision: ManualRecoveryDecision,
  body: unknown,
  actor: AuthUser,
  request: FastifyRequest,
  db: ManualRecoveryDb = prisma,
) {
  const input = readReviewInput(body);
  if (!input.reason) throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 검토 사유가 필요합니다.", 400);
  if (!input.idempotencyKey) throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 검토에는 idempotencyKey가 필요합니다.", 400);

  const existing = await db.auditLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.entityType === manualRecoveryEntityType && [manualRecoveryApproveAction, manualRecoveryRejectAction].includes(existing.action)) {
      return { idempotencyReplay: true, recoveryId, summary: await getManualRecoverySummary(db) };
    }
    throw new ManualRecoveryError("IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
  }

  const requested = await db.auditLog.findUnique({
    where: { id: recoveryId },
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
  if (!requested || requested.entityType !== manualRecoveryEntityType || requested.action !== manualRecoveryRequestAction) {
    throw new ManualRecoveryError("NOT_FOUND", "수동 복구 요청을 찾을 수 없습니다.", 404);
  }
  if (requested.actorId === actor.id) {
    throw new ManualRecoveryError("WORKFLOW_LOCKED", "수동 복구 요청자와 승인자는 서로 달라야 합니다.", 409);
  }
  const requestValue = readRecord(requested.afterValue);
  if (!requestValue) throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 요청 데이터가 올바르지 않습니다.", 400);

  const existingOutcome = await db.auditLog.findFirst({
    where: {
      entityType: manualRecoveryEntityType,
      action: { in: [manualRecoveryApproveAction, manualRecoveryRejectAction] },
      afterValue: {
        path: ["manualRecoveryId"],
        equals: recoveryId,
      },
    },
  });
  if (existingOutcome) throw new ManualRecoveryError("CONFLICT", "이미 검토 완료된 수동 복구 요청입니다.", 409);

  const targetCode = typeof requestValue.targetCode === "string" ? requestValue.targetCode : "";
  const before = await findDisbursementByCode(db, targetCode);
  if (!before) throw new ManualRecoveryError("NOT_FOUND", "복구 대상 지급 건을 찾을 수 없습니다.", 404);
  const expectedRowVersion = Number(requestValue.expectedRowVersion);
  if (!Number.isInteger(expectedRowVersion) || before.rowVersion !== expectedRowVersion) {
    throw new ManualRecoveryError("CONFLICT", "복구 대상 지급 건이 요청 이후 변경되었습니다. 새 요청을 생성하세요.", 409);
  }

  const decisionValue = {
    manualRecoveryId: recoveryId,
    targetType: "disbursement",
    targetId: before.id,
    targetCode: before.disbursementCode,
    reviewerId: requested.actorId,
    reviewerName: requested.actor?.name ?? "",
    approverId: actor.id,
    approverName: actor.name,
    decision: decision === "approve" ? "approved" : "rejected",
    reason: input.reason,
    requestedAt: requested.createdAt.toISOString(),
    reviewedAt: new Date().toISOString(),
    expectedRowVersion,
    proposed: readRecord(requestValue.proposed) ?? {},
  };

  if (decision === "reject") {
    await db.auditLog.create({
      data: {
        entityType: manualRecoveryEntityType,
        entityId: before.id,
        actorId: actor.id,
        action: manualRecoveryRejectAction,
        beforeValue: disbursementSnapshot(before) as Prisma.InputJsonObject,
        afterValue: decisionValue as Prisma.InputJsonObject,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        ...auditRequestContext(request),
      },
    });
    return { idempotencyReplay: false, recoveryId, summary: await getManualRecoverySummary(db) };
  }

  const nextStatus = toDisbursementStatus(String((decisionValue.proposed as Record<string, unknown>).지급상태 ?? ""));
  const accountStatus = toAccountStatus(String((decisionValue.proposed as Record<string, unknown>).계좌확인 ?? ""));
  const scheduledDate = parseDateOnly(String((decisionValue.proposed as Record<string, unknown>).지급예정일 ?? ""));
  if (!nextStatus || nextStatus === DisbursementStatus.COMPLETED) {
    throw new ManualRecoveryError("VALIDATION_ERROR", "수동 복구 승인 데이터가 올바르지 않습니다.", 400);
  }

  await db.$transaction(async (tx) => {
    const updateResult = await tx.disbursement.updateMany({
      where: {
        id: before.id,
        rowVersion: expectedRowVersion,
      },
      data: {
        status: nextStatus,
        accountVerificationStatus: accountStatus,
        scheduledDate: scheduledDate || before.scheduledDate,
        executedAt: null,
        rowVersion: { increment: 1 },
      },
    });
    if (updateResult.count !== 1) throw new ManualRecoveryError("CONFLICT", "복구 대상 지급 건이 이미 변경되었습니다.", 409);
    const updated = await tx.disbursement.findUniqueOrThrow({
      where: { id: before.id },
      include: {
        vendor: true,
        paymentRequest: {
          include: {
            department: true,
            requester: true,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: manualRecoveryEntityType,
        entityId: before.id,
        actorId: actor.id,
        action: manualRecoveryApproveAction,
        beforeValue: disbursementSnapshot(before) as Prisma.InputJsonObject,
        afterValue: {
          ...decisionValue,
          after: disbursementSnapshot(updated),
        } as Prisma.InputJsonObject,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        ...auditRequestContext(request),
      },
    });
  });

  return { idempotencyReplay: false, recoveryId, summary: await getManualRecoverySummary(db) };
}
