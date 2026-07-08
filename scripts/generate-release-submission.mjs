#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoLiveReadinessReport } from "./generate-go-live-readiness-report.mjs";

const defaultOutputPath = "docs/release-submission-package.md";

function git(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function markdownTableRow(cells) {
  return `| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function resultLabel(result) {
  if (result.ok && result.conditional) return "CONDITIONAL";
  if (result.ok) return "PASS";
  return "BLOCKED";
}

function renderSubmissionPackage({ report, generatedAt, repoUrl, head }) {

  const lines = [
    "# Release Submission Package",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "This package records the user-delegated conditional approval and submission state. It does not convert missing staging, production, UAT, backup, migration, or first-week operation evidence into completed work.",
    "",
    "## Source",
    "",
    markdownTableRow(["Item", "Value"]),
    markdownTableRow(["---", "---"]),
    markdownTableRow(["Repository", repoUrl]),
    markdownTableRow(["Base source commit at generation", head]),
    markdownTableRow(["Submission package commit", "the Git commit that contains this file"]),
    markdownTableRow(["Submission destination", "origin/main on https://github.com/Leeuhyuk/expense-approval.git"]),
    "",
    "## Delegated Approval",
    "",
    markdownTableRow(["Item", "Value"]),
    markdownTableRow(["---", "---"]),
    markdownTableRow(["Approval ID", report.approvalExceptions.approvalId || "none"]),
    markdownTableRow(["Approver", report.approvalExceptions.approver || "none"]),
    markdownTableRow(["Approved at", report.approvalExceptions.approvedAt || "none"]),
    markdownTableRow(["Decision", report.approvalExceptions.decision || "none"]),
    markdownTableRow(["Approval exceptions", report.approvalExceptions.total]),
    markdownTableRow(["Invalid approval exceptions", report.approvalExceptions.invalidCount]),
    "",
    "## Readiness Result",
    "",
    markdownTableRow(["Target", "Result", "Open P0", "Approved Exceptions", "Unapproved P0"]),
    markdownTableRow(["---", "---", "---:", "---:", "---:"]),
  ];

  for (const result of report.targetResults) {
    lines.push(markdownTableRow([result.target, resultLabel(result), result.openP0Count, result.approvedExceptionCount, result.unapprovedP0Count]));
  }

  lines.push(
    "",
    "## Submission Scope",
    "",
    "- Source changes, approval exception policy, and readiness gate logic are submitted to the GitHub repository.",
    "- Open P0 items are accepted only as conditional exceptions when owner, due date, user impact, mitigation, and approval evidence are present.",
    "- Unrestricted production operation still requires completed strict evidence files for staging smoke, production environment inventory, backup/restore, data migration, role UAT, production go-live, final acceptance, and post-go-live stabilization.",
    "",
    "## Remaining Evidence Before Full Operation",
    "",
    markdownTableRow(["Evidence", "Required path or gate"]),
    markdownTableRow(["---", "---"]),
    markdownTableRow(["Staging smoke", "STAGING_SMOKE_EVIDENCE_PATH / npm run release:staging-smoke-evidence"]),
    markdownTableRow(["Production inventory", "PRODUCTION_ENVIRONMENT_INVENTORY_PATH / npm run release:environment-inventory"]),
    markdownTableRow(["Backup and restore", "BACKUP_RESTORE_EVIDENCE_PATH / npm run release:backup-restore-evidence"]),
    markdownTableRow(["Data migration", "DATA_MIGRATION_EVIDENCE_PATH / npm run release:data-migration-evidence"]),
    markdownTableRow(["Role UAT", "ROLE_UAT_EVIDENCE_PATH / npm run release:role-uat-evidence"]),
    markdownTableRow(["Production go-live", "PRODUCTION_GO_LIVE_EVIDENCE_PATH / npm run release:production-go-live-evidence"]),
    markdownTableRow(["Final acceptance", "FINAL_ACCEPTANCE_EVIDENCE_PATH / npm run release:final-acceptance-evidence"]),
    markdownTableRow(["Post go-live stabilization", "POST_GO_LIVE_STABILIZATION_EVIDENCE_PATH / npm run release:post-go-live-stabilization-evidence"]),
    "",
  );

  return `${lines.join("\n")}\n`;
}

export function writeReleaseSubmissionPackage({
  outputPath = process.env.RELEASE_SUBMISSION_PATH || defaultOutputPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const report = buildGoLiveReadinessReport({ target: "audit", generatedAt });
  const output = resolve(process.cwd(), outputPath);
  const repoUrl = git(["remote", "get-url", "origin"]);
  const head = git(["rev-parse", "--short", "HEAD"]);
  const originMain = git(["rev-parse", "--short", "origin/main"]);
  const status = git(["status", "--short"], "");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderSubmissionPackage({ report, generatedAt, repoUrl, head }));
  return { outputPath, resolvedOutput: output, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = writeReleaseSubmissionPackage();
    console.log(`[release-submission] wrote ${relative(process.cwd(), result.resolvedOutput).replaceAll("\\", "/")}`);
    console.log(`[release-submission] conditional=${result.report.conditional} openP0=${result.report.allOpenP0Count} unapprovedP0=${result.report.targetUnapprovedP0Count}`);
    if (!result.report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[release-submission] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}