import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { evaluateLatencyTargets } from "./performancePolicy.js";

export type OperationalAlertSeverity = "warning" | "critical";

export type OperationalAlertRule = {
  id: string;
  label: string;
  eventTypes: string[];
  thresholdEnv: string;
  defaultThreshold: number;
  severity: OperationalAlertSeverity;
  runbook: string;
};

export const operationalAlertRules: OperationalAlertRule[] = [
  {
    id: "api_5xx",
    label: "API 5xx",
    eventTypes: ["server_failure"],
    thresholdEnv: "ALERT_API_5XX_THRESHOLD",
    defaultThreshold: 1,
    severity: "critical",
    runbook: "API 로그와 security_events의 requestId를 기준으로 최근 배포, DB, 외부 저장소 상태를 확인한다.",
  },
  {
    id: "slow_query",
    label: "Slow query",
    eventTypes: ["slow_query"],
    thresholdEnv: "ALERT_SLOW_QUERY_THRESHOLD",
    defaultThreshold: 1,
    severity: "warning",
    runbook: "DB slow query 로그와 API latency를 같은 시간대로 대사하고 필요한 index 또는 pagination 기준을 조정한다.",
  },
  {
    id: "login_failure_spike",
    label: "Login failure spike",
    eventTypes: ["login_rejected", "auth_required"],
    thresholdEnv: "ALERT_LOGIN_FAILURE_THRESHOLD",
    defaultThreshold: 10,
    severity: "warning",
    runbook: "동일 IP/계정 반복 실패, 계정 잠금 필요성, SSO/비밀번호 정책 변경 여부를 확인한다.",
  },
  {
    id: "permission_failure_spike",
    label: "Permission failure spike",
    eventTypes: ["access_denied"],
    thresholdEnv: "ALERT_PERMISSION_FAILURE_THRESHOLD",
    defaultThreshold: 10,
    severity: "warning",
    runbook: "최근 권한 변경, 역할 매핑, 사용자가 접근하려던 메뉴와 backend FORBIDDEN requestId를 확인한다.",
  },
  {
    id: "file_upload_failure",
    label: "File upload failure",
    eventTypes: ["file_upload_rejected", "file_scan_unavailable", "file_malware_blocked"],
    thresholdEnv: "ALERT_FILE_UPLOAD_FAILURE_THRESHOLD",
    defaultThreshold: 1,
    severity: "critical",
    runbook: "object storage, malware scanner, 파일 확장자/용량 정책, signed URL 만료와 requestId를 확인한다.",
  },
];

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function alertWindowMinutes(env: NodeJS.ProcessEnv = process.env) {
  return positiveInteger(env.ALERT_WINDOW_MINUTES, 15);
}

export function alertThreshold(rule: OperationalAlertRule, env: NodeJS.ProcessEnv = process.env) {
  return positiveInteger(env[rule.thresholdEnv], rule.defaultThreshold);
}

export function evaluateAlertRule(
  rule: OperationalAlertRule,
  countsByEventType: Record<string, number>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const threshold = alertThreshold(rule, env);
  const count = rule.eventTypes.reduce((sum, eventType) => sum + (countsByEventType[eventType] ?? 0), 0);
  return {
    id: rule.id,
    label: rule.label,
    ok: count < threshold,
    count,
    threshold,
    eventTypes: rule.eventTypes,
    severity: rule.severity,
    runbook: rule.runbook,
  };
}

async function checkDatabase(db: Pick<PrismaClient, "$queryRaw">) {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`select 1`;
    return { ok: true, latencyMs: Date.now() - startedAt, error: null as string | null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "DB health check failed",
    };
  }
}

async function securityEventCounts(since: Date, db: Pick<PrismaClient, "securityEvent">) {
  const eventTypes = [...new Set(operationalAlertRules.flatMap((rule) => rule.eventTypes))];
  const rows = await db.securityEvent.groupBy({
    by: ["eventType"],
    where: {
      eventType: { in: eventTypes },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.eventType, row._count._all]));
}

function metadataNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = (value as Record<string, unknown>)[key];
  const parsed = typeof item === "number" ? item : typeof item === "string" ? Number(item) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

async function slowQueryLatencyMetrics(since: Date, db: Pick<PrismaClient, "securityEvent">) {
  const rows = await db.securityEvent.findMany({
    where: {
      eventType: "slow_query",
      createdAt: { gte: since },
    },
    select: { metadata: true },
    orderBy: { createdAt: "desc" },
    take: 1_000,
  });
  const durations = rows
    .map((row) => metadataNumber(row.metadata, "durationMs"))
    .filter((value): value is number => value !== null);
  return {
    sampleSize: durations.length,
    p95LatencyMs: percentile(durations, 0.95),
    p99LatencyMs: percentile(durations, 0.99),
    maxLatencyMs: durations.length ? Math.max(...durations) : null,
  };
}

export async function getOperationalAlertSummary(
  env: NodeJS.ProcessEnv = process.env,
  db: Pick<PrismaClient, "$queryRaw" | "securityEvent"> = prisma,
) {
  const now = new Date();
  const windowMinutes = alertWindowMinutes(env);
  const since = new Date(now.getTime() - windowMinutes * 60 * 1000);
  const database = await checkDatabase(db);
  let countsByEventType: Record<string, number> = {};
  let eventReadError: string | null = null;
  let latency = {
    sampleSize: 0,
    p95LatencyMs: null as number | null,
    p99LatencyMs: null as number | null,
    maxLatencyMs: null as number | null,
  };

  if (database.ok) {
    try {
      countsByEventType = await securityEventCounts(since, db);
      latency = await slowQueryLatencyMetrics(since, db);
    } catch (error) {
      eventReadError = error instanceof Error ? error.message : "security event summary failed";
    }
  } else {
    eventReadError = "DB connection check failed before reading security_events.";
  }

  const dbRule = {
    id: "db_connection",
    label: "DB connection",
    ok: database.ok,
    count: database.ok ? 0 : 1,
    threshold: 1,
    eventTypes: ["health/db"],
    severity: "critical" as const,
    runbook: "DB 연결 문자열, 네트워크, connection pool, migration 상태를 확인한다.",
  };
  const eventReadRule = {
    id: "security_event_read",
    label: "Security event read",
    ok: !eventReadError,
    count: eventReadError ? 1 : 0,
    threshold: 1,
    eventTypes: ["security_events"],
    severity: "warning" as const,
    runbook: "security_events 조회 권한, migration, DB 성능을 확인한다.",
  };
  const eventRules = operationalAlertRules.map((rule) => evaluateAlertRule(rule, countsByEventType, env));
  const rules = [dbRule, eventReadRule, ...eventRules];
  const triggered = rules.filter((rule) => !rule.ok);
  const eventsReviewed = Object.values(countsByEventType).reduce((sum, count) => sum + count, 0) + (database.ok ? 0 : 1) + (eventReadError ? 1 : 0);
  const ruleFailureRatePercent = rules.length > 0 ? Math.round((triggered.length / rules.length) * 10_000) / 100 : 0;

  return {
    ok: triggered.length === 0,
    windowMinutes,
    since: since.toISOString(),
    until: now.toISOString(),
    database,
    countsByEventType,
    eventReadError,
    rules,
    triggered,
    metrics: {
      eventsReviewed,
      ruleFailureRatePercent,
      criticalTriggered: triggered.filter((rule) => rule.severity === "critical").length,
      warningTriggered: triggered.filter((rule) => rule.severity === "warning").length,
      p95LatencyMs: latency.p95LatencyMs ?? database.latencyMs,
      p99LatencyMs: latency.p99LatencyMs,
      maxLatencyMs: latency.maxLatencyMs,
      latencySampleSize: latency.sampleSize,
      dbLatencyMs: database.latencyMs,
      latencyTargets: evaluateLatencyTargets({
        p95LatencyMs: latency.p95LatencyMs ?? database.latencyMs,
        p99LatencyMs: latency.p99LatencyMs,
        latencySampleSize: latency.sampleSize,
      }, env),
    },
  };
}
