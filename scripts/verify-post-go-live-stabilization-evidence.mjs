#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/post-go-live-stabilization-evidence-template.md";

const requiredSections = [
  "Stabilization Identity",
  "Daily Operations Checks",
  "First Disbursement Reconciliation",
  "Backup And PITR After Production Data",
  "Incident And Support Triage",
  "Hypercare Report",
  "Go-Live Plus 2 Week Review",
  "Evidence Links",
  "Stabilization Sign-Off",
];

const requiredTerms = [
  "First week",
  "로그인 실패",
  "API 5xx",
  "승인 실패",
  "지급 실패",
  "파일 업로드 실패",
  "보고서 실패",
  "daily check",
  "first disbursement",
  "은행 결과",
  "ERP 상태",
  "AuditLog",
  "거래처 지급 이력",
  "report totals",
  "backup",
  "PITR",
  "production data",
  "severity",
  "P0",
  "P1",
  "same-day response",
  "requestId",
  "hypercare",
  "processing count",
  "average processing time",
  "inquiry",
  "remediation",
  "backlog",
  "sign-off",
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

export function runPostGoLiveStabilizationEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.POST_GO_LIVE_STABILIZATION_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "post go-live stabilization evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `post go-live stabilization evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "post go-live stabilization evidence covers daily checks, first disbursement, backup/PITR, severity, hypercare, backlog, and sign-off terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "post go-live stabilization evidence unresolved placeholder audit",
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
    const result = runPostGoLiveStabilizationEvidenceChecks();
    console.log(`[post-go-live-stabilization-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[post-go-live-stabilization-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[post-go-live-stabilization-evidence] FAIL ${result.failures.length} post go-live stabilization evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[post-go-live-stabilization-evidence] PASS ${result.checks.length} post go-live stabilization evidence check(s) passed.`);
  } catch (error) {
    console.error(`[post-go-live-stabilization-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
