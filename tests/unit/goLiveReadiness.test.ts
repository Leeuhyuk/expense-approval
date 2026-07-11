import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const { evaluateGoLiveReadiness, parseApprovalExceptions, parseGoLiveChecklist } = await import("../../scripts/goLiveReadiness.mjs");

describe("go-live readiness gate", () => {
  it("parses open P0 blockers from the operating checklist", () => {
    const source = readFileSync(resolve("erp-system-checklist.md"), "utf8");
    const items = parseGoLiveChecklist(source);
    const openItems = items.filter((item: { checked: boolean }) => !item.checked);

    assert.ok(items.length > 0, "readiness parser must find P0 items in chapters 23-25");
    assert.ok(
      openItems.some((item: { text: string }) => item.text.includes("배포 대상 플랫폼")),
      "current checklist must keep external production infrastructure blockers visible until evidence is present",
    );
  });

  it("blocks production-candidate and go-live targets while current P0 evidence is missing", () => {
    const source = readFileSync(resolve("erp-system-checklist.md"), "utf8");
    const items = parseGoLiveChecklist(source);

    const audit = evaluateGoLiveReadiness(items, "audit");
    assert.equal(audit.ok, true, "audit mode should report current gaps without failing CI");

    const productionCandidate = evaluateGoLiveReadiness(items, "production-candidate");
    assert.equal(productionCandidate.ok, false);
    assert.ok(
      productionCandidate.blockers.length > 0,
      "production-candidate mode must retain scoped P0 blockers until external release evidence is present",
    );

    const goLive = evaluateGoLiveReadiness(items, "go-live");
    assert.equal(goLive.ok, false);
    assert.ok(
      goLive.blockers.some((item: { chapter: string }) => item.chapter === "24"),
      "go-live mode must fail while chapter 24 operating controls remain open",
    );
  });

  it("uses the right scope for production, go-live, and stable operation targets", () => {
    const synthetic = [
      "## 23. 데이터 연동성 및 실제 업무 검증 리스트",
      "- [x] P0: 데이터 연동 완료",
      "## 24. 운영 준비, 보안, 장애 대응, 재무 통제 검증 리스트",
      "- [ ] P0: 운영 통제 미완료",
      "## 25. 배포 및 실사용 전환 단계 검토 리스트",
      "### 25.1 현재 배포 가능성 판정",
      "- [x] P0: production 후보 판정 완료",
      "### 25.2 Release Candidate 생성",
      "- [x] P0: release candidate 고정 완료",
      "### 25.8 Go-Live 이후 안정화",
      "- [ ] P0: 운영 첫 주 점검 미완료",
    ].join("\n");
    const items = parseGoLiveChecklist(synthetic);

    assert.equal(evaluateGoLiveReadiness(items, "production-candidate").ok, true);
    assert.equal(evaluateGoLiveReadiness(items, "go-live").ok, false);
    assert.equal(evaluateGoLiveReadiness(items, "stable-operation").ok, false);

    const goLiveReadyButNotStable = parseGoLiveChecklist(synthetic.replace("- [ ] P0: 운영 통제 미완료", "- [x] P0: 운영 통제 완료"));
    assert.equal(evaluateGoLiveReadiness(goLiveReadyButNotStable, "go-live").ok, true);
    assert.equal(evaluateGoLiveReadiness(goLiveReadyButNotStable, "stable-operation").ok, false);
  });

  it("conditionally clears scoped P0 blockers when delegated exceptions are complete", () => {
    const synthetic = [
      "## 23. 데이터 연동",
      "- [ ] P0: remote DB E2E 증적 필요",
      "## 24. 운영 준비",
      "- [ ] P0: backup evidence 필요",
      "## 25. 실사용 전환",
      "### 25.1 현재 배포 가능성 판정",
      "- [ ] P0: production platform 확정 필요",
    ].join("\n");
    const approval = parseApprovalExceptions(JSON.stringify({
      approvalId: "APPROVAL-1",
      approver: "Release Owner",
      approvedAt: "2026-07-08T00:00:00+09:00",
      decision: "conditional-go",
      exceptions: [
        {
          id: "EXC-23",
          decision: "conditional-approved",
          targets: ["production-candidate"],
          chapter: "23",
          owner: "Release Owner",
          dueDate: "2026-07-15",
          userImpact: "Conditional until DB evidence is attached.",
          mitigation: "Run DB-backed E2E before unrestricted use.",
          approvalEvidence: "APPROVAL-1",
        },
        {
          id: "EXC-25-1",
          decision: "conditional-approved",
          targets: ["production-candidate"],
          sections: ["25.1"],
          owner: "Deployment Owner",
          dueDate: "2026-07-15",
          userImpact: "Conditional until platform evidence is attached.",
          mitigation: "Keep production inventory gate strict.",
          approvalEvidence: "APPROVAL-1",
        },
      ],
    }));
    const items = parseGoLiveChecklist(synthetic);
    const productionCandidate = evaluateGoLiveReadiness(items, "production-candidate", { approvalExceptions: approval.exceptions });
    const goLive = evaluateGoLiveReadiness(items, "go-live", { approvalExceptions: approval.exceptions });

    assert.equal(productionCandidate.ok, true);
    assert.equal(productionCandidate.conditional, true);
    assert.equal(productionCandidate.approvedBlockers.length, 2);
    assert.equal(productionCandidate.blockers.length, 0);
    assert.equal(goLive.ok, false, "chapter 24 remains unapproved for go-live scope");
  });
});