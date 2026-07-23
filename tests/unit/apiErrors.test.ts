import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError, errorFromApiResponse } from "../../src/api/errors";

describe("frontend API error formatting", () => {
  it("preserves code and requestId in remote API error messages", () => {
    const error = errorFromApiResponse({
      status: "error",
      error: {
        code: "FORBIDDEN",
        message: "권한이 없습니다.",
      },
      meta: {
        requestId: "req-ui-1",
      },
    });

    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.requestId, "req-ui-1");
    assert.equal(error.message, "FORBIDDEN: 권한이 없습니다. (requestId: req-ui-1)");
  });

  it("returns null for successful API responses", () => {
    assert.equal(
      errorFromApiResponse({
        status: "success",
        data: { ok: true },
        meta: { requestId: "req-ok-1" },
      }),
      null,
    );
  });
});
