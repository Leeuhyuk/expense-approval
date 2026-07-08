#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultApprovalExceptionsPath,
  evaluateGoLiveReadiness,
  parseGoLiveChecklist,
  readApprovalExceptions,
  readinessTargets,
  summarizeReadiness,
} from "./goLiveReadiness.mjs";

const defaultChecklistPath = "erp-system-checklist.md";
const defaultJsonOutputPath = "release/go-live-readiness-report.json";
const defaultMarkdownOutputPath = "release/go-live-readiness-report.md";
const strictTargets = ["production-candidate", "go-live", "stable-operation"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function blockerCategories(item) {
  const text = `${item.sectionName} ${item.text}`.toLowerCase();
  const categories = [];

  if (item.chapter === "23" || /e2e|db|새로고침|재로그인|브라우저|데이터 유지/.test(text)) {
    categories.push("DB/E2E persistence evidence");
  }
  if (/staging|production|운영 환경|배포|도메인|secret|object storage|runtime|frontend|backend/.test(text)) {
    categories.push("environment/deployment evidence");
  }
  if (/backup|pitr|rollback|복구|리허설|장애|읽기 전용/.test(text)) {
    categories.push("recovery rehearsal evidence");
  }
  if (/uat|pilot|파일럿|계정|승인|sign-off|책임자|담당자|인수/.test(text)) {
    categories.push("owner/UAT approval evidence");
  }
  if (/이관|cutover|freeze|원천|대사|migration/.test(text)) {
    categories.push("migration/cutover evidence");
  }
  if (/kpi|오류율|hypercare|문의|backlog|릴리즈 계획/.test(text)) {
    categories.push("stabilization/operations evidence");
  }

  return categories.length > 0 ? categories : ["operational evidence"];
}

function enrichBlocker(item, index, exception = null) {
  return {
    index: index + 1,
    chapter: item.chapter,
    section: item.section,
    sectionName: item.sectionName,
    text: item.text,
    categories: blockerCategories(item),
    approvalExceptionId: exception?.id ?? null,
    approvalOwner: exception?.owner ?? null,
    approvalDueDate: exception?.dueDate ?? null,
    userImpact: exception?.userImpact ?? null,
    mitigation: exception?.mitigation ?? null,
  };
}

function approvedExceptionMap(result) {
  const map = new Map();
  for (const approved of result.approvedBlockers) {
    map.set(approved.item, approved.exception);
  }
  return map;
}

function exceptionSummary(approval) {
  return {
    path: approval.path ?? defaultApprovalExceptionsPath,
    approvalId: approval.approvalId,
    approver: approval.approver,
    approvedAt: approval.approvedAt,
    decision: approval.decision,
    total: approval.exceptions.length,
    invalidCount: approval.errors.length,
    errors: approval.errors,
  };
}

function targetResultSummary(result) {
  return {
    target: result.target,
    ok: result.ok,
    conditional: result.conditional,
    openP0Count: result.openBlockers.length,
    approvedExceptionCount: result.approvedBlockers.length,
    unapprovedP0Count: result.blockers.length,
  };
}

export function buildGoLiveReadinessReport({
  source,
  target = process.env.READINESS_TARGET ?? "audit",
  generatedAt = new Date().toISOString(),
  checklistPath = defaultChecklistPath,
  approvalExceptions,
  approvalExceptionsPath = process.env.READINESS_APPROVAL_EXCEPTIONS_PATH || defaultApprovalExceptionsPath,
} = {}) {
  const normalizedTarget = String(target).trim().toLowerCase();
  if (!readinessTargets.has(normalizedTarget)) {
    throw new Error(`READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`);
  }

  const checklistSource = source ?? readFileSync(resolve(process.cwd(), checklistPath), "utf8");
  const items = parseGoLiveChecklist(checklistSource);
  const approval = approvalExceptions
    ? { path: approvalExceptionsPath, approvalId: "inline", approver: "inline", approvedAt: "inline", decision: "inline", exceptions: approvalExceptions, errors: [] }
    : readApprovalExceptions(approvalExceptionsPath);

  const targetResult = evaluateGoLiveReadiness(items, normalizedTarget, { approvalExceptions: approval.exceptions });
  const allResult = evaluateGoLiveReadiness(items, "audit", { approvalExceptions: approval.exceptions });
  const allApproved = approvedExceptionMap(allResult);
  const targetApproved = approvedExceptionMap(targetResult);
  const allOpenBlockers = allResult.openBlockers.map((item, index) => enrichBlocker(item, index, allApproved.get(item)));
  const targetBlockers = targetResult.blockers.map((item, index) => enrichBlocker(item, index));
  const targetApprovedBlockers = targetResult.approvedBlockers.map(({ item, exception }, index) => enrichBlocker(item, index, exception));
  const targetResults = strictTargets.map((targetName) => {
    const result = evaluateGoLiveReadiness(items, targetName, { approvalExceptions: approval.exceptions });
    return targetResultSummary(result);
  });

  return {
    generatedAt,
    checklistPath,
    checklistSha256: sha256(checklistSource),
    target: normalizedTarget,
    ok: targetResult.ok,
    conditional: targetResult.conditional,
    approvalExceptions: exceptionSummary({ ...approval, errors: [...approval.errors, ...targetResult.exceptionErrors] }),
    summaries: summarizeReadiness(items),
    targetResults,
    allOpenP0Count: allOpenBlockers.length,
    targetOpenP0Count: targetResult.openBlockers.length,
    targetApprovedExceptionCount: targetApproved.size,
    targetUnapprovedP0Count: targetBlockers.length,
    targetBlockers,
    targetApprovedBlockers,
    allOpenBlockers,
  };
}

function markdownTableRow(cells) {
  return `| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function resultLabel(result) {
  if (result.ok && result.conditional) return "CONDITIONAL";
  if (result.ok) return "PASS";
  return "BLOCKED";
}

function blockerRows(blockers, includeApproval = false) {
  const headers = includeApproval ? ["#", "Section", "Category", "Approval", "Due", "Blocker"] : ["#", "Section", "Category", "Blocker"];
  const lines = [markdownTableRow(headers), markdownTableRow(headers.map((header, index) => (index === 0 ? "---:" : "---")))];
  for (const blocker of blockers) {
    if (includeApproval) {
      lines.push(markdownTableRow([blocker.index, blocker.section, blocker.categories.join(", "), blocker.approvalExceptionId ?? "", blocker.approvalDueDate ?? "", blocker.text]));
    } else {
      lines.push(markdownTableRow([blocker.index, blocker.section, blocker.categories.join(", "), blocker.text]));
    }
  }
  return lines;
}

export function renderGoLiveReadinessMarkdown(report) {
  const lines = [
    "# Go-Live Readiness Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Checklist: \`${report.checklistPath}\``,
    "",
    `Checklist SHA-256: \`${report.checklistSha256}\``,
    "",
    `Target: \`${report.target}\``,
    "",
    `Result: ${report.conditional ? "CONDITIONAL" : report.ok ? "PASS" : "BLOCKED"}`,
    "",
    "## Approval Exceptions",
    "",
    markdownTableRow(["Approval ID", "Approver", "Approved At", "Decision", "Exception Count", "Invalid"]),
    markdownTableRow(["---", "---", "---", "---", "---:", "---:"]),
    markdownTableRow([
      report.approvalExceptions.approvalId || "none",
      report.approvalExceptions.approver || "none",
      report.approvalExceptions.approvedAt || "none",
      report.approvalExceptions.decision || "none",
      report.approvalExceptions.total,
      report.approvalExceptions.invalidCount,
    ]),
  ];

  if (report.approvalExceptions.errors.length > 0) {
    lines.push("", "Invalid approval exception entries:");
    for (const error of report.approvalExceptions.errors) lines.push(`- ${error}`);
  }

  lines.push("", "## Chapter Summary", "", markdownTableRow(["Chapter", "Complete", "Total", "Open"]), markdownTableRow(["---", "---:", "---:", "---:"]));

  for (const summary of report.summaries) {
    lines.push(markdownTableRow([summary.chapter, summary.checked, summary.total, summary.open]));
  }

  lines.push(
    "",
    "## Target Results",
    "",
    markdownTableRow(["Target", "Result", "Open P0", "Approved Exceptions", "Unapproved P0"]),
    markdownTableRow(["---", "---", "---:", "---:", "---:"]),
  );
  for (const result of report.targetResults) {
    lines.push(markdownTableRow([result.target, resultLabel(result), result.openP0Count, result.approvedExceptionCount, result.unapprovedP0Count]));
  }

  lines.push("", "## Target Unapproved Blockers", "");
  if (report.targetBlockers.length === 0) {
    lines.push("No unapproved open P0 blockers remain in the selected target scope.");
  } else {
    lines.push(...blockerRows(report.targetBlockers));
  }

  lines.push("", "## Target Approved Exception Blockers", "");
  if (report.targetApprovedBlockers.length === 0) {
    lines.push("No open P0 blockers in the selected target scope are covered by approval exceptions.");
  } else {
    lines.push(...blockerRows(report.targetApprovedBlockers, true));
  }

  lines.push("", "## All Open P0 Blockers", "");
  if (report.allOpenBlockers.length === 0) {
    lines.push("No open P0 blockers remain.");
  } else {
    lines.push(...blockerRows(report.allOpenBlockers, true));
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeGoLiveReadinessReport({
  report,
  jsonOutputPath = process.env.READINESS_REPORT_JSON_PATH || defaultJsonOutputPath,
  markdownOutputPath = process.env.READINESS_REPORT_MARKDOWN_PATH || defaultMarkdownOutputPath,
} = {}) {
  const resolvedJson = resolve(process.cwd(), jsonOutputPath);
  const resolvedMarkdown = resolve(process.cwd(), markdownOutputPath);
  mkdirSync(dirname(resolvedJson), { recursive: true });
  mkdirSync(dirname(resolvedMarkdown), { recursive: true });
  writeFileSync(resolvedJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolvedMarkdown, renderGoLiveReadinessMarkdown(report));
  return {
    jsonOutputPath,
    markdownOutputPath,
    resolvedJson,
    resolvedMarkdown,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const checklistPath = process.env.READINESS_CHECKLIST_PATH || defaultChecklistPath;
    const resolvedChecklist = resolve(process.cwd(), checklistPath);
    if (!existsSync(resolvedChecklist)) {
      throw new Error(`Readiness checklist not found: ${checklistPath}`);
    }

    const report = buildGoLiveReadinessReport({ checklistPath });
    const outputs = writeGoLiveReadinessReport({ report });
    console.log(`[go-live-readiness-report] target=${report.target} result=${report.conditional ? "CONDITIONAL" : report.ok ? "PASS" : "BLOCKED"}`);
    console.log(`[go-live-readiness-report] allOpenP0=${report.allOpenP0Count} targetOpenP0=${report.targetOpenP0Count} approved=${report.targetApprovedExceptionCount} unapproved=${report.targetUnapprovedP0Count}`);
    console.log(`[go-live-readiness-report] wrote ${normalizePath(relative(process.cwd(), outputs.resolvedJson))}`);
    console.log(`[go-live-readiness-report] wrote ${normalizePath(relative(process.cwd(), outputs.resolvedMarkdown))}`);
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[go-live-readiness-report] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}