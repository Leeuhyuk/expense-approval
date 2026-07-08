import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runFinalAcceptanceEvidenceChecks } from "../../scripts/verify-final-acceptance-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-final-acceptance-evidence-"));
}

function filledFinalAcceptanceTemplate() {
  return readFileSync(resolve("docs/final-acceptance-evidence-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "evidence");
}

describe("final acceptance evidence release gate", () => {
  it("allows the tracked final acceptance evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runFinalAcceptanceEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when final acceptance evidence placeholders remain", () => {
    const result = runFinalAcceptanceEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending/);
  });

  it("passes strict mode when all final acceptance evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "final-acceptance.md"), filledFinalAcceptanceTemplate());

      const result = runFinalAcceptanceEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/final-acceptance.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
