import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runBackupRestoreEvidenceChecks } from "../../scripts/verify-backup-restore-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-backup-restore-evidence-"));
}

function filledBackupRestoreTemplate() {
  return readFileSync(resolve("docs/backup-restore-rehearsal-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "secret-manager-reference");
}

describe("backup restore evidence release gate", () => {
  it("allows the tracked backup restore evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runBackupRestoreEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when backup restore evidence placeholders remain", () => {
    const result = runBackupRestoreEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending|<secret-manager-reference>/);
  });

  it("passes strict mode when all backup restore evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "backup-restore.md"), filledBackupRestoreTemplate());

      const result = runBackupRestoreEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/backup-restore.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
