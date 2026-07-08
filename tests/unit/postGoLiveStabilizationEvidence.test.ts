import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runPostGoLiveStabilizationEvidenceChecks } from "../../scripts/verify-post-go-live-stabilization-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-post-go-live-stabilization-evidence-"));
}

function filledPostGoLiveStabilizationTemplate() {
  return readFileSync(resolve("docs/post-go-live-stabilization-evidence-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "evidence");
}

describe("post go-live stabilization evidence release gate", () => {
  it("allows the tracked post go-live stabilization evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runPostGoLiveStabilizationEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when post go-live stabilization evidence placeholders remain", () => {
    const result = runPostGoLiveStabilizationEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending/);
  });

  it("passes strict mode when all post go-live stabilization evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "post-go-live-stabilization.md"), filledPostGoLiveStabilizationTemplate());

      const result = runPostGoLiveStabilizationEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/post-go-live-stabilization.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
