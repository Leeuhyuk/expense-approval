#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/data-migration-evidence-template.md";

const requiredSections = [
  "Migration Identity",
  "Source Systems",
  "Scope And Freeze Window",
  "Column Mapping",
  "Load Procedure",
  "Staging Rehearsal",
  "Production Reconciliation",
  "Sensitive Data Controls",
  "Test Data And Marker Checks",
  "Rollback And Rerun",
  "Evidence Links",
  "Approvals",
];

const requiredTerms = [
  "source system",
  "source owner",
  "User",
  "Department",
  "Role/permission",
  "Vendor",
  "Bank account",
  "Budget",
  "Open payment request",
  "Attachment metadata",
  "freeze window",
  "column mapping",
  "validation query",
  "idempotent rerun",
  "Manual correction audit log",
  "Production seed disabled",
  "rollback condition",
  "Staging rehearsal",
  "row count reconciliation",
  "status aggregate reconciliation",
  "payment total reconciliation",
  "budget balance reconciliation",
  "vendor payment history reconciliation",
  "attachment metadata reconciliation",
  "Production reconciliation",
  "attachment orphan",
  "mock/local seed/test marker",
  "Bank account encryption",
  "Bank account masking",
  "Personal data access permission",
  "secret-manager-reference",
  "mockData",
  "local seed",
  "test email",
  "test account",
  "sample/mock/demo",
  "sample attachment",
  "quarantine",
  "/api/operations/data-quality",
  "AuditLog",
  "Business owner approver",
  "Security owner approver",
  "Finance owner approver",
  "Operations owner approver",
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

export function runDataMigrationEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.DATA_MIGRATION_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.DATA_MIGRATION_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "data migration evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `data migration evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "data migration evidence covers source, scope, mapping, rehearsal, reconciliation, sensitive data, rollback, and approval terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "data migration evidence unresolved placeholder audit",
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
    const result = runDataMigrationEvidenceChecks();
    console.log(`[data-migration-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[data-migration-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[data-migration-evidence] FAIL ${result.failures.length} data migration evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[data-migration-evidence] PASS ${result.checks.length} data migration evidence check(s) passed.`);
  } catch (error) {
    console.error(`[data-migration-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
