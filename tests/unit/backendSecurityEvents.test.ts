import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  buildSecurityEventFromRequest,
  buildSecurityEventRecord,
  failureSecurityEventFromResponsePayload,
  failureSecurityEventInput,
  markSecurityEventRecorded,
  hasSecurityEventRecorded,
  securityEventTypeForFailure,
} from "../../backend/src/security/securityEvents";

describe("backend security event records", () => {
  it("redacts sensitive metadata while keeping operational context", () => {
    const record = buildSecurityEventRecord({
      eventType: "file_access_denied",
      errorCode: "FORBIDDEN",
      message: "파일 다운로드 권한이 없습니다.",
      statusCode: 403,
      requestId: "req-1",
      actorId: "10000000-0000-4000-8000-000000000001",
      targetType: "ATTACHMENT",
      targetId: "20000000-0000-4000-8000-000000000001",
      ipAddress: "203.0.113.10",
      userAgent: "ERP smoke test",
      method: "GET",
      path: "/api/files/20000000-0000-4000-8000-000000000001/download",
      metadata: {
        token: "signed-token",
        safeReason: "permission mismatch",
        nested: {
          authorization: "Bearer secret",
          byteSize: 1024n,
        },
      },
    });

    const metadata = record.metadata as Record<string, unknown>;
    const nested = metadata.nested as Record<string, unknown>;
    assert.equal(record.severity, "medium");
    assert.equal(record.actorId, "10000000-0000-4000-8000-000000000001");
    assert.equal(metadata.token, "[redacted]");
    assert.equal(metadata.safeReason, "permission mismatch");
    assert.equal(nested.authorization, "[redacted]");
    assert.equal(nested.byteSize, "1024");
  });

  it("strips signed URL query strings from request paths", () => {
    const request = {
      id: "req-2",
      ip: "203.0.113.20",
      headers: { "user-agent": ["Browser", "Agent"] },
      method: "GET",
      url: "/api/files/20000000-0000-4000-8000-000000000001/content?download=1&token=secret",
    };

    const record = buildSecurityEventFromRequest({
      request: request as never,
      eventType: "file_signed_url_rejected",
      errorCode: "FORBIDDEN",
      message: "다운로드 URL이 만료되었거나 올바르지 않습니다.",
      statusCode: 403,
      targetType: "ATTACHMENT",
      targetId: "20000000-0000-4000-8000-000000000001",
      metadata: { purpose: "download", signature: "secret" },
    });

    const metadata = record.metadata as Record<string, unknown>;
    assert.equal(record.path, "/api/files/20000000-0000-4000-8000-000000000001/content");
    assert.equal(record.userAgent, "Browser Agent");
    assert.equal(metadata.signature, "[redacted]");
  });

  it("maps central API failures to security event categories", () => {
    assert.equal(securityEventTypeForFailure("CSRF_TOKEN_INVALID", 403), "csrf_rejected");
    assert.equal(securityEventTypeForFailure("RATE_LIMITED", 429), "rate_limited");
    assert.equal(securityEventTypeForFailure("UNAUTHORIZED", 401), "auth_required");
    assert.equal(securityEventTypeForFailure("FORBIDDEN", 403), "access_denied");
    assert.equal(securityEventTypeForFailure("VALIDATION_ERROR", 400), "validation_rejected");
    assert.equal(securityEventTypeForFailure("PARTIAL_FAILURE", 409), "partial_failure");
    assert.equal(securityEventTypeForFailure("IDEMPOTENCY_CONFLICT", 409), "duplicate_request_blocked");
    assert.equal(securityEventTypeForFailure("WORKFLOW_LOCKED", 409), "workflow_blocked");
    assert.equal(securityEventTypeForFailure("SERVER_ERROR", 500), "server_failure");
  });

  it("builds failure event input without leaking signed URL query strings", () => {
    const request = {
      id: "req-3",
      ip: "203.0.113.30",
      headers: { "user-agent": "Browser" },
      method: "PATCH",
      url: "/api/settings/config/approvalPolicy?token=secret",
    };

    const input = failureSecurityEventInput({
      request: request as never,
      errorCode: "CSRF_TOKEN_INVALID",
      message: "요청 보안 토큰이 유효하지 않습니다.",
      statusCode: 403,
      metadata: { cookieToken: "secret" },
    });
    const record = buildSecurityEventFromRequest(input);
    const metadata = record.metadata as Record<string, unknown>;

    assert.equal(record.eventType, "csrf_rejected");
    assert.equal(record.path, "/api/settings/config/approvalPolicy");
    assert.equal(metadata.cookieToken, "[redacted]");
  });

  it("builds central security events from standard error responses", () => {
    const request = {
      id: "req-4",
      ip: "203.0.113.40",
      headers: { "user-agent": "Browser" },
      method: "POST",
      url: "/api/disbursements/DISB-001/execution-approval?idempotencyKey=secret",
    };

    const input = failureSecurityEventFromResponsePayload(
      request as never,
      409,
      JSON.stringify({
        status: "error",
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "이미 다른 처리에 사용된 idempotencyKey입니다.",
        },
      }),
    );

    assert.ok(input);
    const record = buildSecurityEventFromRequest(input);
    const metadata = record.metadata as Record<string, unknown>;
    assert.equal(record.eventType, "duplicate_request_blocked");
    assert.equal(record.path, "/api/disbursements/DISB-001/execution-approval");
    assert.equal(metadata.source, "standard_error_response");
  });

  it("tracks request-level security event recording to avoid duplicate central logs", () => {
    const request = {
      id: "req-5",
      ip: "203.0.113.50",
      headers: {},
      method: "GET",
      url: "/api/payment-requests",
    };

    assert.equal(hasSecurityEventRecorded(request as never), false);
    markSecurityEventRecorded(request as never);
    assert.equal(hasSecurityEventRecorded(request as never), true);
  });

  it("keeps file route failures on the security event path", () => {
    const source = readFileSync(resolve("backend/src/routes/files.ts"), "utf8");
    assert.doesNotMatch(source, /return fail\(reply/);
    assert.match(source, /failWithSecurityEvent/);
    assert.ok((source.match(/return failFileSecurity/g) ?? []).length >= 10);
  });

  it("keeps auth, CSRF, and rate-limit failures on the security event path", () => {
    const authSource = readFileSync(resolve("backend/src/routes/auth.ts"), "utf8");
    const sessionSource = readFileSync(resolve("backend/src/auth/session.ts"), "utf8");
    const csrfSource = readFileSync(resolve("backend/src/auth/csrf.ts"), "utf8");
    const rateLimitSource = readFileSync(resolve("backend/src/security/rateLimit.ts"), "utf8");
    const appSource = readFileSync(resolve("backend/src/app.ts"), "utf8");

    assert.doesNotMatch(authSource, /return fail\(reply/);
    assert.match(authSource, /failWithFailureSecurityEvent/);
    assert.match(sessionSource, /failWithFailureSecurityEvent/);
    assert.match(sessionSource, /setSecurityEventActor/);
    assert.match(csrfSource, /recordFailureSecurityEvent/);
    assert.match(rateLimitSource, /recordFailureSecurityEvent/);
    assert.match(appSource, /createSecurityEventFailureHook/);
  });
});
