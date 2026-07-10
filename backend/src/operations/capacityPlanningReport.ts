import { prisma } from "../db/prisma.js";

export type CapacityPlanningBaseline = {
  paymentRequests: number;
  approvalSteps: number;
  disbursements: number;
  vendors: number;
  notifications: number;
  reportRuns: number;
  dataQualityRuns: number;
  auditLogs: number;
  attachments: number;
  attachmentBytes: number;
};

function positiveNumber(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function percent(value: string | undefined, fallback: number) {
  return positiveNumber(value, fallback, 100);
}

function growthPercent(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 100) : fallback;
}

function monthKey(date: Date, offset = 0) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function projected(value: number, growthPercent: number, offset: number) {
  return Math.round(value * ((1 + growthPercent / 100) ** offset));
}

function utilization(value: number, limit: number) {
  return Number(((value / Math.max(1, limit)) * 100).toFixed(2));
}

function capacityLevel(dbPercent: number, objectPercent: number, warningPercent: number, criticalPercent: number) {
  const highest = Math.max(dbPercent, objectPercent);
  if (highest >= criticalPercent) return "critical" as const;
  if (highest >= warningPercent) return "warning" as const;
  return "normal" as const;
}

export function buildCapacityPlanningReport(
  baseline: CapacityPlanningBaseline,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
) {
  const forecastMonths = Math.round(positiveNumber(env.CAPACITY_FORECAST_MONTHS, 12, 36));
  const transactionGrowthPercent = growthPercent(env.CAPACITY_TRANSACTION_GROWTH_PERCENT, 8);
  const auditGrowthPercent = growthPercent(env.CAPACITY_AUDIT_GROWTH_PERCENT, 12);
  const attachmentGrowthPercent = growthPercent(env.CAPACITY_ATTACHMENT_GROWTH_PERCENT, 10);
  const databaseLimitBytes = positiveNumber(env.CAPACITY_DATABASE_LIMIT_BYTES, 20 * 1024 ** 3, Number.MAX_SAFE_INTEGER);
  const objectStorageLimitBytes = positiveNumber(env.CAPACITY_OBJECT_STORAGE_LIMIT_BYTES, 200 * 1024 ** 3, Number.MAX_SAFE_INTEGER);
  const averageBusinessRowBytes = positiveNumber(env.CAPACITY_AVG_BUSINESS_ROW_BYTES, 2_048, 1024 ** 2);
  const averageAuditRowBytes = positiveNumber(env.CAPACITY_AVG_AUDIT_ROW_BYTES, 1_536, 1024 ** 2);
  const averageMetadataRowBytes = positiveNumber(env.CAPACITY_AVG_METADATA_ROW_BYTES, 1_024, 1024 ** 2);
  const warningPercent = percent(env.CAPACITY_WARNING_PERCENT, 70);
  const criticalPercent = Math.max(warningPercent, percent(env.CAPACITY_CRITICAL_PERCENT, 85));
  const businessRows = baseline.paymentRequests
    + baseline.approvalSteps
    + baseline.disbursements
    + baseline.vendors
    + baseline.notifications
    + baseline.reportRuns
    + baseline.dataQualityRuns;

  const forecast = Array.from({ length: forecastMonths + 1 }, (_, offset) => {
    const projectedBusinessRows = projected(businessRows, transactionGrowthPercent, offset);
    const projectedAuditLogs = projected(baseline.auditLogs, auditGrowthPercent, offset);
    const projectedAttachments = projected(baseline.attachments, attachmentGrowthPercent, offset);
    const projectedAttachmentBytes = projected(baseline.attachmentBytes, attachmentGrowthPercent, offset);
    const estimatedDatabaseBytes = projectedBusinessRows * averageBusinessRowBytes
      + projectedAuditLogs * averageAuditRowBytes
      + projectedAttachments * averageMetadataRowBytes;
    const databaseUtilizationPercent = utilization(estimatedDatabaseBytes, databaseLimitBytes);
    const objectStorageUtilizationPercent = utilization(projectedAttachmentBytes, objectStorageLimitBytes);
    return {
      month: monthKey(now, offset),
      offset,
      businessRows: projectedBusinessRows,
      auditLogs: projectedAuditLogs,
      attachments: projectedAttachments,
      estimatedDatabaseBytes,
      objectStorageBytes: projectedAttachmentBytes,
      databaseUtilizationPercent,
      objectStorageUtilizationPercent,
      level: capacityLevel(databaseUtilizationPercent, objectStorageUtilizationPercent, warningPercent, criticalPercent),
    };
  });
  const firstWarning = forecast.find((item) => item.level !== "normal") ?? null;
  const firstCritical = forecast.find((item) => item.level === "critical") ?? null;
  const current = forecast[0];
  const last = forecast.at(-1) ?? current;
  const recommendedActions = [
    "월 1회 실측 baseline을 갱신하고 예측 오차를 검토합니다.",
    ...(firstWarning ? [`${firstWarning.month} 이전에 DB/object storage 증설 또는 보관 정책 조정을 승인합니다.`] : []),
    ...(last.databaseUtilizationPercent >= warningPercent ? ["AuditLog 월 단위 partition과 보관/아카이브 정책을 검토합니다."] : []),
    ...(last.objectStorageUtilizationPercent >= warningPercent ? ["첨부 저장소 lifecycle, versioning 보관 기간, cold tier 전환을 검토합니다."] : []),
  ];

  return {
    ok: current.level !== "critical",
    actionRequired: Boolean(firstWarning),
    generatedAt: now.toISOString(),
    baselineMonth: monthKey(now),
    source: "Prisma aggregate counts + Attachment.byteSize",
    assumptions: {
      forecastMonths,
      transactionGrowthPercent,
      auditGrowthPercent,
      attachmentGrowthPercent,
      databaseLimitBytes,
      objectStorageLimitBytes,
      averageBusinessRowBytes,
      averageAuditRowBytes,
      averageMetadataRowBytes,
      warningPercent,
      criticalPercent,
    },
    baseline: {
      ...baseline,
      businessRows,
      estimatedDatabaseBytes: current.estimatedDatabaseBytes,
    },
    summary: {
      firstWarningMonth: firstWarning?.month ?? null,
      firstCriticalMonth: firstCritical?.month ?? null,
      capacityHeadroomMonths: firstCritical?.offset ?? forecastMonths + 1,
      peakDatabaseUtilizationPercent: last.databaseUtilizationPercent,
      peakObjectStorageUtilizationPercent: last.objectStorageUtilizationPercent,
      nextReviewMonth: monthKey(now, 1),
    },
    forecast,
    recommendedActions,
  };
}

export async function getCapacityPlanningReport(env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  const [
    paymentRequests,
    approvalSteps,
    disbursements,
    vendors,
    notifications,
    reportRuns,
    dataQualityRuns,
    auditLogs,
    attachmentAggregate,
  ] = await Promise.all([
    prisma.paymentRequest.count(),
    prisma.approvalStep.count(),
    prisma.disbursement.count(),
    prisma.vendor.count(),
    prisma.notification.count(),
    prisma.reportRun.count(),
    prisma.dataQualityRun.count(),
    prisma.auditLog.count(),
    prisma.attachment.aggregate({ _count: { _all: true }, _sum: { byteSize: true } }),
  ]);
  return buildCapacityPlanningReport({
    paymentRequests,
    approvalSteps,
    disbursements,
    vendors,
    notifications,
    reportRuns,
    dataQualityRuns,
    auditLogs,
    attachments: attachmentAggregate._count._all,
    attachmentBytes: Number(attachmentAggregate._sum.byteSize ?? 0n),
  }, env, now);
}
