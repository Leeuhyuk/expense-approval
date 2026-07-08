import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { ApiRequestError, errorFromApiResponse } from "../../src/api/errors";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("remote failure recovery controls", () => {
  it("standardizes network errors, timeouts, and non-JSON server failures", () => {
    const service = source("src/api/service.ts");

    assert.match(service, /const remoteRequestTimeoutMs = 15_000/, "remote requests must have a bounded timeout");
    assert.match(service, /const controller = new AbortController\(\)/, "remote requests must use AbortController for timeout cancellation");
    assert.match(service, /timeoutHit \? "NETWORK_TIMEOUT" : "REQUEST_ABORTED"/, "timeouts must surface as NETWORK_TIMEOUT");
    assert.match(service, /new ApiRequestError\("NETWORK_ERROR"/, "fetch failures must become ApiRequestError NETWORK_ERROR");
    assert.match(service, /catch \{[\s\S]*new ApiRequestError\(apiErrorCodeForStatus\(response\.status\), apiErrorMessageForStatus\(response\.status\)\)/, "HTML or malformed 500 responses must still produce standard API errors");
    assert.match(service, /if \(status >= 500\) return "서버 오류가 발생했습니다\. 잠시 후 다시 시도하세요\."/,
      "server 500 responses must use the standard server error message");
  });

  it("retries only safe remote reads for transient failures", () => {
    const service = source("src/api/service.ts");

    assert.match(service, /const retryableRemoteStatuses = new Set\(\[408, 429, 502, 503, 504\]\)/,
      "only transient HTTP statuses should be retryable");
    assert.match(service, /return \["GET", "HEAD", "OPTIONS"\]\.includes\(remoteRequestMethod\(init\)\)/,
      "automatic retry must be limited to safe methods");
    assert.match(service, /const maxAttempts = canRetryRemoteRequest\(init\) \? 2 : 1/,
      "unsafe mutations must not be retried automatically");
    assert.match(service, /retryableError = error instanceof ApiRequestError && \["NETWORK_ERROR", "NETWORK_TIMEOUT"\]\.includes\(error\.code\)/,
      "network errors and timeouts must be retryable only within the safe-method retry envelope");
  });

  it("preserves validation failures and duplicate-click protection through UI and backend paths", () => {
    const main = source("src/main.tsx");
    const paymentRoute = source("backend/src/routes/paymentRequests.ts");
    const pageRoute = source("backend/src/routes/pageResources.ts");

    const validationError = errorFromApiResponse({
      status: "error",
      error: { code: "VALIDATION_ERROR", message: "거래처명과 사업자번호가 필요합니다." },
      meta: { requestId: "req-validation-1" },
    });
    assert.ok(validationError instanceof ApiRequestError);
    assert.equal(validationError.code, "VALIDATION_ERROR");
    assert.equal(validationError.message, "VALIDATION_ERROR: 거래처명과 사업자번호가 필요합니다. (requestId: req-validation-1)");

    assert.match(paymentRoute, /return fail\(reply, "VALIDATION_ERROR", validationMessage\(code\), 400\)/,
      "payment request validation failures must use the standard backend error envelope");
    assert.match(pageRoute, /return fail\(reply, "VALIDATION_ERROR", "거래처명과 사업자번호가 필요합니다\.", 400\)/,
      "vendor validation failures must use the standard backend error envelope");
    assert.match(main, /const updateSelectedRows = async[\s\S]*if \(isMutating\) return;[\s\S]*setIsMutating\(true\)/,
      "bulk mutation buttons must ignore duplicate clicks while a request is active");
    assert.match(main, /disabled=\{table\.isMutating \|\| !canEditRequest\}/,
      "payment save controls must disable while mutation is active");
    assert.match(main, /const idempotencyKey = paymentRequestMutationKey\("submit"/,
      "payment submit must send an idempotency key for duplicate request protection");
  });
});
