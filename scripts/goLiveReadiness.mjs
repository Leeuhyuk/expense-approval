import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const readinessTargets = new Set(["audit", "production-candidate", "go-live", "stable-operation"]);
export const defaultApprovalExceptionsPath = "docs/release-approval-exceptions.json";

const unresolvedPattern = /\b(TBD|pending)\b|<[^>\n]+>/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isChecked(mark) {
  return mark.trim().toLowerCase() === "x";
}

function sectionTitle(line) {
  return line.replace(/^#+\s*/, "").trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function hasResolvedValue(value) {
  return typeof value === "string" && value.trim().length > 0 && !unresolvedPattern.test(value);
}

function normalizeApprovalException(exception, index) {
  const targets = normalizeList(exception.targets ?? exception.scope ?? exception.target ?? "all");
  const sections = normalizeList(exception.sections ?? exception.section);
  const textIncludes = normalizeList(exception.textIncludes ?? exception.text ?? exception.matchText);
  return {
    id: String(exception.id ?? `approval-exception-${index + 1}`).trim(),
    decision: String(exception.decision ?? "approved").trim().toLowerCase(),
    targets,
    chapter: exception.chapter === undefined ? null : String(exception.chapter).trim(),
    sections,
    textIncludes,
    owner: String(exception.owner ?? "").trim(),
    dueDate: String(exception.dueDate ?? exception.due ?? "").trim(),
    userImpact: String(exception.userImpact ?? "").trim(),
    mitigation: String(exception.mitigation ?? "").trim(),
    approvalEvidence: String(exception.approvalEvidence ?? "").trim(),
    raw: exception,
  };
}

function approvalExceptionFailures(exception) {
  const failures = [];
  if (!hasResolvedValue(exception.id)) failures.push("id is required");
  if (!["approved", "conditional-approved", "conditional_go", "conditional-go"].includes(exception.decision)) {
    failures.push("decision must be approved or conditional-approved");
  }
  if (!hasResolvedValue(exception.owner)) failures.push("owner is required");
  if (!datePattern.test(exception.dueDate)) failures.push("dueDate must use YYYY-MM-DD");
  if (!hasResolvedValue(exception.userImpact)) failures.push("userImpact is required");
  if (!hasResolvedValue(exception.mitigation)) failures.push("mitigation is required");
  if (!hasResolvedValue(exception.approvalEvidence)) failures.push("approvalEvidence is required");
  if (!exception.chapter && exception.sections.length === 0 && exception.textIncludes.length === 0) {
    failures.push("chapter, sections, or textIncludes is required");
  }
  return failures;
}

export function parseApprovalExceptions(source) {
  const parsed = JSON.parse(source);
  const rawExceptions = Array.isArray(parsed) ? parsed : parsed.exceptions;
  if (!Array.isArray(rawExceptions)) {
    throw new Error("approval exceptions file must contain an exceptions array");
  }

  const exceptions = rawExceptions.map(normalizeApprovalException);
  const errors = [];
  exceptions.forEach((exception) => {
    const failures = approvalExceptionFailures(exception);
    failures.forEach((failure) => errors.push(`${exception.id}: ${failure}`));
  });

  return {
    approvalId: String(parsed.approvalId ?? "").trim(),
    approver: String(parsed.approver ?? "").trim(),
    approvedAt: String(parsed.approvedAt ?? "").trim(),
    decision: String(parsed.decision ?? "conditional-go").trim(),
    source: parsed.source ?? null,
    exceptions,
    errors,
  };
}

export function readApprovalExceptions(path = process.env.READINESS_APPROVAL_EXCEPTIONS_PATH || defaultApprovalExceptionsPath, { optional = true } = {}) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    if (optional) {
      return { path, resolvedPath: resolved, approvalId: "", approver: "", approvedAt: "", decision: "", source: null, exceptions: [], errors: [] };
    }
    throw new Error(`approval exceptions file not found: ${path}`);
  }

  const parsed = parseApprovalExceptions(readFileSync(resolved, "utf8"));
  return { path, resolvedPath: resolved, ...parsed };
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

function targetMatchesException(target, exception) {
  if (target === "audit") return true;
  return exception.targets.length === 0 || exception.targets.includes("all") || exception.targets.includes(target);
}

function itemMatchesException(item, exception) {
  if (exception.sections.length > 0 && exception.sections.includes(item.section)) return true;
  if (exception.chapter && exception.chapter === item.chapter) return true;
  if (exception.textIncludes.length > 0 && exception.textIncludes.some((text) => item.text.includes(text))) return true;
  return false;
}

function findApprovalException(item, target, approvalExceptions) {
  return approvalExceptions.find((exception) => targetMatchesException(target, exception) && itemMatchesException(item, exception)) ?? null;
}

export function evaluateGoLiveReadiness(items, target = "audit", { approvalExceptions = [] } = {}) {
  if (!readinessTargets.has(target)) {
    return {
      ok: false,
      conditional: false,
      target,
      summaries: summarizeReadiness(items),
      openBlockers: [],
      approvedBlockers: [],
      blockers: [],
      exceptionErrors: [],
      errors: [`READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`],
    };
  }

  const normalizedExceptions = approvalExceptions.map(normalizeApprovalException);
  const exceptionErrors = [];
  const validExceptions = [];
  for (const exception of normalizedExceptions) {
    const failures = approvalExceptionFailures(exception);
    if (failures.length === 0) validExceptions.push(exception);
    else failures.forEach((failure) => exceptionErrors.push(`${exception.id}: ${failure}`));
  }

  const inScope = targetScopePredicate(target);
  const openBlockers = items.filter((item) => inScope(item) && !item.checked);
  const approvedBlockers = [];
  const blockers = [];

  for (const item of openBlockers) {
    const exception = findApprovalException(item, target, validExceptions);
    if (exception) approvedBlockers.push({ item, exception });
    else blockers.push(item);
  }

  const conditional = openBlockers.length > 0 && blockers.length === 0 && exceptionErrors.length === 0;
  return {
    ok: target === "audit" || (blockers.length === 0 && exceptionErrors.length === 0),
    conditional,
    target,
    summaries: summarizeReadiness(items),
    openBlockers,
    approvedBlockers,
    blockers,
    exceptionErrors,
    errors: [],
  };
}

export function readGoLiveChecklist(path = "erp-system-checklist.md") {
  return parseGoLiveChecklist(readFileSync(resolve(process.cwd(), path), "utf8"));
}