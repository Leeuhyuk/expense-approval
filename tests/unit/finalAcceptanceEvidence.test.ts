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
    .replace("| Release manifest hash | TBD |", "| Release manifest hash | " + "a".repeat(64) + " |")
    .replace(/^\| Production go-live evidence .*$/m, "| Production go-live evidence | artifact:production-go-live-approved |")
    .replace(/^\| Post go-live stabilization evidence .*$/m, "| Post go-live stabilization evidence | artifact:stabilization-approved |")
    .replace("| Final decision date/time | TBD |", "| Final decision date/time | 2026-07-06T10:00:00Z |")
    .replace(/^\| .*READINESS_TARGET=stable-operation.*$/m, "| READINESS_TARGET=stable-operation npm run release:go-live-readiness | passed, open P0 0 |")
    .replace("| KPI measurement window | TBD |", "| KPI measurement window | 2026-07-06 ~ 2026-07-20 |")
    .replace("| go-live 승인 기준 | TBD |", "| go-live 승인 기준 | approved |")
    .replace("| Actual processing KPI | TBD |", "| Actual processing KPI | passed |")
    .replace("| Actual error rate | TBD |", "| Actual error rate | 0.1% |")
    .replace("| API 5xx rate | TBD |", "| API 5xx rate | 0.1% |")
    .replace("| Approval failure rate | TBD |", "| Approval failure rate | 0.1% |")
    .replace("| Disbursement failure rate | TBD |", "| Disbursement failure rate | 0.1% |")
    .replace("| File upload failure rate | TBD |", "| File upload failure rate | 0.1% |")
    .replace("| Report failure rate | TBD |", "| Report failure rate | 0.1% |")
    .replace("| Next review date | TBD |", "| Next review date | 2026-07-21 |")
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
