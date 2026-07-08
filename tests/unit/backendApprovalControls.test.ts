import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApprovalStatus } from "../../backend/generated/prisma";
import { validateApprovalActor } from "../../backend/src/routes/approvals";

function paymentRequest(requesterId = "70000000-0000-4000-8000-000000000101") {
  return {
    requesterId,
  } as never;
}

describe("backend approval controls", () => {
  it("blocks requester self approval", () => {
    assert.match(validateApprovalActor(paymentRequest(), "70000000-0000-4000-8000-000000000101", ApprovalStatus.APPROVED), /요청자/);
    assert.equal(validateApprovalActor(paymentRequest(), "70000000-0000-4000-8000-000000000102", ApprovalStatus.APPROVED), "");
    assert.equal(validateApprovalActor(paymentRequest(), "70000000-0000-4000-8000-000000000101", ApprovalStatus.REJECTED), "");
  });
});
