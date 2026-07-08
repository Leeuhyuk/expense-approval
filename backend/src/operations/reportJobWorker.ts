import { randomUUID } from "node:crypto";
import { NotificationType, ReportRunStatus, type Prisma, type PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { writeStoredFile } from "../storage/attachmentStorage.js";

type ReportJobDb = Pick<PrismaClient, "auditLog" | "notification" | "reportRun" | "reportSchedule" | "$transaction">;

type ReportScheduleJob = Prisma.ReportScheduleGetPayload<{
  include: {
    definition: true;
    owner: true;
  };
}>;

type ReportScheduleDelivery = {
  recipients: string[];
  cycle: string;
  time: string;
  format: string;
};

type ReportJobRunOptions = {
  batchSize?: number;
  dryRun?: boolean;
  requestedBy?: string;
};

function positiveInteger(value: string | undefined, fallback: number, max = 10_000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function reportJobPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    deliveryMode: env.REPORT_DELIVERY_MODE?.trim() || "internal",
    batchSize: positiveInteger(env.REPORT_JOB_BATCH_SIZE, 10, 100),
    maxAttempts: positiveInteger(env.REPORT_JOB_MAX_ATTEMPTS, 3, 10),
    timeoutMs: positiveInteger(env.REPORT_JOB_TIMEOUT_MS, 30_000, 300_000),
    retryBaseSeconds: positiveInteger(env.REPORT_JOB_RETRY_BASE_SECONDS, 300, 86_400),
    retryMaxSeconds: positiveInteger(env.REPORT_JOB_RETRY_MAX_SECONDS, 3_600, 86_400),
    circuitBreakerFailureThreshold: positiveInteger(env.REPORT_JOB_CIRCUIT_FAILURE_THRESHOLD, 5, 1_000),
    circuitBreakerWindowMinutes: positiveInteger(env.REPORT_JOB_CIRCUIT_WINDOW_MINUTES, 15, 1_440),
    webhookUrl: env.REPORT_DELIVERY_WEBHOOK_URL?.trim() || "",
    webhookTokenConfigured: Boolean(env.REPORT_DELIVERY_WEBHOOK_TOKEN?.trim()),
  };
}

type ReportJobPolicy = ReturnType<typeof reportJobPolicy>;

function publicReportJobPolicy(policy: ReportJobPolicy) {
  return {
    deliveryMode: policy.deliveryMode,
    batchSize: policy.batchSize,
    maxAttempts: policy.maxAttempts,
    timeoutMs: policy.timeoutMs,
    retryBaseSeconds: policy.retryBaseSeconds,
    retryMaxSeconds: policy.retryMaxSeconds,
    circuitBreakerFailureThreshold: policy.circuitBreakerFailureThreshold,
    circuitBreakerWindowMinutes: policy.circuitBreakerWindowMinutes,
    webhookConfigured: Boolean(policy.webhookUrl),
    webhookTokenConfigured: policy.webhookTokenConfigured,
  };
}

function normalizeReportScheduleRecipients(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function reportScheduleDeliveryFromJson(value: unknown): ReportScheduleDelivery {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    recipients: normalizeReportScheduleRecipients(source.recipients),
    cycle: typeof source.cycle === "string" && source.cycle.trim() ? source.cycle.trim() : "매월 1일",
    time: typeof source.time === "string" && /^\d{2}:\d{2}$/.test(source.time) ? source.time : "09:00",
    format: typeof source.format === "string" && source.format.trim() ? source.format.trim() : "PDF",
  };
}

function parseScheduleTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 9,
    minute: Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  };
}

function withScheduleTime(date: Date, time: string) {
  const { hour, minute } = parseScheduleTime(time);
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function nextReportScheduleRunAt(delivery: Pick<ReportScheduleDelivery, "cycle" | "time">, from = new Date()) {
  let next = withScheduleTime(from, delivery.time);
  const cycle = delivery.cycle;

  if (cycle.includes("매일")) {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  if (cycle.includes("매주")) {
    const weekdays: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
    const targetDay = Object.entries(weekdays).find(([label]) => cycle.includes(label))?.[1] ?? 5;
    const delta = (targetDay - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next <= from) next.setDate(next.getDate() + 7);
    return next;
  }

  if (cycle.includes("분기")) {
    const currentQuarterStart = Math.floor(next.getMonth() / 3) * 3;
    next.setMonth(currentQuarterStart, 1);
    if (next <= from) next.setMonth(currentQuarterStart + 3, 1);
    return next;
  }

  const targetDay = cycle.includes("말") ? lastDayOfMonth(next.getFullYear(), next.getMonth()) : Number(cycle.match(/\d+/)?.[0] ?? 1);
  next.setDate(Math.min(Math.max(targetDay, 1), lastDayOfMonth(next.getFullYear(), next.getMonth())));
  if (next <= from) {
    next.setMonth(next.getMonth() + 1, 1);
    const nextTargetDay = cycle.includes("말") ? lastDayOfMonth(next.getFullYear(), next.getMonth()) : targetDay;
    next.setDate(Math.min(nextTargetDay, lastDayOfMonth(next.getFullYear(), next.getMonth())));
  }
  return next;
}

function retryAt(attempt: number, policy: ReportJobPolicy, now: Date) {
  const seconds = Math.min(policy.retryMaxSeconds, policy.retryBaseSeconds * (2 ** Math.max(0, attempt - 1)));
  return new Date(now.getTime() + seconds * 1_000);
}

function jobSummaryText(input: Record<string, unknown>) {
  return JSON.stringify({
    summary: "예약 보고서 job 실행",
    job: "scheduled_report_job",
    ...input,
  });
}
function reportArtifactStorageKey(reportRunId: string) {
  return `reports/${reportRunId}.artifact.json`;
}

function safeReportFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
}

function displayScheduledReportType(type: string) {
  const map: Record<string, string> = {
    COMPREHENSIVE: "종합",
    DISBURSEMENT: "지급",
    APPROVAL: "승인",
    BUDGET: "예산",
    VENDOR: "거래처",
  };
  return map[type] ?? type;
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function pdfSafeText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function scheduledReportRow(runName: string, schedule: ReportScheduleJob, delivery: ReportScheduleDelivery, now: Date) {
  return {
    보고서명: runName,
    유형: displayScheduledReportType(schedule.definition.type),
    기간: "-",
    생성일시: now.toISOString().slice(0, 16).replace("T", " "),
    생성자: schedule.owner.name,
    요약: `예약 보고서 ${delivery.recipients.length}명 ${delivery.format} 처리`,
    수신자수: String(delivery.recipients.length),
    형식: delivery.format,
  };
}

function buildScheduledReportDownload(runName: string, schedule: ReportScheduleJob, delivery: ReportScheduleDelivery, now: Date, format: "csv" | "pdf") {
  const generatedAt = now.toISOString();
  const row = scheduledReportRow(runName, schedule, delivery, now);
  const extension = format === "pdf" ? "pdf" : "csv";
  const contentType = format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8";
  const csvColumns = ["보고서명", "유형", "기간", "생성일시", "생성자", "요약", "수신자수", "형식"];
  const csv = `\uFEFF${csvColumns.map(escapeCsvCell).join(",")}\r\n${csvColumns.map((column) => escapeCsvCell(row[column as keyof typeof row] ?? "")).join(",")}`;
  const pdfLines = [
    "Payment Approval ERP Scheduled Report",
    `Generated: ${generatedAt.slice(0, 10)}`,
    `Report: ${row.보고서명}`,
    `Type: ${row.유형}`,
    `Creator: ${row.생성자}`,
    `Summary: ${row.요약}`,
  ];
  const pdfContent = pdfLines
    .map((line, index) => `BT /F1 10 Tf 48 ${744 - index * 18} Td (${pdfSafeText(line)}) Tj ET`)
    .join("\n");
  const pdfObjects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${pdfContent.length} >> stream\n${pdfContent}\nendstream\nendobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const pdfOffsets = pdfObjects.map((object) => {
    const offset = pdf.length;
    pdf += `${object}\n`;
    return offset;
  });
  const pdfXrefStart = pdf.length;
  pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n`;
  pdf += pdfOffsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n");
  pdf += `\ntrailer << /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${pdfXrefStart}\n%%EOF`;
  const content = format === "pdf" ? pdf : csv;
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");
  return {
    fileName: `${safeReportFileName(runName)}-${generatedAt.replace(/\D/g, "").slice(0, 14)}.${extension}`,
    contentType,
    contentBase64,
    generatedAt,
    limits: {
      rowCount: delivery.recipients.length,
      contentBytes: Buffer.byteLength(contentBase64, "utf8"),
    },
    report: row,
  };
}

async function writeScheduledReportArtifact(reportRunId: string, runName: string, schedule: ReportScheduleJob, delivery: ReportScheduleDelivery, now: Date) {
  const artifactKey = reportArtifactStorageKey(reportRunId);
  const artifact = {
    schemaVersion: 1,
    reportRunId,
    reportName: runName,
    storedAt: now.toISOString(),
    files: {
      csv: buildScheduledReportDownload(runName, schedule, delivery, now, "csv"),
      pdf: buildScheduledReportDownload(runName, schedule, delivery, now, "pdf"),
    },
  };
  const stored = await writeStoredFile(artifactKey, JSON.stringify(artifact), "application/json");
  return { artifactKey, checksum: stored.checksum, byteSize: stored.byteSize };
}

async function consecutiveFailureCount(scheduleId: string, db: Pick<PrismaClient, "auditLog">) {
  const logs = await db.auditLog.findMany({
    where: {
      entityType: "report_schedule",
      entityId: scheduleId,
      action: { in: ["report_schedule_job_delivered", "report_schedule_job_failed", "report_schedule_dead_letter"] },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  let count = 0;
  for (const log of logs) {
    if (log.action === "report_schedule_job_delivered") break;
    if (log.action === "report_schedule_job_failed" || log.action === "report_schedule_dead_letter") count += 1;
  }
  return count;
}

async function circuitBreakerState(now: Date, policy: ReportJobPolicy, db: Pick<PrismaClient, "auditLog">) {
  const since = new Date(now.getTime() - policy.circuitBreakerWindowMinutes * 60 * 1_000);
  const recentFailures = await db.auditLog.count({
    where: {
      entityType: "report_schedule",
      action: { in: ["report_schedule_job_failed", "report_schedule_dead_letter"] },
      createdAt: { gte: since },
    },
  });
  return {
    open: recentFailures >= policy.circuitBreakerFailureThreshold,
    recentFailures,
    threshold: policy.circuitBreakerFailureThreshold,
    windowMinutes: policy.circuitBreakerWindowMinutes,
    since: since.toISOString(),
  };
}

async function deliverScheduledReport(schedule: ReportScheduleJob, delivery: ReportScheduleDelivery, policy: ReportJobPolicy) {
  if (policy.deliveryMode !== "webhook") return { deliveryMode: "internal", httpStatus: null as number | null };
  if (!policy.webhookUrl) throw new Error("REPORT_DELIVERY_WEBHOOK_URL is required when REPORT_DELIVERY_MODE=webhook.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    const response = await fetch(policy.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.REPORT_DELIVERY_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.REPORT_DELIVERY_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        scheduleId: schedule.id,
        reportName: schedule.definition.name,
        reportType: schedule.definition.type,
        recipients: delivery.recipients,
        format: delivery.format,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`REPORT_DELIVERY_WEBHOOK_FAILED:${response.status}`);
    return { deliveryMode: "webhook", httpStatus: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function auditRequestContext(requestId: string) {
  return {
    requestId,
    ipAddress: "system:report-job-worker",
    userAgent: "report-job-worker",
  };
}

async function markScheduleDeadLetter(
  schedule: ReportScheduleJob,
  attempt: number,
  errorMessage: string,
  policy: ReportJobPolicy,
  now: Date,
  db: ReportJobDb,
) {
  const requestId = `report-job-dead-letter-${schedule.id}-${now.getTime()}`;
  await db.$transaction(async (tx) => {
    const run = await tx.reportRun.create({
      data: {
        definitionId: schedule.definitionId,
        createdBy: schedule.userId,
        name: `${schedule.definition.name} 예약 실패 ${now.toISOString().slice(0, 10)}`,
        type: schedule.definition.type,
        status: ReportRunStatus.FAILED,
        summary: jobSummaryText({ status: "dead_letter", attempt, maxAttempts: policy.maxAttempts, errorMessage }),
        rowCount: 0,
      },
    });
    await tx.reportSchedule.update({
      where: { id: schedule.id },
      data: { isActive: false, nextRunAt: null, rowVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        entityType: "report_schedule",
        entityId: schedule.id,
        actorId: schedule.userId,
        action: "report_schedule_dead_letter",
        beforeValue: { nextRunAt: schedule.nextRunAt?.toISOString() ?? null, isActive: schedule.isActive },
        afterValue: { runId: run.id, deadLetter: true, attempt, maxAttempts: policy.maxAttempts, errorMessage },
        reason: "보고서 예약 job 최대 재시도 초과",
        ...auditRequestContext(requestId),
      },
    });
    await tx.notification.create({
      data: {
        userId: schedule.userId,
        type: NotificationType.OPERATIONAL_ALERT,
        title: "보고서 예약 발송 중지",
        message: `${schedule.definition.name} 예약이 ${policy.maxAttempts}회 실패해 dead-letter 처리되었습니다.`,
        entityType: "report_schedule",
        entityId: schedule.id,
        linkPath: "#reports",
        expiresAt: notificationExpiresAt(now),
      },
    });
  });
  return {
    scheduleId: schedule.id,
    reportName: schedule.definition.name,
    status: "dead_letter" as const,
    attempt,
    nextRunAt: null as string | null,
    errorMessage,
  };
}

async function markScheduleFailure(
  schedule: ReportScheduleJob,
  attempt: number,
  errorMessage: string,
  policy: ReportJobPolicy,
  now: Date,
  db: ReportJobDb,
) {
  if (attempt >= policy.maxAttempts) return markScheduleDeadLetter(schedule, attempt, errorMessage, policy, now, db);
  const nextRetryAt = retryAt(attempt, policy, now);
  const requestId = `report-job-failed-${schedule.id}-${now.getTime()}`;
  await db.$transaction(async (tx) => {
    const run = await tx.reportRun.create({
      data: {
        definitionId: schedule.definitionId,
        createdBy: schedule.userId,
        name: `${schedule.definition.name} 예약 실패 ${now.toISOString().slice(0, 10)}`,
        type: schedule.definition.type,
        status: ReportRunStatus.FAILED,
        summary: jobSummaryText({ status: "retry_scheduled", attempt, maxAttempts: policy.maxAttempts, retryAt: nextRetryAt.toISOString(), errorMessage }),
        rowCount: 0,
      },
    });
    await tx.reportSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: nextRetryAt, rowVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        entityType: "report_schedule",
        entityId: schedule.id,
        actorId: schedule.userId,
        action: "report_schedule_job_failed",
        beforeValue: { nextRunAt: schedule.nextRunAt?.toISOString() ?? null },
        afterValue: { runId: run.id, retryAt: nextRetryAt.toISOString(), attempt, maxAttempts: policy.maxAttempts, errorMessage },
        reason: "보고서 예약 job 실패 후 재시도 예약",
        ...auditRequestContext(requestId),
      },
    });
  });
  return {
    scheduleId: schedule.id,
    reportName: schedule.definition.name,
    status: "retry_scheduled" as const,
    attempt,
    nextRunAt: nextRetryAt.toISOString(),
    errorMessage,
  };
}

async function processSchedule(schedule: ReportScheduleJob, policy: ReportJobPolicy, now: Date, db: ReportJobDb) {
  const failureCount = await consecutiveFailureCount(schedule.id, db);
  const attempt = failureCount + 1;
  const delivery = reportScheduleDeliveryFromJson(schedule.recipients);
  try {
    const reportRunId = randomUUID();
    const runName = `${schedule.definition.name} 예약 ${now.toISOString().slice(0, 10)}`;
    const deliveryResult = await deliverScheduledReport(schedule, delivery, policy);
    const artifact = await writeScheduledReportArtifact(reportRunId, runName, schedule, delivery, now);
    const nextRunAt = nextReportScheduleRunAt(delivery, now);
    const requestId = `report-job-delivered-${schedule.id}-${now.getTime()}`;
    await db.$transaction(async (tx) => {
      const run = await tx.reportRun.create({
        data: {
          id: reportRunId,
          definitionId: schedule.definitionId,
          createdBy: schedule.userId,
          name: runName,
          type: schedule.definition.type,
          status: ReportRunStatus.READY,
          artifactKey: artifact.artifactKey,
          summary: jobSummaryText({
            status: "delivered",
            deliveryMode: deliveryResult.deliveryMode,
            httpStatus: deliveryResult.httpStatus,
            recipients: delivery.recipients.length,
            format: delivery.format,
          }),
          rowCount: delivery.recipients.length,
        },
      });
      await tx.reportSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt, rowVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          entityType: "report_schedule",
          entityId: schedule.id,
          actorId: schedule.userId,
          action: "report_schedule_job_delivered",
          beforeValue: { nextRunAt: schedule.nextRunAt?.toISOString() ?? null },
          afterValue: { runId: run.id, nextRunAt: nextRunAt.toISOString(), attempt, deliveryMode: deliveryResult.deliveryMode, artifactKey: artifact.artifactKey, artifactByteSize: artifact.byteSize, artifactChecksum: artifact.checksum },
          reason: "보고서 예약 job 발송 완료",
          ...auditRequestContext(requestId),
        },
      });
      await tx.notification.create({
        data: {
          userId: schedule.userId,
          type: NotificationType.SYSTEM_SETTING_CHANGED,
          title: "보고서 예약 발송 완료",
          message: `${schedule.definition.name} 예약 보고서가 ${delivery.recipients.length}명에게 ${delivery.format} 형식으로 처리되었습니다.`,
          entityType: "report_run",
          entityId: run.id,
          linkPath: "#reports",
          expiresAt: notificationExpiresAt(now),
        },
      });
    });
    return {
      scheduleId: schedule.id,
      reportName: schedule.definition.name,
      status: "delivered" as const,
      attempt,
      nextRunAt: nextRunAt.toISOString(),
      errorMessage: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "report job delivery failed";
    return markScheduleFailure(schedule, attempt, message, policy, now, db);
  }
}

export async function processDueReportSchedules(
  options: ReportJobRunOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  db: ReportJobDb = prisma,
) {
  const now = new Date();
  const policy = { ...reportJobPolicy(env), ...(options.batchSize ? { batchSize: Math.min(Math.max(options.batchSize, 1), 100) } : {}) };
  const circuitBreaker = await circuitBreakerState(now, policy, db);
  const dueSchedules = await db.reportSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    include: {
      definition: true,
      owner: true,
    },
    orderBy: { nextRunAt: "asc" },
    take: policy.batchSize,
  });

  if (options.dryRun || circuitBreaker.open) {
    return {
      ok: !circuitBreaker.open,
      dryRun: Boolean(options.dryRun),
      generatedAt: now.toISOString(),
      policy: publicReportJobPolicy(policy),
      circuitBreaker,
      summary: {
        due: dueSchedules.length,
        processed: 0,
        delivered: 0,
        retryScheduled: 0,
        deadLetter: 0,
        skipped: circuitBreaker.open ? dueSchedules.length : 0,
      },
      dueSchedules: dueSchedules.map((schedule) => ({
        id: schedule.id,
        reportName: schedule.definition.name,
        owner: schedule.owner.name,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      })),
      results: [],
    };
  }

  const results: Awaited<ReturnType<typeof processSchedule>>[] = [];
  for (const schedule of dueSchedules) {
    results.push(await processSchedule(schedule, policy, now, db));
  }

  return {
    ok: results.every((result) => result.status === "delivered"),
    dryRun: false,
    generatedAt: now.toISOString(),
    policy: publicReportJobPolicy(policy),
    circuitBreaker,
    summary: {
      due: dueSchedules.length,
      processed: results.length,
      delivered: results.filter((result) => result.status === "delivered").length,
      retryScheduled: results.filter((result) => result.status === "retry_scheduled").length,
      deadLetter: results.filter((result) => result.status === "dead_letter").length,
      skipped: 0,
    },
    dueSchedules: dueSchedules.map((schedule) => ({
      id: schedule.id,
      reportName: schedule.definition.name,
      owner: schedule.owner.name,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
    })),
    results,
  };
}
