import { NotificationType, type Prisma, type PrismaClient } from "../../generated/prisma/index.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";
import { alertWindowMinutes } from "./operationalAlerts.js";

export type BusinessFailureSeverity = "warning" | "critical";

export type BusinessFailureRule = {
  id: string;
  label: string;
  pathPrefixes: string[];
  eventTypes: string[];
  thresholdEnv: string;
  defaultThreshold: number;
  severity: BusinessFailureSeverity;
  ownerPermission: string;
  linkPath: string;
  runbook: string;
};

type SecurityEventRow = {
  id: string;
  eventType: string;
  errorCode: string;
  message: string;
  statusCode: number;
  path: string | null;
  requestId: string;
  createdAt: Date;
};

type BusinessFailureDb = Pick<PrismaClient, "securityEvent" | "user" | "notification">;

const processingFailureEventTypes = [
  "workflow_blocked",
  "validation_rejected",
  "partial_failure",
  "duplicate_request_blocked",
  "access_denied",
  "server_failure",
  "api_failure",
];

const fileFailureEventTypes = [
  "file_upload_rejected",
  "file_scan_unavailable",
  "file_malware_blocked",
  "file_access_denied",
  "file_signed_url_rejected",
  ...processingFailureEventTypes,
];

export const businessFailureRules: BusinessFailureRule[] = [
  {
    id: "approval_processing_failure",
    label: "승인 처리 실패",
    pathPrefixes: ["/api/approvals"],
    eventTypes: processingFailureEventTypes,
    thresholdEnv: "ALERT_APPROVAL_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "critical",
    ownerPermission: "system:manage",
    linkPath: "#approval",
    runbook: "승인 route의 requestId, 결재 단계 상태, rowVersion, 권한, 최근 정책 변경을 확인한다.",
  },
  {
    id: "disbursement_processing_failure",
    label: "지급 처리 실패",
    pathPrefixes: ["/api/disbursements"],
    eventTypes: processingFailureEventTypes,
    thresholdEnv: "ALERT_DISBURSEMENT_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "critical",
    ownerPermission: "system:manage",
    linkPath: "#disbursement",
    runbook: "지급 rowVersion, 2인 확인 감사 로그, 승인번호/금액/거래처 일치, 계좌 검증 상태를 확인한다.",
  },
  {
    id: "report_processing_failure",
    label: "보고서 처리 실패",
    pathPrefixes: ["/api/reports"],
    eventTypes: processingFailureEventTypes,
    thresholdEnv: "ALERT_REPORT_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "warning",
    ownerPermission: "system:manage",
    linkPath: "#reports",
    runbook: "ReportRun/ReportSchedule 상태, 다운로드 감사 로그, job backlog, 외부 발송 adapter 상태를 확인한다.",
  },
  {
    id: "notification_processing_failure",
    label: "알림 처리 실패",
    pathPrefixes: ["/api/notifications"],
    eventTypes: processingFailureEventTypes,
    thresholdEnv: "ALERT_NOTIFICATION_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "warning",
    ownerPermission: "system:manage",
    linkPath: "#settings",
    runbook: "Notification 만료/읽음 scope, 사용자 권한, 알림 테이블 쓰기 실패, 최근 auth/session 오류를 확인한다.",
  },
  {
    id: "file_processing_failure",
    label: "파일 처리 실패",
    pathPrefixes: ["/api/files"],
    eventTypes: fileFailureEventTypes,
    thresholdEnv: "ALERT_FILE_PROCESSING_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "critical",
    ownerPermission: "system:manage",
    linkPath: "#settings",
    runbook: "Object storage, signed URL, malware scanner, 파일 권한, 업로드 complete 상태와 requestId를 확인한다.",
  },
];

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function businessFailureThreshold(rule: BusinessFailureRule, env: NodeJS.ProcessEnv = process.env) {
  return positiveInteger(env[rule.thresholdEnv], rule.defaultThreshold);
}

function normalizePath(path: string | null) {
  return (path ?? "").split("?")[0];
}

function matchesBusinessFailureRule(event: SecurityEventRow, rule: BusinessFailureRule) {
  const path = normalizePath(event.path);
  return rule.eventTypes.includes(event.eventType) && rule.pathPrefixes.some((prefix) => path.startsWith(prefix));
}

export function evaluateBusinessFailureRule(
  rule: BusinessFailureRule,
  events: SecurityEventRow[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const threshold = businessFailureThreshold(rule, env);
  const matchingEvents = events.filter((event) => matchesBusinessFailureRule(event, rule));
  return {
    id: rule.id,
    label: rule.label,
    ok: matchingEvents.length < threshold,
    count: matchingEvents.length,
    threshold,
    pathPrefixes: rule.pathPrefixes,
    eventTypes: rule.eventTypes,
    severity: rule.severity,
    ownerPermission: rule.ownerPermission,
    linkPath: rule.linkPath,
    runbook: rule.runbook,
    recentEvents: matchingEvents.slice(0, 5).map((event) => ({
      id: event.id,
      eventType: event.eventType,
      errorCode: event.errorCode,
      message: event.message,
      statusCode: event.statusCode,
      path: event.path,
      requestId: event.requestId,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

async function readBusinessFailureEvents(since: Date, db: Pick<PrismaClient, "securityEvent">) {
  const eventTypes = [...new Set(businessFailureRules.flatMap((rule) => rule.eventTypes))];
  return db.securityEvent.findMany({
    where: {
      eventType: { in: eventTypes },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      eventType: true,
      errorCode: true,
      message: true,
      statusCode: true,
      path: true,
      requestId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBusinessFailureAlertSummary(
  env: NodeJS.ProcessEnv = process.env,
  db: Pick<PrismaClient, "securityEvent"> = prisma,
) {
  const now = new Date();
  const windowMinutes = alertWindowMinutes(env);
  const since = new Date(now.getTime() - windowMinutes * 60 * 1000);
  let events: SecurityEventRow[] = [];
  let eventReadError: string | null = null;

  try {
    events = await readBusinessFailureEvents(since, db);
  } catch (error) {
    eventReadError = error instanceof Error ? error.message : "business failure event summary failed";
  }

  const rules = businessFailureRules.map((rule) => evaluateBusinessFailureRule(rule, events, env));
  const triggered = rules.filter((rule) => !rule.ok);

  return {
    ok: !eventReadError && triggered.length === 0,
    windowMinutes,
    since: since.toISOString(),
    until: now.toISOString(),
    eventsReviewed: events.length,
    eventReadError,
    rules,
    triggered,
  };
}

function normalizePermissions(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function findOperationalOwnerIds(db: Pick<PrismaClient, "user">, permission = "system:manage") {
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
        return permissions.includes("*") || permissions.includes(permission);
      }),
    )
    .map((user) => user.id);
}

export async function notifyBusinessFailureOwners(
  env: NodeJS.ProcessEnv = process.env,
  db: BusinessFailureDb = prisma,
) {
  const summary = await getBusinessFailureAlertSummary(env, db);
  const triggered = summary.triggered;
  if (triggered.length === 0) {
    return {
      summary,
      recipientCount: 0,
      notificationsCreated: 0,
    };
  }

  const recipientIds = await findOperationalOwnerIds(db);
  if (recipientIds.length === 0) {
    return {
      summary,
      recipientCount: 0,
      notificationsCreated: 0,
    };
  }

  const triggeredIds = triggered.map((rule) => rule.id);
  const since = new Date(summary.since);
  const existing = await db.notification.findMany({
    where: {
      userId: { in: recipientIds },
      type: NotificationType.OPERATIONAL_ALERT,
      entityType: "BUSINESS_FAILURE_ALERT",
      entityId: { in: triggeredIds },
      createdAt: { gte: since },
    },
    select: {
      userId: true,
      entityId: true,
    },
  });
  const existingKeys = new Set(existing.map((item) => `${item.userId}:${item.entityId}`));

  const expiresAt = notificationExpiresAt();
  const notificationRows: Prisma.NotificationCreateManyInput[] = [];
  for (const rule of triggered) {
    for (const userId of recipientIds) {
      const key = `${userId}:${rule.id}`;
      if (existingKeys.has(key)) continue;
      notificationRows.push({
        userId,
        type: NotificationType.OPERATIONAL_ALERT,
        title: `운영 알림: ${rule.label}`,
        message: `${summary.windowMinutes}분 동안 ${rule.label} ${rule.count}건이 발생했습니다. requestId와 운영 runbook을 확인하세요.`,
        entityType: "BUSINESS_FAILURE_ALERT",
        entityId: rule.id,
        linkPath: rule.linkPath,
        expiresAt,
      });
    }
  }

  const result = notificationRows.length > 0 ? await db.notification.createMany({ data: notificationRows }) : { count: 0 };

  return {
    summary,
    recipientCount: recipientIds.length,
    notificationsCreated: result.count,
  };
}
