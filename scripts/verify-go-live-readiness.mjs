#!/usr/bin/env node
import { evaluateGoLiveReadiness, readApprovalExceptions, readGoLiveChecklist, readinessTargets } from "./goLiveReadiness.mjs";

const target = (process.env.READINESS_TARGET ?? "audit").trim().toLowerCase();
const checklistPath = process.env.READINESS_CHECKLIST_PATH ?? "erp-system-checklist.md";

if (!readinessTargets.has(target)) {
  console.error(`[go-live-readiness] FAIL READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`);
  process.exit(1);
}

const approval = readApprovalExceptions();
const items = readGoLiveChecklist(checklistPath);
const result = evaluateGoLiveReadiness(items, target, { approvalExceptions: approval.exceptions });

console.log(`[go-live-readiness] target=${target}`);
for (const summary of result.summaries) {
  console.log(`[go-live-readiness] chapter ${summary.chapter}: ${summary.checked}/${summary.total} P0 complete, ${summary.open} open`);
}

if (approval.exceptions.length > 0) {
  console.log(`[go-live-readiness] approval exceptions=${approval.exceptions.length} path=${approval.path}`);
}
if (result.exceptionErrors.length > 0) {
  const label = target === "audit" ? "WARN" : "FAIL";
  console.log(`[go-live-readiness] ${label} ${result.exceptionErrors.length} invalid approval exception(s).`);
  for (const error of result.exceptionErrors.slice(0, 10)) {
    console.log(`[go-live-readiness] - ${error}`);
  }
}

if (result.openBlockers.length > 0) {
  console.log(`[go-live-readiness] open P0 in target=${result.openBlockers.length}, approved exceptions=${result.approvedBlockers.length}, unapproved=${result.blockers.length}`);
}

if (result.approvedBlockers.length > 0) {
  for (const approved of result.approvedBlockers.slice(0, 10)) {
    console.log(`[go-live-readiness] approved-exception ${approved.exception.id}: ${approved.item.section} ${approved.item.text}`);
  }
  if (result.approvedBlockers.length > 10) {
    console.log(`[go-live-readiness] approved-exception ... ${result.approvedBlockers.length - 10} more approved P0 exception(s)`);
  }
}

if (result.blockers.length > 0) {
  const label = target === "audit" ? "WARN" : "FAIL";
  console.log(`[go-live-readiness] ${label} ${result.blockers.length} unapproved open P0 blocker(s) in scope.`);
  for (const blocker of result.blockers.slice(0, 25)) {
    console.log(`[go-live-readiness] - ${blocker.section} ${blocker.text}`);
  }
  if (result.blockers.length > 25) {
    console.log(`[go-live-readiness] - ... ${result.blockers.length - 25} more unapproved open P0 blocker(s)`);
  }
} else if (result.conditional) {
  console.log("[go-live-readiness] PASS conditional: all open P0 blockers in target scope have approved exceptions.");
} else {
  console.log("[go-live-readiness] PASS no open P0 blockers in target scope.");
}

if (!result.ok) {
  process.exitCode = 1;
}