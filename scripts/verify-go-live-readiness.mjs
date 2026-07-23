#!/usr/bin/env node
import { evaluateGoLiveReadiness, readGoLiveChecklist, readinessTargets } from "./goLiveReadiness.mjs";

const target = (process.env.READINESS_TARGET ?? "audit").trim().toLowerCase();
const checklistPath = process.env.READINESS_CHECKLIST_PATH ?? "erp-system-checklist.md";

if (!readinessTargets.has(target)) {
  console.error(`[go-live-readiness] FAIL READINESS_TARGET must be one of ${Array.from(readinessTargets).join(", ")}.`);
  process.exit(1);
}

const items = readGoLiveChecklist(checklistPath);
const result = evaluateGoLiveReadiness(items, target);

console.log(`[go-live-readiness] target=${target}`);
for (const summary of result.summaries) {
  console.log(`[go-live-readiness] chapter ${summary.chapter}: ${summary.checked}/${summary.total} P0 complete, ${summary.open} open`);
}

if (result.blockers.length > 0) {
  const label = target === "audit" ? "WARN" : "FAIL";
  console.log(`[go-live-readiness] ${label} ${result.blockers.length} open P0 blocker(s) in scope.`);
  for (const blocker of result.blockers.slice(0, 25)) {
    console.log(`[go-live-readiness] - ${blocker.section} ${blocker.text}`);
  }
  if (result.blockers.length > 25) {
    console.log(`[go-live-readiness] - ... ${result.blockers.length - 25} more open P0 blocker(s)`);
  }
} else {
  console.log("[go-live-readiness] PASS no open P0 blockers in target scope.");
}

if (!result.ok) {
  process.exitCode = 1;
}
