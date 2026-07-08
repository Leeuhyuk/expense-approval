import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalStepCountFromPolicy } from "../../backend/src/routes/paymentRequests";

describe("backend payment policy controls", () => {
  it("uses saved approval limit policy when deciding approval step count", () => {
    const policy = {
      approvalLimits: [
        { min: 0, max: 1_000_000, requiredApprovers: 1, status: "활성" },
        { min: 1_000_001, max: 5_000_000, requiredApprovers: 2, status: "활성" },
        { min: 5_000_001, max: null, requiredApprovers: 4, status: "활성" },
      ],
    };

    assert.equal(approvalStepCountFromPolicy(900_000, policy), 1);
    assert.equal(approvalStepCountFromPolicy(3_000_000, policy), 2);
    assert.equal(approvalStepCountFromPolicy(12_000_000, policy), 4);
  });

  it("falls back to default policy when saved policy is missing or inactive", () => {
    assert.equal(approvalStepCountFromPolicy(900_000, null), 2);
    assert.equal(approvalStepCountFromPolicy(12_000_000, null), 3);
    assert.equal(
      approvalStepCountFromPolicy(900_000, {
        approvalLimits: [{ min: 0, max: 1_000_000, requiredApprovers: 1, status: "비활성" }],
      }),
      2,
    );
  });
});
