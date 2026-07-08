import type { FastifyReply, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { fail } from "../utils/response.js";
import { requestId } from "../routes/rowUtils.js";

export type SecurityEventSeverity = "low" | "medium" | "high" | "critical";

export type SecurityEventRecordInput = {
  eventType: string;
  errorCode: string;
  message: string;
  statusCode: number;
  requestId: string;
  severity?: SecurityEventSeverity;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  method?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown>;
};

export type SecurityEventRequestInput = Omit<
  SecurityEventRecordInput,
  "requestId" | "ipAddress" | "userAgent" | "method" | "path"
> & {
  request: FastifyRequest;
};

export type FailureSecurityEventInput = {
  request: FastifyRequest;
  errorCode: string;
  message: string;
  statusCode: number;
  eventType?: string;
  severity?: SecurityEventSeverity;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

const sensitiveMetadataKeyPattern = /(authorization|cookie|password|secret|signature|token|checksum|credential)/i;
const eventRecordedRequests = new WeakSet<FastifyRequest>();
const actorByRequest = new WeakMap<FastifyRequest, string>();

function truncate(value: string, maxLength = 500) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function headerText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return truncate(value.join(" "));
  return typeof value === "string" ? truncate(value) : null;
}

function pathWithoutQuery(url: string | undefined) {
  if (!url) return null;
  return truncate(url.split("?")[0] || url);
}

function severityFromStatus(statusCode: number): SecurityEventSeverity {
  if (statusCode >= 500) return "high";
  if (statusCode === 401 || statusCode === 403) return "medium";
  return "low";
}

export function securityEventTypeForFailure(errorCode: string, statusCode: number) {
  if (errorCode === "CSRF_TOKEN_INVALID") return "csrf_rejected";
  if (errorCode === "RATE_LIMITED") return "rate_limited";
  if (errorCode === "UNAUTHORIZED") return "auth_required";
  if (errorCode === "FORBIDDEN") return "access_denied";
  if (errorCode === "VALIDATION_ERROR") return "validation_rejected";
  if (errorCode === "PARTIAL_FAILURE") return "partial_failure";
  if (errorCode === "OPERATION_MODE_RESTRICTED") return "workflow_blocked";
  if (errorCode === "IDEMPOTENCY_CONFLICT" || errorCode === "IDEMPOTENCY_REPLAY") return "duplicate_request_blocked";
  if (errorCode === "CONFLICT" || errorCode === "WORKFLOW_LOCKED" || errorCode.endsWith("_CONTROL_FAILED")) return "workflow_blocked";
  if (statusCode >= 500) return "server_failure";
  return "api_failure";
}

export function markSecurityEventRecorded(request: FastifyRequest) {
  eventRecordedRequests.add(request);
}

export function hasSecurityEventRecorded(request: FastifyRequest) {
  return eventRecordedRequests.has(request);
}

export function setSecurityEventActor(request: FastifyRequest, actorId: string) {
  actorByRequest.set(request, actorId);
}

function securityEventActorId(request: FastifyRequest) {
  return actorByRequest.get(request) ?? null;
}

function sanitizeJsonValue(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeJsonValue(item, depth + 1));
  if (typeof value !== "object") return String(value);
  if (depth >= 4) return "[truncated]";

  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    result[key] = sensitiveMetadataKeyPattern.test(key) ? "[redacted]" : sanitizeJsonValue(item, depth + 1);
  }
  return result;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined;
  const sanitized = sanitizeJsonValue(metadata);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return undefined;
  return Object.keys(sanitized).length ? (sanitized as Prisma.InputJsonObject) : undefined;
}

function shouldSkipSecurityEventWrite() {
  return !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
}

export function buildSecurityEventRecord(input: SecurityEventRecordInput): Prisma.SecurityEventUncheckedCreateInput {
  return {
    eventType: input.eventType,
    severity: input.severity ?? severityFromStatus(input.statusCode),
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ? truncate(input.targetId, 120) : null,
    requestId: truncate(input.requestId, 120),
    ipAddress: input.ipAddress ? truncate(input.ipAddress, 120) : null,
    userAgent: input.userAgent ? truncate(input.userAgent, 500) : null,
    method: input.method ? truncate(input.method, 20) : null,
    path: input.path ? truncate(input.path, 500) : null,
    statusCode: input.statusCode,
    errorCode: input.errorCode,
    message: truncate(input.message),
    metadata: sanitizeMetadata(input.metadata),
  };
}

export function buildSecurityEventFromRequest(input: SecurityEventRequestInput): Prisma.SecurityEventUncheckedCreateInput {
  return buildSecurityEventRecord({
    ...input,
    requestId: requestId(input.request),
    ipAddress: input.request.ip,
    userAgent: headerText(input.request.headers["user-agent"]),
    method: input.request.method,
    path: pathWithoutQuery(input.request.url),
  });
}

function parseErrorPayload(payload: unknown) {
  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : typeof payload === "string" ? payload : "";
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { status?: unknown; error?: { code?: unknown; message?: unknown } };
    if (parsed.status !== "error" || !parsed.error) return null;
    if (typeof parsed.error.code !== "string" || typeof parsed.error.message !== "string") return null;
    return {
      errorCode: parsed.error.code,
      message: parsed.error.message,
    };
  } catch {
    return null;
  }
}

export function failureSecurityEventFromResponsePayload(
  request: FastifyRequest,
  statusCode: number,
  payload: unknown,
): FailureSecurityEventInput | null {
  const error = parseErrorPayload(payload);
  if (!error || statusCode < 400) return null;
  return {
    request,
    actorId: securityEventActorId(request),
    eventType: securityEventTypeForFailure(error.errorCode, statusCode),
    errorCode: error.errorCode,
    message: error.message,
    statusCode,
    metadata: { source: "standard_error_response" },
  };
}

export async function recordSecurityEvent(
  input: SecurityEventRequestInput,
  db: Pick<PrismaClient, "securityEvent"> = prisma,
) {
  const data = buildSecurityEventFromRequest(input);
  markSecurityEventRecorded(input.request);
  if (shouldSkipSecurityEventWrite()) return;
  try {
    await db.securityEvent.create({ data });
  } catch (error) {
    input.request.log?.warn?.({ err: error, eventType: data.eventType, requestId: data.requestId }, "security event write failed");
  }
}

export function failureSecurityEventInput(input: FailureSecurityEventInput): SecurityEventRequestInput {
  return {
    request: input.request,
    eventType: input.eventType ?? securityEventTypeForFailure(input.errorCode, input.statusCode),
    severity: input.severity,
    actorId: input.actorId,
    targetType: input.targetType,
    targetId: input.targetId,
    errorCode: input.errorCode,
    message: input.message,
    statusCode: input.statusCode,
    metadata: input.metadata,
  };
}

export function recordFailureSecurityEvent(input: FailureSecurityEventInput) {
  return recordSecurityEvent(failureSecurityEventInput(input));
}

export async function failWithFailureSecurityEvent(reply: FastifyReply, input: FailureSecurityEventInput) {
  await recordFailureSecurityEvent(input);
  return fail(reply, input.errorCode, input.message, input.statusCode);
}

export async function failWithSecurityEvent(reply: FastifyReply, input: SecurityEventRequestInput) {
  await recordSecurityEvent(input);
  return fail(reply, input.errorCode, input.message, input.statusCode);
}

export function createSecurityEventFailureHook() {
  return (request: FastifyRequest, reply: FastifyReply, payload: unknown, done: (error: Error | null, payload?: unknown) => void) => {
    if (hasSecurityEventRecorded(request)) {
      done(null, payload);
      return;
    }

    const input = failureSecurityEventFromResponsePayload(request, reply.statusCode, payload);
    if (input) void recordFailureSecurityEvent(input);
    done(null, payload);
  };
}
