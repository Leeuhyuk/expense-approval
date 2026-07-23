import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runRoleUatEvidenceChecks } from "../../scripts/verify-role-uat-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-role-uat-evidence-"));
}

function filledRoleUatTemplate() {
  return readFileSync(resolve("docs/role-uat-evidence-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "evidence");
}

describe("role UAT evidence release gate", () => {
  it("allows the tracked role UAT evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runRoleUatEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when role UAT evidence placeholders remain", () => {
    const result = runRoleUatEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending/);
  });

  it("passes strict mode when all role UAT evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "role-uat.md"), filledRoleUatTemplate());

      const result = runRoleUatEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/role-uat.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
