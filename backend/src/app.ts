import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { enforceCsrfProtection } from "./auth/csrf.js";
import { approvalRoutes } from "./routes/approvals.js";
import { authRoutes } from "./routes/auth.js";
import { disbursementRoutes } from "./routes/disbursements.js";
import { fileRoutes } from "./routes/files.js";
import { healthRoutes } from "./routes/health.js";
import { notificationRoutes } from "./routes/notifications.js";
import { operationsRoutes } from "./routes/operations.js";
import { budgetRoutes, dashboardRoutes, favoriteRoutes, reportRoutes, settingRoutes, vendorRoutes } from "./routes/pageResources.js";
import { paymentRequestRoutes } from "./routes/paymentRequests.js";
import { registerDataQualityScheduler } from "./operations/dataQualityJobWorker.js";
import { enforceOperationModeRestriction } from "./operations/operationMode.js";
import { apiBodyLimitBytes, createRateLimitHook } from "./security/rateLimit.js";
import { createSafeLoggerOptions } from "./security/logRedaction.js";
import { createServerErrorHandler } from "./security/serverErrors.js";
import { createSecurityEventFailureHook } from "./security/securityEvents.js";

export type BuildAppOptions = {
  logger?: boolean;
};

function corsOrigins() {
  const raw = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
  return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function isLocalOrigin(origin: string) {
  return /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:|\/|$)/i.test(origin);
}

function isHttpsOrigin(origin: string) {
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}

function assertProductionCorsOrigin(allowedOrigins: string[]) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.FRONTEND_ORIGIN || allowedOrigins.some((origin) => origin === "*" || isLocalOrigin(origin) || !isHttpsOrigin(origin)))
  ) {
    throw new Error("FRONTEND_ORIGIN must be an explicit HTTPS non-local allowlist in production.");
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : createSafeLoggerOptions(),
    genReqId: () => randomUUID(),
    bodyLimit: apiBodyLimitBytes(),
  });

  const allowedOrigins = corsOrigins();
  assertProductionCorsOrigin(allowedOrigins);

  app.setErrorHandler(createServerErrorHandler());

  await app.register(cors, {
    credentials: true,
    origin: allowedOrigins,
  });
  await app.register(cookie);
  app.addHook("onRequest", createRateLimitHook());
  app.addHook("preHandler", enforceCsrfProtection);
  app.addHook("preHandler", enforceOperationModeRestriction);
  app.addHook("onSend", createSecurityEventFailureHook());
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(operationsRoutes, { prefix: "/api" });
  await app.register(notificationRoutes, { prefix: "/api" });
  await app.register(paymentRequestRoutes, { prefix: "/api" });
  await app.register(approvalRoutes, { prefix: "/api" });
  await app.register(disbursementRoutes, { prefix: "/api" });
  await app.register(fileRoutes, { prefix: "/api" });
  await app.register(dashboardRoutes, { prefix: "/api" });
  await app.register(budgetRoutes, { prefix: "/api" });
  await app.register(vendorRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(settingRoutes, { prefix: "/api" });
  await app.register(favoriteRoutes, { prefix: "/api" });

  registerDataQualityScheduler(app);

  return app;
}
