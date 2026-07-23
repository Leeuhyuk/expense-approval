import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorFromApiResponse } from "../../src/api/errors";
import { failureSecurityEventFromResponsePayload, buildSecurityEventFromRequest, securityEventTypeForFailure } from "../../backend/src/security/securityEvents";

function request(id: string, url: string) {
  return {
    id,
    ip: "203.0.113.60",
    headers: { "user-agent": "erp-failure-correlation-test" },
    method: "POST",
    url,
  };
}

describe("failure correlation between UI messages and backend events", () => {
  it("keeps standard failure codes visible in the UI and classifiable in security_events", () => {
    const cases = [
      {
        code: "FORBIDDEN",
        message: "권한이 없습니다.",
        requestId: "req-forbidden-1",
        statusCode: 403,
        path: "/api/settings",
        eventType: "access_denied",
      },
      {
        code: "IDEMPOTENCY_CONFLICT",
        message: "이미 다른 처리에 사용된 idempotencyKey입니다.",
        requestId: "req-duplicate-1",
        statusCode: 409,
        path: "/api/payment-requests",
        eventType: "duplicate_request_blocked",
      },
      {
        code: "PARTIAL_FAILURE",
        message: "일괄 처리 중 일부 항목이 실패했습니다.",
        requestId: "req-partial-1",
        statusCode: 409,
        path: "/api/approvals/bulk",
        eventType: "partial_failure",
      },
      {
        code: "SERVER_ERROR",
        message: "서버 오류가 발생했습니다. requestId를 운영자에게 전달해주세요.",
        requestId: "req-server-1",
        statusCode: 500,
        path: "/api/reports/monthly/download",
        eventType: "server_failure",
      },
    ] as const;

    for (const item of cases) {
      const payload = {
        status: "error" as const,
        error: {
          code: item.code,
          message: item.message,
        },
        meta: {
          requestId: item.requestId,
        },
      };
      const uiError = errorFromApiResponse(payload);
      assert.ok(uiError, `${item.code} must produce a UI error`);
      assert.equal(uiError.code, item.code);
      assert.equal(uiError.requestId, item.requestId);
      assert.match(uiError.message, new RegExp(`${item.code}:`));
      assert.match(uiError.message, new RegExp(`requestId: ${item.requestId}`));

      assert.equal(securityEventTypeForFailure(item.code, item.statusCode), item.eventType);
      const eventInput = failureSecurityEventFromResponsePayload(request(item.requestId, `${item.path}?idempotencyKey=secret`) as never, item.statusCode, JSON.stringify(payload));
      assert.ok(eventInput, `${item.code} must become a backend failure event`);
      const event = buildSecurityEventFromRequest(eventInput);
      assert.equal(event.requestId, item.requestId);
      assert.equal(event.errorCode, item.code);
      assert.equal(event.eventType, item.eventType);
      assert.equal(event.path, item.path);
    }
  });
});
