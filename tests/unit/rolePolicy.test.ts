import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultRolePolicies, privilegedMutationPermissions, rolePolicyByCode } from "../../src/domain/rolePolicy";
import { permissionMatrix } from "../../src/domain/workflowRules";
import type { AuthRoleCode } from "../../src/types";

const requiredRoleCodes: AuthRoleCode[] = ["ADMIN", "APPROVER", "AUDITOR", "FINANCE", "REQUESTER"];

function role(code: AuthRoleCode) {
  const policy = rolePolicyByCode(code);
  assert.ok(policy, `${code} policy must exist`);
  return policy;
}

describe("production role least privilege policy", () => {
  it("defines every required production operating role exactly once", () => {
    assert.deepEqual(
      defaultRolePolicies.map((policy) => policy.code).sort(),
      requiredRoleCodes,
    );
  });

  it("keeps default role policies aligned with the workflow permission matrix", () => {
    assert.deepEqual(permissionMatrix.requester, role("REQUESTER").permissions);
    assert.deepEqual(permissionMatrix.approver, role("APPROVER").permissions);
    assert.deepEqual(permissionMatrix.finance, role("FINANCE").permissions);
    assert.deepEqual(permissionMatrix.admin, role("ADMIN").permissions);
    assert.deepEqual(permissionMatrix.auditor, role("AUDITOR").permissions);
  });

  it("keeps wildcard and system management restricted to administrators", () => {
    for (const policy of defaultRolePolicies) {
      if (policy.code === "ADMIN") {
        assert.deepEqual(policy.permissions, ["*"]);
        continue;
      }

      assert.equal(policy.permissions.includes("*"), false, `${policy.code} must not have wildcard permissions`);
      assert.equal(policy.permissions.includes("system:manage"), false, `${policy.code} must not manage system settings`);
    }
  });

  it("keeps auditor read-only and outside privileged business mutations", () => {
    const auditor = role("AUDITOR");

    for (const permission of privilegedMutationPermissions) {
      assert.equal(auditor.permissions.includes(permission), false, `AUDITOR must not have ${permission}`);
    }

    assert.equal(auditor.permissions.includes("report:read"), true);
    assert.equal(auditor.permissions.includes("audit:read"), true);
  });

  it("keeps approval and disbursement execution scoped to their operating teams", () => {
    assert.equal(role("APPROVER").permissions.includes("approval:act"), true);
    assert.equal(role("FINANCE").permissions.includes("approval:act"), false);
    assert.equal(role("REQUESTER").permissions.includes("approval:act"), false);
    assert.equal(role("AUDITOR").permissions.includes("approval:act"), false);

    assert.equal(role("FINANCE").permissions.includes("disbursement:execute"), true);
    assert.equal(role("APPROVER").permissions.includes("disbursement:execute"), false);
    assert.equal(role("REQUESTER").permissions.includes("disbursement:execute"), false);
    assert.equal(role("AUDITOR").permissions.includes("disbursement:execute"), false);
  });

  it("seeds every default role from the same policy source", () => {
    const seedSource = readFileSync(resolve("prisma/seed.ts"), "utf8");

    assert.match(seedSource, /defaultRolePolicies/);
    for (const roleIdName of ["roleRequester", "roleApprover", "roleFinance", "roleAdmin", "roleAuditor"]) {
      assert.match(seedSource, new RegExp(`${roleIdName}:`));
    }
  });
});
