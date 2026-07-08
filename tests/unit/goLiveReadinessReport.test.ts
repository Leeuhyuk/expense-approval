import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGoLiveReadinessReport,
  renderGoLiveReadinessMarkdown,
  writeGoLiveReadinessReport,
} from "../../scripts/generate-go-live-readiness-report.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-go-live-readiness-report-"));
}

function syntheticChecklist(openCount = 30) {
  const blockers = Array.from({ length: openCount }, (_, index) => `- [ ] P0: staging blocker ${index + 1}`);
  return [
    "## 23. 데이터 연동",
    "",
    "- [x] P0: 완료된 DB 항목",
    "- [ ] P0: remote DB E2E 증적 필요",
    "",
    "## 24. 운영 준비",
    "",
    "### 24.1 운영 환경",
    "",
    ...blockers,
    "",
    "## 25. 실사용 전환",
    "",
    "### 25.8 Go-Live 이후 안정화",
    "",
    "- [ ] P0: backup과 PITR 리허설 필요",
  ].join("\n");
}

describe("go-live readiness report", () => {
  it("renders every open P0 blocker without the CLI preview truncation", () => {
    const report = buildGoLiveReadinessReport({
      source: syntheticChecklist(30),
      target: "audit",
      generatedAt: "2026-07-06T00:00:00.000Z",
    });
    const markdown = renderGoLiveReadinessMarkdown(report);

    assert.equal(report.allOpenP0Count, 32);
    assert.match(report.checklistSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.targetOpenP0Count, 32);
    assert.match(markdown, /staging blocker 30/);
    assert.match(markdown, /remote DB E2E 증적 필요/);
    assert.match(markdown, /backup과 PITR 리허설 필요/);
    assert.doesNotMatch(markdown, /\.\.\. \d+ more open P0/);
  });

  it("classifies blockers and reports strict target outcomes", () => {
    const report = buildGoLiveReadinessReport({
      source: syntheticChecklist(1),
      target: "production-candidate",
    });

    assert.equal(report.ok, false);
    assert.equal(report.targetOpenP0Count, 1);
    assert.equal(report.allOpenP0Count, 3);
    assert.ok(report.targetResults.some((result) => result.target === "stable-operation" && result.openP0Count === 3));
    assert.ok(report.allOpenBlockers.some((blocker) => blocker.categories.includes("recovery rehearsal evidence")));
    assert.ok(report.allOpenBlockers.some((blocker) => blocker.categories.includes("DB/E2E persistence evidence")));
  });

  it("writes JSON and Markdown artifacts for release evidence", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "release"), { recursive: true });
      const report = buildGoLiveReadinessReport({
        source: syntheticChecklist(2),
        target: "audit",
        generatedAt: "2026-07-06T00:00:00.000Z",
      });

      const previousCwd = process.cwd();
      process.chdir(root);
      try {
        writeGoLiveReadinessReport({ report });
      } finally {
        process.chdir(previousCwd);
      }

      const json = JSON.parse(readFileSync(join(root, "release", "go-live-readiness-report.json"), "utf8"));
      const markdown = readFileSync(join(root, "release", "go-live-readiness-report.md"), "utf8");
      assert.equal(json.allOpenP0Count, 4);
      assert.match(json.checklistSha256, /^[a-f0-9]{64}$/);
      assert.match(markdown, /Go-Live Readiness Report/);
      assert.match(markdown, /Checklist SHA-256/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
