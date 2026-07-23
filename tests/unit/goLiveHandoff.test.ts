import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runGoLiveHandoffChecks } from "../../scripts/verify-go-live-handoff.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-go-live-handoff-"));
}

function filledHandoffTemplate() {
  return readFileSync(resolve("docs/go-live-handoff-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/KI-TBD/g, "KI-2026")
    .replace(/<[^>\n]+>/g, "evidence");
}

describe("go-live handoff release gate", () => {
  it("allows the tracked handoff template in audit mode while placeholders are still unresolved", () => {
    const result = runGoLiveHandoffChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when production handoff placeholders remain", () => {
    const result = runGoLiveHandoffChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending|KI-TBD/);
  });

  it("passes strict mode when all go-live handoff fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "handoff"), { recursive: true });
      writeFileSync(join(root, "handoff", "go-live.md"), filledHandoffTemplate());

      const result = runGoLiveHandoffChecks({
        projectRoot: root,
        handoffPath: "handoff/go-live.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
