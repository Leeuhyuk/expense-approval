#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoLiveReadiness, parseGoLiveChecklist, readinessTargets, summarizeReadiness } from "./goLiveReadiness.mjs";

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

function enrichBlocker(item, index) {
  return {
    index: index + 1,
    chapter: item.chapter,
    section: item.section,
    sectionName: item.sectionName,
    text: item.text,
    categories: blockerCategories(item),
  };
}

export function buildGoLiveReadinessReport({
  source,
  target = process.env.READINESS_TARGET ?? "audit",
  generatedAt = new Date().toISOString(),
  checklistPath = defaultChecklistPath,
} = {}) {
  const normalizedTarget = String(target).trim().toLowerCase();
  if (!readinessTargets.has(normalizedTarget)) {
    throw new Error(`READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`);
  }

  const checklistSource = source ?? readFileSync(resolve(process.cwd(), checklistPath), "utf8");
  const items = parseGoLiveChecklist(checklistSource);
  const targetResult = evaluateGoLiveReadiness(items, normalizedTarget);
  const allOpenBlockers = items.filter((item) => !item.checked).map(enrichBlocker);
  const targetBlockers = targetResult.blockers.map(enrichBlocker);
  const targetResults = strictTargets.map((targetName) => {
    const result = evaluateGoLiveReadiness(items, targetName);
    return {
      target: targetName,
      ok: result.ok,
      openP0Count: result.blockers.length,
    };
  });

  return {
    generatedAt,
    checklistPath,
    checklistSha256: sha256(checklistSource),
    target: normalizedTarget,
    ok: targetResult.ok,
    summaries: summarizeReadiness(items),
    targetResults,
    allOpenP0Count: allOpenBlockers.length,
    targetOpenP0Count: targetBlockers.length,
    targetBlockers,
    allOpenBlockers,
  };
}

function markdownTableRow(cells) {
  return `| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
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
    `Result: ${report.ok ? "PASS" : "BLOCKED"}`,
    "",
    "## Chapter Summary",
    "",
    markdownTableRow(["Chapter", "Complete", "Total", "Open"]),
    markdownTableRow(["---", "---:", "---:", "---:"]),
  ];

  for (const summary of report.summaries) {
    lines.push(markdownTableRow([summary.chapter, summary.checked, summary.total, summary.open]));
  }

  lines.push("", "## Target Results", "", markdownTableRow(["Target", "Result", "Open P0"]), markdownTableRow(["---", "---", "---:"]));
  for (const result of report.targetResults) {
    lines.push(markdownTableRow([result.target, result.ok ? "PASS" : "BLOCKED", result.openP0Count]));
  }

  lines.push("", "## Target Blockers", "");
  if (report.targetBlockers.length === 0) {
    lines.push("No open P0 blockers in the selected target scope.");
  } else {
    lines.push(markdownTableRow(["#", "Section", "Category", "Blocker"]));
    lines.push(markdownTableRow(["---:", "---", "---", "---"]));
    for (const blocker of report.targetBlockers) {
      lines.push(markdownTableRow([blocker.index, blocker.section, blocker.categories.join(", "), blocker.text]));
    }
  }

  lines.push("", "## All Open P0 Blockers", "");
  if (report.allOpenBlockers.length === 0) {
    lines.push("No open P0 blockers remain.");
  } else {
    lines.push(markdownTableRow(["#", "Section", "Category", "Blocker"]));
    lines.push(markdownTableRow(["---:", "---", "---", "---"]));
    for (const blocker of report.allOpenBlockers) {
      lines.push(markdownTableRow([blocker.index, blocker.section, blocker.categories.join(", "), blocker.text]));
    }
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
    console.log(`[go-live-readiness-report] target=${report.target} result=${report.ok ? "PASS" : "BLOCKED"}`);
    console.log(`[go-live-readiness-report] allOpenP0=${report.allOpenP0Count} targetOpenP0=${report.targetOpenP0Count}`);
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
