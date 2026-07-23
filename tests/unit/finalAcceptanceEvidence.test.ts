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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setRow(source: string, key: string, value: string) {
  const pattern = new RegExp(`^\\|\\s*${escapeRegExp(key)}\\s*\\|.*\\|$`, "m");
  assert.match(source, pattern, `row must exist: ${key}`);
  return source.replace(pattern, `| ${key} | ${value} |`);
}

function validFinalAcceptanceTemplate() {
  let source = filledFinalAcceptanceTemplate();

  source = setRow(source, "Release manifest hash", "a".repeat(64));
  source = setRow(source, "Production go-live evidence", "pass `PRODUCTION_GO_LIVE_EVIDENCE_PATH` target release/production-go-live-evidence.md");
  source = setRow(source, "Post go-live stabilization evidence", "pass `POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH` target release/post-go-live-stabilization-evidence.md");
  source = setRow(source, "Final acceptance owner", "김운영");
  source = setRow(source, "Final decision date/time", "2026-07-06 18:00");
  source = setRow(source, "`READINESS_TARGET=stable-operation npm run release:go-live-readiness`", "pass open P0 0");
  source = setRow(source, "go-live 승인 기준", "pass 승인 기준 충족 evidence=docs/go-live-criteria.md");
  source = setRow(source, "Actual processing KPI", "pass 평균 승인 처리 1.8일 evidence=EVIDENCE-2026-07-06");
  source = setRow(source, "Actual error rate", "0.4%");
  source = setRow(source, "API 5xx rate", "0.1%");
  source = setRow(source, "Approval failure rate", "0.3%");
  source = setRow(source, "Disbursement failure rate", "0.2%");
  source = setRow(source, "File upload failure rate", "0.5%");
  source = setRow(source, "Report failure rate", "0.2%");

  return source;
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
      writeFileSync(join(root, "evidence", "final-acceptance.md"), validFinalAcceptanceTemplate());

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
