import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServerErrorHandler } from "../../backend/src/security/serverErrors";

function createReplyRecorder() {
  return {
    sent: false,
    statusCode: 200,
    payload: undefined as unknown,
    request: { id: "req-500-1" },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.sent = true;
      this.payload = payload;
      return this;
    },
  };
}

describe("backend server error handler", () => {
  it("returns a standard SERVER_ERROR envelope without leaking the internal error", async () => {
    const logged: unknown[] = [];
    const request = {
      id: "req-500-1",
      ip: "203.0.113.10",
      headers: { "user-agent": "test" },
      method: "POST",
      url: "/api/payment-requests",
      log: {
        error(entry: unknown) {
          logged.push(entry);
        },
      },
    };
    const reply = createReplyRecorder();

    await createServerErrorHandler()(new Error("database password leaked in stack"), request as never, reply as never);

    assert.equal(reply.statusCode, 500);
    assert.deepEqual(reply.payload, {
      status: "error",
      error: {
        code: "SERVER_ERROR",
        message: "서버 오류가 발생했습니다. requestId를 운영자에게 전달해주세요.",
      },
      meta: {
        requestId: "req-500-1",
      },
    });
    assert.equal(JSON.stringify(reply.payload).includes("database password"), false);
    assert.equal(logged.length, 1);
  });
});
