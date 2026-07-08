import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminRecoveryPolicy, dataIntegrityPolicy, unsavedChangePolicy, validatePasswordPolicy } from "../../src/domain/securityRules";

describe("security and exception rules", () => {
  it("validates the password policy", () => {
    assert.deepEqual(validatePasswordPolicy("short"), [
      "최소 12자 이상이어야 합니다.",
      "영문 대문자를 포함해야 합니다.",
      "숫자를 포함해야 합니다.",
      "특수문자를 포함해야 합니다.",
    ]);
    assert.deepEqual(validatePasswordPolicy("StrongPass#2026"), []);
  });

  it("defines unsaved-change, recovery, and integrity policies", () => {
    assert.equal(unsavedChangePolicy.blockNavigationWhileSaving, true);
    assert.equal(unsavedChangePolicy.confirmWhenDirty, true);
    assert.equal(adminRecoveryPolicy.requireReason, true);
    assert.equal(adminRecoveryPolicy.requireAuditLog, true);
    assert.equal(dataIntegrityPolicy.requireRowVersion, true);
    assert.equal(dataIntegrityPolicy.requireIdempotencyKeyForActions, true);
  });
});
