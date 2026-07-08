#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/backup-restore-rehearsal-template.md";

const requiredSections = [
  "Recovery Objectives",
  "Backup Configuration",
  "PITR And WAL",
  "Object Storage Recovery",
  "Report Artifact Recovery",
  "Restore Rehearsal",
  "Migration Rollback Rehearsal",
  "Access And Encryption",
  "Monitoring And Alerts",
  "Evidence Links",
  "Approval",
];

const requiredTerms = [
  "RPO",
  "RTO",
  "PostgreSQL full backup",
  "WAL",
  "PITR",
  "Point-in-time restore",
  "backup encryption",
  "Backup access",
  "Restore account",
  "object storage bucket versioning",
  "Attachment metadata reconciliation",
  "Report artifact backup",
  "Staging restore environment",
  "Row count reconciliation",
  "Payment total reconciliation",
  "Budget balance reconciliation",
  "Vendor payment history",
  "Attachment orphan",
  "Data-quality endpoint",
  "Migration failure",
  "Partial deploy rollback",
  "DB outage",
  "Object storage outage",
  "API outage",
  "Compensating migration",
  "Previous release manifest",
  "Break-glass",
  "secret-manager-reference",
  "Backup success monitor",
  "Backup failure monitor",
  "requestId",
  "DBA approver",
  "Security approver",
  "Operations approver",
  "Finance approver",
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

export function runBackupRestoreEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.BACKUP_RESTORE_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.BACKUP_RESTORE_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "backup restore evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `backup restore evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "backup restore evidence covers RPO/RTO, backup, PITR, storage, restore, rollback, access, alerting, and approval terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "backup restore evidence unresolved placeholder audit",
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
    const result = runBackupRestoreEvidenceChecks();
    console.log(`[backup-restore-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[backup-restore-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[backup-restore-evidence] FAIL ${result.failures.length} backup restore evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[backup-restore-evidence] PASS ${result.checks.length} backup restore evidence check(s) passed.`);
  } catch (error) {
    console.error(`[backup-restore-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
