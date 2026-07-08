import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runStagingSmokeEvidenceChecks } from "../../scripts/verify-staging-smoke-evidence.mjs";

const validReleaseHash = "a".repeat(64);
const validMigrationHash = "b".repeat(64);

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-staging-smoke-evidence-"));
}

function filledStagingSmokeTemplate() {
  return readFileSync(resolve("docs/staging-smoke-evidence-template.md"), "utf8")
    .replace("| Release branch or tag | TBD |", "| Release branch or tag | v2026.07.06 |")
    .replace("| Release manifest hash | TBD |", `| Release manifest hash | ${validReleaseHash} |`)
    .replace("| `EXPECTED_RELEASE_MANIFEST_SHA256` promotion hash | TBD |", `| \`EXPECTED_RELEASE_MANIFEST_SHA256\` promotion hash | ${validReleaseHash} |`)
    .replace("| Migration review hash | TBD |", `| Migration review hash | ${validMigrationHash} |`)
    .replace("| Production promotion decision | pending |", "| Production promotion decision | approved |")
    .replace("| Open blocker count | TBD |", "| Open blocker count | 0 |")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "evidence");
}

describe("staging smoke evidence release gate", () => {
  it("allows the tracked staging smoke evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runStagingSmokeEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when staging smoke evidence placeholders remain", () => {
    const result = runStagingSmokeEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending/);
  });

  it("passes strict mode when all staging smoke evidence fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "staging-smoke.md"), filledStagingSmokeTemplate());

      const result = runStagingSmokeEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/staging-smoke.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails strict mode when promotion hashes or blocker count do not prove safe promotion", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(
        join(root, "evidence", "staging-smoke.md"),
        filledStagingSmokeTemplate()
          .replace(`| \`EXPECTED_RELEASE_MANIFEST_SHA256\` promotion hash | ${validReleaseHash} |`, `| \`EXPECTED_RELEASE_MANIFEST_SHA256\` promotion hash | ${"c".repeat(64)} |`)
          .replace("| Open blocker count | 0 |", "| Open blocker count | 2 |"),
      );

      const result = runStagingSmokeEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/staging-smoke.md",
        strict: true,
      });

      assert.equal(result.ok, false);
      assert.match(result.failures.map((failure) => failure.label).join("\n"), /promotion hash matches release manifest hash/);
      assert.match(result.failures.map((failure) => failure.label).join("\n"), /zero open blockers/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
