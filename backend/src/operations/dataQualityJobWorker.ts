import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  DataQualityRunStatus,
  NotificationType,
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/index.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { maskSensitiveLogText } from "../security/logRedaction.js";
import { getDataQualitySummary } from "./dataQuality.js";

type DataQualityJobDb = Pick<
  PrismaClient,
  | "$queryRaw"
  | "department"
  | "user"
  | "role"
  | "vendor"
  | "budget"
  | "budgetItem"
  | "paymentRequest"
  | "approvalStep"
  | "disbursement"
  | "attachment"
  | "dataQualityRun"
  | "notification"
>;

export type DataQualityJobPolicy = {
  enabled: boolean;
  intervalMinutes: number;
  historyLimit: number;
  runOnStart: boolean;
  startDelayMs: number;
};

export type RunDataQualityJobInput = {
  source?: "manual" | "scheduled" | "startup";
  requestedBy?: string | null;
  requestId?: string;
  scheduleKey?: string | null;
};

function truthyFlag(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function positiveInteger(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizePermissions(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function findOperationalOwnerIds(db: Pick<PrismaClient, "user">) {
  const users = await db.user.findMany({
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
    .filter((user) =>
      user.roles.some(({ role }) => {
        if (!role.isActive) return false;
        const permissions = normalizePermissions(role.permissions);
        return permissions.includes("*") || permissions.includes("system:manage");
      }),
    )
    .map((user) => user.id);
}

export function dataQualityJobPolicy(env: NodeJS.ProcessEnv = process.env): DataQualityJobPolicy {
  return {
    enabled: truthyFlag(env.DATA_QUALITY_JOB_ENABLED),
    intervalMinutes: positiveInteger(env.DATA_QUALITY_JOB_INTERVAL_MINUTES, 60, 10_080),
    historyLimit: positiveInteger(env.DATA_QUALITY_JOB_HISTORY_LIMIT, 30, 500),
    runOnStart: truthyFlag(env.DATA_QUALITY_JOB_RUN_ON_START),
    startDelayMs: positiveInteger(env.DATA_QUALITY_JOB_START_DELAY_MS, 5_000, 300_000),
  };
}

export function dataQualityScheduleKey(now: Date, intervalMinutes: number) {
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  return ["data-quality", intervalMinutes, Math.floor(now.getTime() / intervalMs)].join(":");
}

async function notifyCriticalFailures(
  db: Pick<PrismaClient, "user" | "notification">,
  runId: string,
  criticalCount: number,
  requestId: string,
) {
  if (criticalCount <= 0) return { recipientCount: 0, notificationsCreated: 0 };

  const recipientIds = await findOperationalOwnerIds(db);
  if (recipientIds.length === 0) return { recipientCount: 0, notificationsCreated: 0 };

  const existing = await db.notification.findMany({
    where: {
      userId: { in: recipientIds },
      type: NotificationType.OPERATIONAL_ALERT,
      entityType: "DATA_QUALITY_RUN",
      entityId: runId,
    },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((item) => item.userId));
  const rows: Prisma.NotificationCreateManyInput[] = recipientIds
    .filter((userId) => !existingIds.has(userId))
    .map((userId) => ({
      userId,
      type: NotificationType.OPERATIONAL_ALERT,
      title: "데이터 품질 critical 실패",
      message: "정합성 배치에서 critical 실패 " + criticalCount + "건이 확인되었습니다. runId " + runId + ", requestId " + requestId + "를 확인하세요.",
      entityType: "DATA_QUALITY_RUN",
      entityId: runId,
      linkPath: "#settings",
      expiresAt: notificationExpiresAt(),
    }));
  const created = rows.length > 0 ? await db.notification.createMany({ data: rows }) : { count: 0 };
  return { recipientCount: recipientIds.length, notificationsCreated: created.count };
}

export async function runDataQualityJob(
  input: RunDataQualityJobInput = {},
  db: DataQualityJobDb = prisma,
) {
  const source = input.source ?? "manual";
  const requestId = input.requestId?.trim() || randomUUID();
  const scheduleKey = input.scheduleKey?.trim() || null;
  let run;

  try {
    run = await db.dataQualityRun.create({
      data: {
        status: DataQualityRunStatus.RUNNING,
        source,
        requestedBy: input.requestedBy ?? null,
        requestId,
        scheduleKey,
      },
    });
  } catch (error) {
    if (!scheduleKey || !isUniqueConflict(error)) throw error;
    const existing = await db.dataQualityRun.findUnique({ where: { scheduleKey } });
    if (!existing) throw error;
    return {
      deduplicated: true,
      run: existing,
      summary: existing.summary,
      recipientCount: 0,
      notificationsCreated: 0,
    };
  }

  try {
    const summary = await getDataQualitySummary(db);
    const completedAt = new Date();
    const completed = await db.dataQualityRun.update({
      where: { id: run.id },
      data: {
        status: DataQualityRunStatus.COMPLETED,
        summary: jsonValue(summary),
        criticalCount: summary.criticalFailures.length,
        warningCount: summary.warningFailures.length,
        completedAt,
      },
    });
    const notificationResult = await notifyCriticalFailures(
      db,
      completed.id,
      summary.criticalFailures.length,
      requestId,
    );
    return {
      deduplicated: false,
      run: completed,
      summary,
      ...notificationResult,
    };
  } catch (error) {
    const message = maskSensitiveLogText(error instanceof Error ? error.message : String(error));
    await db.dataQualityRun.update({
      where: { id: run.id },
      data: {
        status: DataQualityRunStatus.FAILED,
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function listDataQualityRuns(
  limit = dataQualityJobPolicy().historyLimit,
  db: Pick<PrismaClient, "dataQualityRun"> = prisma,
) {
  return db.dataQualityRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(Math.floor(limit), 1), 500),
  });
}

export async function getDataQualityRunArtifact(
  runId: string,
  db: Pick<PrismaClient, "dataQualityRun"> = prisma,
) {
  const run = await db.dataQualityRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const generatedAt = run.completedAt ?? run.startedAt;
  const content = JSON.stringify(
    {
      runId: run.id,
      status: run.status,
      source: run.source,
      requestId: run.requestId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      criticalCount: run.criticalCount,
      warningCount: run.warningCount,
      errorMessage: run.errorMessage,
      summary: run.summary,
    },
    null,
    2,
  );
  return {
    fileName: "data-quality-" + generatedAt.toISOString().replace(/[:.]/g, "-") + ".json",
    contentType: "application/json;charset=utf-8",
    contentBase64: Buffer.from(content, "utf8").toString("base64"),
    generatedAt: generatedAt.toISOString(),
    runId: run.id,
  };
}

export function registerDataQualityScheduler(
  app: FastifyInstance<any, any, any, any, any>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const policy = dataQualityJobPolicy(env);
  if (!policy.enabled) return policy;

  let intervalHandle: NodeJS.Timeout | null = null;
  let startupHandle: NodeJS.Timeout | null = null;
  const execute = (source: "scheduled" | "startup") => {
    const now = new Date();
    void runDataQualityJob({
      source,
      requestId: randomUUID(),
      scheduleKey: dataQualityScheduleKey(now, policy.intervalMinutes),
    }).catch((error) => {
      app.log.error(
        {
          event: "data_quality_job_failed",
          error: maskSensitiveLogText(error instanceof Error ? error.message : String(error)),
        },
        "Data quality scheduled job failed",
      );
    });
  };

  app.addHook("onReady", async () => {
    intervalHandle = setInterval(() => execute("scheduled"), policy.intervalMinutes * 60_000);
    intervalHandle.unref();
    if (policy.runOnStart) {
      startupHandle = setTimeout(() => execute("startup"), policy.startDelayMs);
      startupHandle.unref();
    }
  });

  app.addHook("onClose", async () => {
    if (intervalHandle) clearInterval(intervalHandle);
    if (startupHandle) clearTimeout(startupHandle);
    intervalHandle = null;
    startupHandle = null;
  });

  return policy;
}