import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runDataMigrationEvidenceChecks } from "../../scripts/verify-data-migration-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-data-migration-evidence-"));
}

function filledDataMigrationTemplate() {
  return readFileSync(resolve("docs/data-migration-evidence-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "secret-manager-reference");
}

describe("data migration evidence release gate", () => {
  it("allows the tracked data migration evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runDataMigrationEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when data migration evidence placeholders remain", () => {
    const result = runDataMigrationEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending|<secret-manager-reference>/);
  });

  it("passes strict mode when all data migration evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "data-migration.md"), filledDataMigrationTemplate());

      const result = runDataMigrationEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/data-migration.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
