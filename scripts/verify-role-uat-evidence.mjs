#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/role-uat-evidence-template.md";

const requiredSections = [
  "UAT Identity",
  "Role Accounts",
  "Permission Boundaries",
  "Pilot Scope",
  "Requester Scenarios",
  "Approver Scenarios",
  "Finance Scenarios",
  "Admin Scenarios",
  "Auditor Scenarios",
  "Reports And Evidence",
  "Issue Disposition",
  "Training And Support",
  "Final Role Sign-Off",
];

const requiredTerms = [
  "요청자",
  "승인자",
  "재무팀",
  "관리자",
  "외부 감사",
  "실제 계정",
  "권한 검증",
  "본인 결제 요청",
  "배정된 승인",
  "지급 조회",
  "권한 그룹",
  "read-only",
  "API 직접 호출 권한 우회",
  "Pilot 대상 부서",
  "Pilot 기간",
  "실제 금액 지급 전 통제",
  "제한 금액",
  "테스트 계좌",
  "은행 송금 dry-run",
  "결제 요청 생성",
  "증빙 첨부 업로드",
  "예산 확인",
  "반려",
  "보류",
  "순차 승인",
  "지급 실행 전 dry-run",
  "은행 이체 파일 생성",
  "2인 확인",
  "거래처 등록",
  "사용자 권한 변경",
  "시스템 설정 변경",
  "외부 연동 테스트",
  "감사 로그 조회",
  "보고서 다운로드",
  "민감정보 마스킹",
  "즐겨찾기",
  "requestId",
  "AuditLog",
  "P0 issue",
  "P1 exception approval",
  "Known issue",
  "사용자 교육",
  "운영 FAQ",
  "Hypercare",
  "기능 책임자",
  "보안 책임자",
  "재무 책임자",
  "운영 책임자",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSection(source, section) {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(source);
}

function hasTerm(source, term) {
  return source.toLowerCase().includes(term.toLowerCase());
}

function unresolvedLines(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => unresolvedPatterns.some((pattern) => pattern.test(line)));
}

export function runRoleUatEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.ROLE_UAT_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.ROLE_UAT_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "role UAT evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `role UAT evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "role UAT evidence covers accounts, permissions, pilot, scenarios, dry-run, issues, support, and sign-off terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "role UAT evidence unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    strict,
    evidencePath,
    unresolvedCount: unresolved.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runRoleUatEvidenceChecks();
    console.log(`[role-uat-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[role-uat-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[role-uat-evidence] FAIL ${result.failures.length} role UAT evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[role-uat-evidence] PASS ${result.checks.length} role UAT evidence check(s) passed.`);
  } catch (error) {
    console.error(`[role-uat-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
