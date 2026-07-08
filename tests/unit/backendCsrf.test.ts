import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enforceCsrfProtection, issueCsrfCookie } from "../../backend/src/auth/csrf";

function createReplyRecorder() {
  return {
    cookieName: "",
    cookieValue: "",
    statusCode: 200,
    payload: null as unknown,
    setCookie(name: string, value: string) {
      this.cookieName = name;
      this.cookieValue = value;
      return this;
    },
    clearCookie() {
      return this;
    },
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

describe("backend CSRF protection", () => {
  it("accepts signed double-submit tokens on mutating API requests", () => {
    const reply = createReplyRecorder();
    issueCsrfCookie(reply as never);

    let passed = false;
    enforceCsrfProtection(
      {
        method: "POST",
        url: "/api/payment-requests",
        cookies: { erp_csrf: reply.cookieValue },
        headers: { "x-csrf-token": reply.cookieValue },
      } as never,
      createReplyRecorder() as never,
      () => {
        passed = true;
      },
    );

    assert.equal(reply.cookieName, "erp_csrf");
    assert.equal(passed, true);
  });

  it("rejects missing or mismatched CSRF tokens", () => {
    const reply = createReplyRecorder();
    let passed = false;

    enforceCsrfProtection(
      {
        method: "PATCH",
        url: "/api/settings/config/approvalPolicy",
        cookies: { erp_csrf: "cookie-token" },
        headers: { "x-csrf-token": "header-token" },
      } as never,
      reply as never,
      () => {
        passed = true;
      },
    );

    assert.equal(passed, false);
    assert.equal(reply.statusCode, 403);
    assert.match(JSON.stringify(reply.payload), /CSRF_TOKEN_INVALID/);
  });

  it("exempts login and signed file content upload routes", () => {
    for (const [method, url] of [
      ["POST", "/api/auth/login"],
      ["PUT", "/api/files/80000000-0000-4000-8000-000000000001/content"],
    ]) {
      let passed = false;
      enforceCsrfProtection({ method, url, cookies: {}, headers: {} } as never, createReplyRecorder() as never, () => {
        passed = true;
      });
      assert.equal(passed, true);
    }
  });
});
