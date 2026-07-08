import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const readinessTargets = new Set(["audit", "production-candidate", "go-live", "stable-operation"]);

function isChecked(mark) {
  return mark.trim().toLowerCase() === "x";
}

function sectionTitle(line) {
  return line.replace(/^#+\s*/, "").trim();
}

export function parseGoLiveChecklist(source) {
  const items = [];
  let chapter = "";
  let chapterTitle = "";
  let section = "";
  let sectionName = "";

  for (const line of source.split(/\r?\n/)) {
    const chapterMatch = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (chapterMatch) {
      chapter = chapterMatch[1];
      chapterTitle = sectionTitle(line);
      section = chapter;
      sectionName = chapterTitle;
      continue;
    }

    const sectionMatch = line.match(/^###\s+(\d+\.\d+)\s+(.+)$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      sectionName = sectionTitle(line);
      continue;
    }

    const itemMatch = line.match(/^-\s+\[([ xX])\]\s+P0:\s+(.+)$/);
    if (!itemMatch || !["23", "24", "25"].includes(chapter)) continue;

    items.push({
      checked: isChecked(itemMatch[1]),
      chapter,
      chapterTitle,
      section,
      sectionName,
      text: itemMatch[2].trim(),
      line,
    });
  }

  return items;
}

export function summarizeReadiness(items) {
  const byChapter = new Map();
  for (const item of items) {
    const summary = byChapter.get(item.chapter) ?? {
      chapter: item.chapter,
      title: item.chapterTitle,
      total: 0,
      checked: 0,
      open: 0,
    };
    summary.total += 1;
    if (item.checked) summary.checked += 1;
    else summary.open += 1;
    byChapter.set(item.chapter, summary);
  }
  return Array.from(byChapter.values()).sort((a, b) => Number(a.chapter) - Number(b.chapter));
}

function isProductionCandidateScope(item) {
  return item.chapter === "23" || item.section === "25.1" || item.section === "25.2";
}

function isGoLiveApprovalScope(item) {
  return item.chapter === "23" || item.chapter === "24" || (item.chapter === "25" && item.section !== "25.8");
}

function isStableOperationScope(item) {
  return item.chapter === "23" || item.chapter === "24" || item.chapter === "25";
}

export function targetScopePredicate(target) {
  if (target === "audit") return () => true;
  if (target === "production-candidate") return isProductionCandidateScope;
  if (target === "go-live") return isGoLiveApprovalScope;
  if (target === "stable-operation") return isStableOperationScope;
  throw new Error(`Unknown readiness target: ${target}`);
}

export function evaluateGoLiveReadiness(items, target = "audit") {
  if (!readinessTargets.has(target)) {
    return {
      ok: false,
      target,
      summaries: summarizeReadiness(items),
      blockers: [],
      errors: [`READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`],
    };
  }

  const inScope = targetScopePredicate(target);
  const blockers = items.filter((item) => inScope(item) && !item.checked);
  return {
    ok: target === "audit" || blockers.length === 0,
    target,
    summaries: summarizeReadiness(items),
    blockers,
    errors: [],
  };
}

export function readGoLiveChecklist(path = "erp-system-checklist.md") {
  return parseGoLiveChecklist(readFileSync(resolve(process.cwd(), path), "utf8"));
}
