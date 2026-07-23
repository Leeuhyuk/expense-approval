import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessPage, canUseAction, getDefaultPage, hasPermission } from "../../src/domain/accessControl";
import type { AuthUser } from "../../src/types";

const requester: AuthUser = {
  id: "user-requester",
  name: "요청자",
  email: "requester@example.local",
  departmentId: "dept-1",
  departmentName: "마케팅팀",
  roles: ["REQUESTER"],
  permissions: ["dashboard:read", "payment_request:read_own", "payment_request:create", "payment_request:submit"],
};

const admin: AuthUser = {
  id: "user-admin",
  name: "관리자",
  email: "admin@example.local",
  departmentId: "dept-2",
  departmentName: "재무팀",
  roles: ["ADMIN"],
  permissions: ["*"],
};

describe("access control", () => {
  it("treats wildcard permission as full access", () => {
    assert.equal(hasPermission(admin, "system:manage"), true);
    assert.equal(canAccessPage(admin, "settings"), true);
    assert.equal(canUseAction(admin, "disbursement:execute"), true);
  });

  it("limits requester menu access to allowed pages", () => {
    assert.equal(canAccessPage(requester, "dashboard"), true);
    assert.equal(canAccessPage(requester, "payment-request"), true);
    assert.equal(canAccessPage(requester, "approval"), false);
    assert.equal(canAccessPage(requester, "settings"), false);
  });

  it("chooses the first accessible page as default", () => {
    assert.equal(getDefaultPage(requester), "dashboard");
  });
});
