import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "../../generated/prisma/index.js";
import { hasPermission, requireAuth } from "../auth/session.js";
import { getRetentionPolicySummary, retentionPolicyFor } from "../domain/retentionPolicy.js";
import { prisma } from "../db/prisma.js";
import { accountLifecycleScope, getAccountLifecycleCandidates, getAccountLifecycleSummary } from "../operations/accountLifecycle.js";
import { getBusinessFailureAlertSummary, notifyBusinessFailureOwners } from "../operations/businessFailureAlerts.js";
import { getDataQualitySummary } from "../operations/dataQuality.js";
import { getFinancialControlReport } from "../operations/financialControlReport.js";
import { getFinancialReconciliationSummary, notifyFinancialReconciliationOwners } from "../operations/financialReconciliation.js";
import { getManualRecoverySummary, ManualRecoveryError, requestManualRecovery, reviewManualRecovery } from "../operations/manualRecovery.js";
import { getOperationalAlertSummary } from "../operations/operationalAlerts.js";
import { getOperationModeStatus } from "../operations/operationMode.js";
import { getPerformancePolicyStatus } from "../operations/performancePolicy.js";
import { getPermissionReviewReport } from "../operations/permissionReviewReport.js";
import { getPrivacyAccessReport } from "../operations/privacyAccessReport.js";
import { getAuditIntegrityReport } from "../operations/auditIntegrityReport.js";
import { processDueReportSchedules, reportJobPolicy } from "../operations/reportJobWorker.js";
import { auditRequestContext } from "./rowUtils.js";
import { fail, success } from "../utils/response.js";

function queryRecord(query: unknown): Record<string, unknown> {
  return query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
}

function queryString(query: Record<string, unknown>, key: string) {
  const value = query[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function queryInteger(query: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(query[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function queryDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function jsonSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value === null || value === undefined ? "-" : typeof value;
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
  return keys.length > 0 ? `keys:${keys.join(",")}` : "empty object";
}

function auditLogSummary(log: {
  action: string;
  entityType: string;
  beforeValue: unknown;
  afterValue: unknown;
}) {
  return `${log.action} · ${log.entityType} · before ${jsonSummary(log.beforeValue)} · after ${jsonSummary(log.afterValue)}`;
}

export const operationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/operations/mode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    return reply.send(success(request, getOperationModeStatus()));
  });

  app.get("/operations/alerts", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "운영 알림 조회 권한이 없습니다.", 403);
    }

    const summary = await getOperationalAlertSummary();
    return reply.code(summary.ok ? 200 : 503).send(success(request, summary));
  });

  app.get("/operations/business-failure-alerts", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "업무 실패 알림 조회 권한이 없습니다.", 403);
    }

    const summary = await getBusinessFailureAlertSummary();
    return reply.code(summary.ok ? 200 : 503).send(success(request, summary));
  });

  app.post("/operations/business-failure-alerts/notify", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "업무 실패 알림 발송 권한이 없습니다.", 403);
    }

    const result = await notifyBusinessFailureOwners();
    return reply.code(result.summary.ok ? 200 : 202).send(success(request, result));
  });

  app.get("/operations/report-jobs", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "보고서 예약 job 조회 권한이 없습니다.", 403);
    }

    const result = await processDueReportSchedules({ dryRun: true });
    return reply.code(result.ok ? 200 : 503).send(success(request, result));
  });

  app.post("/operations/report-jobs/run", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "보고서 예약 job 실행 권한이 없습니다.", 403);
    }

    const body = bodyRecord(request.body);
    const batchSize = Number(body.batchSize);
    const result = await processDueReportSchedules({
      dryRun: body.dryRun === true,
      batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : undefined,
      requestedBy: user.id,
    });
    return reply.code(result.ok ? 200 : 202).send(success(request, result));
  });

  app.get("/operations/performance-policy", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "성능/용량 정책 조회 권한이 없습니다.", 403);
    }

    const alerts = await getOperationalAlertSummary();
    const status = getPerformancePolicyStatus(alerts.metrics, reportJobPolicy());
    return reply.code(status.ok ? 200 : 503).send(success(request, status));
  });

  app.get("/operations/data-quality", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "데이터 품질 점검 권한이 없습니다.", 403);
    }

    const summary = await getDataQualitySummary();
    return reply.code(summary.ok ? 200 : 409).send(success(request, summary));
  });

  app.get("/operations/financial-reconciliation", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "재무 대사 점검 권한이 없습니다.", 403);
    }

    const summary = await getFinancialReconciliationSummary();
    return reply.code(summary.ok ? 200 : 409).send(success(request, summary));
  });

  app.post("/operations/financial-reconciliation/notify", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "재무 대사 알림 발송 권한이 없습니다.", 403);
    }

    const result = await notifyFinancialReconciliationOwners();
    return reply.code(result.summary.ok ? 200 : 202).send(success(request, result));
  });

  app.get("/operations/manual-recoveries", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "수동 복구 조회 권한이 없습니다.", 403);
    }

    const summary = await getManualRecoverySummary();
    return reply.send(success(request, summary));
  });

  app.post("/operations/manual-recoveries", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "수동 복구 요청 권한이 없습니다.", 403);
    }

    try {
      const result = await requestManualRecovery(request.body, user, request);
      return reply.send(success(request, result, { recoveryId: result.recoveryId, idempotencyReplay: result.idempotencyReplay }));
    } catch (error) {
      if (error instanceof ManualRecoveryError) return fail(reply, error.code, error.message, error.statusCode);
      throw error;
    }
  });

  app.post("/operations/manual-recoveries/:recoveryId/approve", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "수동 복구 승인 권한이 없습니다.", 403);
    }

    try {
      const result = await reviewManualRecovery((request.params as { recoveryId: string }).recoveryId, "approve", request.body, user, request);
      return reply.send(success(request, result, { recoveryId: result.recoveryId, idempotencyReplay: result.idempotencyReplay }));
    } catch (error) {
      if (error instanceof ManualRecoveryError) return fail(reply, error.code, error.message, error.statusCode);
      throw error;
    }
  });

  app.post("/operations/manual-recoveries/:recoveryId/reject", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "수동 복구 반려 권한이 없습니다.", 403);
    }

    try {
      const result = await reviewManualRecovery((request.params as { recoveryId: string }).recoveryId, "reject", request.body, user, request);
      return reply.send(success(request, result, { recoveryId: result.recoveryId, idempotencyReplay: result.idempotencyReplay }));
    } catch (error) {
      if (error instanceof ManualRecoveryError) return fail(reply, error.code, error.message, error.statusCode);
      throw error;
    }
  });

  app.get("/operations/financial-control-report", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "재무 통제 리포트 조회 권한이 없습니다.", 403);
    }

    const report = await getFinancialControlReport();
    return reply.code(report.ok ? 200 : 409).send(success(request, report));
  });

  app.get("/operations/permission-review", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage") && !hasPermission(user, "audit:read")) {
      return fail(reply, "FORBIDDEN", "정기 권한 검토 리포트 조회 권한이 없습니다.", 403);
    }

    const report = await getPermissionReviewReport();
    return reply.code(report.ok ? 200 : 409).send(success(request, report));
  });

  app.get("/operations/privacy-access-report", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage") && !hasPermission(user, "audit:read")) {
      return fail(reply, "FORBIDDEN", "개인정보 처리/외부 감사 접근 리포트 조회 권한이 없습니다.", 403);
    }

    const report = await getPrivacyAccessReport();
    return reply.code(report.ok ? 200 : 409).send(success(request, report));
  });

  app.get("/operations/audit-integrity-report", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage") && !hasPermission(user, "audit:read")) {
      return fail(reply, "FORBIDDEN", "감사 로그 무결성 리포트 조회 권한이 없습니다.", 403);
    }

    const report = await getAuditIntegrityReport();
    return reply.code(report.ok ? 200 : 409).send(success(request, report));
  });

  app.get("/operations/audit-logs", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "audit:read") && !hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "감사 로그 조회 권한이 없습니다.", 403);
    }

    const query = queryRecord(request.query);
    const page = queryInteger(query, "page", 1);
    const pageSize = Math.min(100, queryInteger(query, "pageSize", 25));
    const search = queryString(query, "search");
    const entityType = queryString(query, "entityType");
    const action = queryString(query, "action");
    const requestIdFilter = queryString(query, "requestId");
    const actor = queryString(query, "actor");
    const from = queryDate(queryString(query, "from"));
    const to = queryDate(queryString(query, "to"));
    const createdAt = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
    const where: Prisma.AuditLogWhereInput = {
      ...(entityType ? { entityType } : {}),
      ...(action ? { action } : {}),
      ...(requestIdFilter ? { requestId: requestIdFilter } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(actor ? { actor: { name: { contains: actor, mode: "insensitive" } } } : {}),
      ...(search ? {
        OR: [
          { entityType: { contains: search, mode: "insensitive" } },
          { action: { contains: search, mode: "insensitive" } },
          { reason: { contains: search, mode: "insensitive" } },
          { requestId: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { actor: { include: { department: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const auditPolicy = retentionPolicyFor("audit_log");

    return reply.send(success(request, {
      rows: rows.map((log) => ({
        id: log.id,
        time: log.createdAt.toISOString(),
        actor: log.actor.name,
        actorDepartment: log.actor.department.name,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        reason: log.reason ?? "",
        requestId: log.requestId,
        ipAddress: log.ipAddress ?? "",
        userAgent: log.userAgent ?? "",
        summary: auditLogSummary(log),
      })),
      total,
      page,
      pageSize,
      accessScope: hasPermission(user, "system:manage") ? "system_manager" : "external_auditor_read_only",
      rawValuePolicy: "beforeValue/afterValue 원문은 외부 감사 조회 응답에 포함하지 않습니다.",
      retention: {
        retentionDays: auditPolicy?.retentionDays ?? null,
        disposition: auditPolicy?.disposition ?? "감사 로그 보관 정책",
        immutable: auditPolicy?.immutable ?? true,
        archiveAction: auditPolicy?.operatorAction ?? "감사 저장소 이관 정책을 따릅니다.",
      },
    }, { total, page, pageSize }));
  });

  app.get("/operations/retention-policy", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "보관 정책 조회 권한이 없습니다.", 403);
    }

    const summary = await getRetentionPolicySummary();
    return reply.send(success(request, summary));
  });

  app.get("/operations/account-lifecycle", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "계정 수명주기 조회 권한이 없습니다.", 403);
    }

    const summary = await getAccountLifecycleSummary();
    return reply.send(success(request, summary));
  });

  app.post("/operations/account-lifecycle/deactivate", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "계정 비활성화 배치 실행 권한이 없습니다.", 403);
    }

    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const scope = accountLifecycleScope(body.scope);
    if (!reason) return fail(reply, "VALIDATION_ERROR", "계정 비활성화 배치 사유가 필요합니다.", 400);
    if (!idempotencyKey) return fail(reply, "VALIDATION_ERROR", "계정 비활성화 배치에는 idempotencyKey가 필요합니다.", 400);

    const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
    if (existingRequest) {
      if (existingRequest.entityType === "account_lifecycle" && existingRequest.action === "account_lifecycle_deactivate") {
        return reply.send(success(request, existingRequest.afterValue, { idempotencyReplay: true }));
      }
      return fail(reply, "IDEMPOTENCY_CONFLICT", "이미 다른 처리에 사용된 idempotencyKey입니다.", 409);
    }

    const snapshot = await getAccountLifecycleCandidates(scope);
    const candidateIds = snapshot.candidates.map((candidate) => candidate.id);
    const result = await prisma.$transaction(async (tx) => {
      const deactivated = candidateIds.length === 0
        ? { count: 0 }
        : await tx.user.updateMany({
            where: { id: { in: candidateIds }, isActive: true },
            data: { isActive: false, rowVersion: { increment: 1 } },
          });
      const revoked = candidateIds.length === 0
        ? { count: 0 }
        : await tx.authSession.updateMany({
            where: { userId: { in: candidateIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
      const afterValue = {
        scope,
        reason,
        deactivatedCount: deactivated.count,
        sessionsRevoked: revoked.count,
        dormantAccountDays: snapshot.dormantAccountDays,
        dormantCutoff: snapshot.dormantCutoff,
        candidates: snapshot.candidates.map((candidate) => ({
          id: candidate.id,
          email: candidate.email,
          name: candidate.name,
          reasons: candidate.reasons.join(","),
        })),
      };
      await tx.auditLog.create({
        data: {
          entityType: "account_lifecycle",
          entityId: user.id,
          actorId: user.id,
          action: "account_lifecycle_deactivate",
          afterValue: afterValue as Prisma.InputJsonObject,
          reason,
          idempotencyKey,
          ...auditRequestContext(request),
        },
      });
      return afterValue;
    });

    return reply.send(success(request, result, {
      deactivatedCount: result.deactivatedCount,
      sessionsRevoked: result.sessionsRevoked,
    }));
  });
};
