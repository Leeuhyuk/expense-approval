#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultHandoffPath = "docs/go-live-handoff-template.md";
const requiredSections = [
  "Release Identity",
  "Required Owner Contacts",
  "Role UAT Evidence",
  "Known Issues",
  "Workarounds",
  "Rollback Criteria",
  "Support Window",
  "Final Go-Live Sign-Off",
  "Attachments And Evidence",
];

const requiredTerms = [
  "Release manifest hash",
  "Migration review hash",
  "Staging validation evidence",
  "기능 책임자",
  "보안 책임자",
  "재무 책임자",
  "운영 책임자",
  "요청자",
  "승인자",
  "재무팀",
  "관리자",
  "외부 감사",
  "Known Issues",
  "우회 절차",
  "Rollback Criteria",
  "data-quality",
  "requestId",
  "Hypercare",
  "Final Go-Live Sign-Off",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
  /KI-TBD/i,
];

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function hasSection(source, section) {
  return new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(source);
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

export function runGoLiveHandoffChecks({
  projectRoot = process.cwd(),
  handoffPath = process.env.GO_LIVE_HANDOFF_PATH || defaultHandoffPath,
  strict = isTruthyEnvValue(process.env.GO_LIVE_HANDOFF_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, handoffPath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "go-live handoff document exists",
    ok: exists,
    detail: handoffPath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, handoffPath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `go-live handoff section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "go-live handoff covers release, UAT, known issue, workaround, rollback, support, and sign-off terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "go-live handoff unresolved placeholder audit",
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
    handoffPath,
    unresolvedCount: unresolved.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runGoLiveHandoffChecks();
    console.log(`[go-live-handoff] mode=${result.strict ? "strict" : "audit"} path=${result.handoffPath}`);
    for (const check of result.checks) {
      console.log(`[go-live-handoff] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[go-live-handoff] FAIL ${result.failures.length} go-live handoff check(s) failed.`);
      process.exit(1);
    }
    console.log(`[go-live-handoff] PASS ${result.checks.length} go-live handoff check(s) passed.`);
  } catch (error) {
    console.error(`[go-live-handoff] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
