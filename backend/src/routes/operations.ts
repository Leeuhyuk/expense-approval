import type { FastifyPluginAsync } from "fastify";
import { hasPermission, requireAuth } from "../auth/session.js";
import { getBusinessFailureAlertSummary, notifyBusinessFailureOwners } from "../operations/businessFailureAlerts.js";
import { getDataQualitySummary } from "../operations/dataQuality.js";
import { getOperationalAlertSummary } from "../operations/operationalAlerts.js";
import { fail, success } from "../utils/response.js";

export const operationsRoutes: FastifyPluginAsync = async (app) => {
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

  app.get("/operations/data-quality", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (!hasPermission(user, "system:manage")) {
      return fail(reply, "FORBIDDEN", "데이터 품질 점검 권한이 없습니다.", 403);
    }

    const summary = await getDataQualitySummary();
    return reply.code(summary.ok ? 200 : 409).send(success(request, summary));
  });
};
