import { evaluateMutationSafety } from "./mutationSafetyCatalog.mjs";

const result = evaluateMutationSafety();

console.log(`[mutation-safety] scanned ${result.discoveredRoutes.length} backend mutation route(s)`);
console.log(`[mutation-safety] catalogued ${result.catalogRoutes.length} expected route control record(s)`);

if (!result.ok) {
  console.error(`[mutation-safety] FAIL ${result.issues.length} issue(s) found.`);
  for (const item of result.issues.slice(0, 40)) {
    console.error(`[mutation-safety] - ${item.ruleId}: ${item.route} (${item.sourcePath}) ${item.message}`);
  }
  if (result.issues.length > 40) {
    console.error(`[mutation-safety] - ... ${result.issues.length - 40} more issue(s)`);
  }
  process.exit(1);
}

console.log("[mutation-safety] PASS all backend mutation routes are classified and guarded.");
