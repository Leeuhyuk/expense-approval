import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("maintenance release and backlog policy", () => {
  it("defines recurring maintenance, a release calendar, hotfix controls, and backlog workflow", () => {
    const policy = read("docs/maintenance-release-backlog-policy.md");

    assert.match(policy, /Daily[\s\S]*Weekly[\s\S]*Monthly[\s\S]*Quarterly[\s\S]*Annually/);
    assert.match(policy, /정기 릴리즈[\s\S]*scope freeze[\s\S]*release candidate[\s\S]*production change freeze/);
    assert.match(policy, /Emergency Hotfix[\s\S]*rollback[\s\S]*다른 승인자[\s\S]*집중 관찰/);
    assert.match(policy, /Backlog Workflow[\s\S]*Intake[\s\S]*Triaged[\s\S]*Ready[\s\S]*Released[\s\S]*Verified/);
    assert.match(policy, /target release가 없는 상태로 30일을 넘기지 않는다/);
  });

  it("ships a structured GitHub operations improvement intake form", () => {
    const issueTemplate = read(".github/ISSUE_TEMPLATE/operations-improvement.yml");

    for (const field of ["request_type", "environment", "severity", "current_behavior", "expected_behavior", "evidence", "risk", "target_release", "owner"]) {
      assert.match(issueTemplate, new RegExp(`id: ${field}`));
    }
    assert.match(issueTemplate, /raw account numbers[\s\S]*cookies[\s\S]*signed URL tokens/);
  });

  it("keeps all three related P2 checklist outcomes and release evidence connected", () => {
    const checklist = read("erp-system-checklist.md");
    const manifest = read("scripts/generate-release-manifest.mjs");
    const operationalDocs = read("scripts/verify-operational-docs.mjs");

    assert.match(checklist, /\[x\] P2: 정기 점검 일정, 릴리즈 캘린더, 개선 요청 backlog 관리 방식 정의/);
    assert.match(checklist, /\[x\] P2: 정기 릴리즈 주기, 긴급 hotfix 절차, 운영 개선 요청 intake 프로세스 확정/);
    assert.match(checklist, /\[x\] P2: 향후 개선 backlog가 운영 릴리즈 계획에 편입/);
    assert.match(manifest, /docs\/maintenance-release-backlog-policy\.md[\s\S]*operations-improvement\.yml[\s\S]*maintenanceReleasePolicy\.test\.ts/);
    assert.match(operationalDocs, /docs\/maintenance-release-backlog-policy\.md/);
  });
});
