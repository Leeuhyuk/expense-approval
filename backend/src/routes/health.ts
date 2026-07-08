import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/prisma.js";
import { activeScanMode } from "../security/malwareScan.js";
import { reportJobPolicy } from "../operations/reportJobWorker.js";
import { checkStorageHealth } from "../storage/attachmentStorage.js";
import { success } from "../utils/response.js";

const systemSettingIds = {
  integrations: "91000000-0000-4000-8000-000000000003",
} as const;

const sha256Pattern = /^[a-f0-9]{64}$/i;

type IntegrationHealthSetting = {
  id: string;
  name: string;
  target: string;
  status: "연동" | "대기" | "점검";
  lastSynced: string;
  credentialRef: string;
  testEndpoint: string;
  lastFailureReason: string;
  lastTestedAt: string;
};

function truthyFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function hasEnvValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function envValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  return value ? value : null;
}

function releaseIdentity(env: NodeJS.ProcessEnv = process.env) {
  const releaseVersion = envValue(env, "RELEASE_VERSION") ?? envValue(env, "GITHUB_SHA");
  const sourceRef = envValue(env, "RELEASE_SOURCE_REF") ?? envValue(env, "GITHUB_REF_NAME");
  const gitCommit = envValue(env, "RELEASE_GIT_COMMIT") ?? envValue(env, "GITHUB_SHA");
  const manifestSha256 = envValue(env, "RELEASE_MANIFEST_SHA256") ?? envValue(env, "EXPECTED_RELEASE_MANIFEST_SHA256");
  const required = {
    RELEASE_VERSION: releaseVersion,
    RELEASE_SOURCE_REF: sourceRef,
    RELEASE_GIT_COMMIT: gitCommit,
    RELEASE_MANIFEST_SHA256: manifestSha256,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  const issues = [];
  if (manifestSha256 && !sha256Pattern.test(manifestSha256)) {
    issues.push("RELEASE_MANIFEST_SHA256 must be a 64-character SHA-256 value.");
  }

  return {
    ok: missing.length === 0 && issues.length === 0,
    service: "payment-approval-erp-backend",
    releaseVersion,
    sourceRef,
    gitCommit,
    manifestSha256,
    missing,
    issues,
  };
}

function readIntegrationSettings(value: unknown): IntegrationHealthSetting[] {
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

function isHttpsEndpoint(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function integrationCategory(setting: Pick<IntegrationHealthSetting, "id" | "name" | "target">) {
  const text = `${setting.id} ${setting.name} ${setting.target}`.toLowerCase();
  if (text.includes("bank") || text.includes("은행") || text.includes("계좌")) return "bank";
  if (text.includes("accounting") || text.includes("회계") || text.includes("전표")) return "accounting";
  if (text.includes("tax") || text.includes("invoice") || text.includes("세금계산서")) return "tax-invoice";
  return "external";
}

function integrationIssue(setting: IntegrationHealthSetting, env: NodeJS.ProcessEnv) {
  if (!setting.credentialRef) return "credential reference가 없습니다.";
  if (!/^[A-Z0-9_]{3,100}$/.test(setting.credentialRef)) return "credential reference 형식이 올바르지 않습니다.";
  if (!hasEnvValue(env[setting.credentialRef])) return `${setting.credentialRef} secret이 서버 환경에 없습니다.`;
  if (!setting.testEndpoint) return "테스트 endpoint가 없습니다.";
  if (!isHttpsEndpoint(setting.testEndpoint)) return "테스트 endpoint가 HTTPS URL이 아닙니다.";
  if (setting.status === "점검") return setting.lastFailureReason || "마지막 연동 테스트가 점검 상태입니다.";
  return "";
}

async function reportJobHealth(env: NodeJS.ProcessEnv = process.env) {
  const now = new Date();
  const policy = reportJobPolicy(env);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [activeSchedules, dueSchedules, latestRun, failedRuns24h, deadLetters24h] = await Promise.all([
    prisma.reportSchedule.count({ where: { isActive: true } }),
    prisma.reportSchedule.count({ where: { isActive: true, nextRunAt: { lte: now } } }),
    prisma.reportRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, type: true, status: true, createdAt: true },
    }),
    prisma.reportRun.count({
      where: {
        status: "FAILED",
        createdAt: { gte: since24h },
      },
    }),
    prisma.auditLog.count({
      where: {
        entityType: "report_schedule",
        action: "report_schedule_dead_letter",
        createdAt: { gte: since24h },
      },
    }),
  ]);
  const workerConfigured = truthyFlag(env.REPORT_JOB_WORKER_ENABLED) || hasEnvValue(env.REPORT_QUEUE_URL) || hasEnvValue(env.REPORT_WORKER_URL);
  const ok = activeSchedules === 0 || (workerConfigured && failedRuns24h === 0 && deadLetters24h === 0 && dueSchedules === 0);

  return {
    ok,
    workerConfigured,
    queue: {
      driver: env.REPORT_QUEUE_DRIVER?.trim() || "database-schedule",
      configured: workerConfigured,
    },
    policy: {
      deliveryMode: policy.deliveryMode,
      batchSize: policy.batchSize,
      maxAttempts: policy.maxAttempts,
      timeoutMs: policy.timeoutMs,
      retryBaseSeconds: policy.retryBaseSeconds,
      retryMaxSeconds: policy.retryMaxSeconds,
      circuitBreakerFailureThreshold: policy.circuitBreakerFailureThreshold,
      circuitBreakerWindowMinutes: policy.circuitBreakerWindowMinutes,
      webhookConfigured: Boolean(policy.webhookUrl),
    },
    activeSchedules,
    dueSchedules,
    failedRuns24h,
    deadLetters24h,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          name: latestRun.name,
          type: latestRun.type,
          status: latestRun.status,
          createdAt: latestRun.createdAt.toISOString(),
        }
      : null,
  };
}

async function integrationHealth(env: NodeJS.ProcessEnv = process.env) {
  const latest = await prisma.auditLog.findFirst({
    where: { entityType: "system_setting", entityId: systemSettingIds.integrations },
    orderBy: { createdAt: "desc" },
  });
  const settings = readIntegrationSettings(latest?.afterValue);
  const integrations = settings.map((setting) => {
    const category = integrationCategory(setting);
    const required = category === "bank" || category === "accounting" || setting.status === "연동";
    const issue = integrationIssue(setting, env);
    return {
      id: setting.id,
      name: setting.name,
      target: setting.target,
      category,
      required,
      ok: !required || !issue,
      status: setting.status,
      lastSynced: setting.lastSynced,
      lastTestedAt: setting.lastTestedAt || null,
      credentialRef: setting.credentialRef,
      credentialConfigured: hasEnvValue(env[setting.credentialRef]),
      testEndpointConfigured: Boolean(setting.testEndpoint),
      endpointSecure: setting.testEndpoint ? isHttpsEndpoint(setting.testEndpoint) : false,
      issue: issue || null,
      lastFailureReason: setting.lastFailureReason || null,
    };
  });
  const presentCategories = new Set(integrations.map((item) => item.category));
  const missingRequired = ["accounting", "bank"].filter((category) => !presentCategories.has(category));
  const requiredIntegrations = integrations.filter((item) => item.required);
  const ok = missingRequired.length === 0 && requiredIntegrations.every((item) => item.ok);

  return {
    ok,
    configuredCount: integrations.length,
    missingRequired,
    integrations,
    latestSettingsAuditLogId: latest?.id ?? null,
    latestSettingsSavedAt: latest?.createdAt.toISOString() ?? null,
  };
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (request) => success(request, { ok: true, service: "payment-approval-erp-backend" }));

  app.get("/health/version", async (request, reply) => {
    const identity = releaseIdentity();
    return reply.code(identity.ok ? 200 : 503).send(success(request, identity));
  });

  app.get("/health/db", async (request, reply) => {
    const startedAt = Date.now();
    await prisma.$queryRaw`select 1`;

    return reply.send(
      success(request, {
        ok: true,
        provider: "postgresql",
        latencyMs: Date.now() - startedAt,
      }),
    );
  });

  app.get("/health/storage", async (request, reply) => {
    const storage = await checkStorageHealth();
    return reply.send(success(request, storage));
  });

  app.get("/health/file-security", async (request, reply) => {
    return reply.send(
      success(request, {
        ok: true,
        scanMode: activeScanMode(),
        externalScanConfigured: Boolean(process.env.MALWARE_SCAN_ENDPOINT),
      }),
    );
  });

  app.get("/health/jobs", async (request, reply) => {
    const jobHealth = await reportJobHealth();
    return reply.code(jobHealth.ok ? 200 : 503).send(success(request, jobHealth));
  });

  app.get("/health/integrations", async (request, reply) => {
    const integrationStatus = await integrationHealth();
    return reply.code(integrationStatus.ok ? 200 : 503).send(success(request, integrationStatus));
  });
};
