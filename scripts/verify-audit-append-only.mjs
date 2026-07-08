#!/usr/bin/env node
import { scanAuditAppendOnlyProject } from "./auditAppendOnlyScanner.mjs";

const result = scanAuditAppendOnlyProject(process.cwd());

if (result.issues.length === 0) {
  console.log(`[audit-append-only] PASS scanned ${result.scannedFiles} source file(s).`);
} else {
  console.error(`[audit-append-only] FAIL found ${result.issues.length} append-only violation(s).`);
  for (const issue of result.issues) {
    console.error(`- ${issue.filePath}:${issue.line} [${issue.ruleId}] ${issue.message}`);
    console.error(`  ${issue.excerpt}`);
  }
  process.exitCode = 1;
}
