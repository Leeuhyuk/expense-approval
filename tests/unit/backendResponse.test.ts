import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fail, success } from "../../backend/src/utils/response";

function createReplyRecorder(requestId = "req-test-1") {
  return {
    request: { id: requestId },
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe("backend API response envelope", () => {
  it("includes requestId metadata on success and failure responses", () => {
    const request = { id: "req-success-1" };
    assert.deepEqual(success(request as never, { ok: true }), {
      status: "success",
      data: { ok: true },
      meta: { requestId: "req-success-1" },
    });

    const reply = createReplyRecorder("req-fail-1");
    fail(reply as never, "VALIDATION_ERROR", "입력값을 확인해주세요.", 400);

    assert.equal(reply.statusCode, 400);
    assert.deepEqual(reply.payload, {
      status: "error",
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인해주세요.",
      },
      meta: {
        requestId: "req-fail-1",
      },
    });
  });
});
