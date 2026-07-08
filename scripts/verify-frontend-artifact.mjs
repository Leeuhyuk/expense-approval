#!/usr/bin/env node
import { scanArtifactDirectory } from "./frontendArtifactScanner.mjs";

const artifactDir = process.argv[2] || process.env.FRONTEND_ARTIFACT_DIR || "dist";

try {
  const result = scanArtifactDirectory(artifactDir, { requireHostingPolicy: true });
  if (result.issues.length > 0) {
    console.error(`[frontend-artifact] FAIL scanned ${result.scannedFiles} files in ${result.root}`);
    for (const issue of result.issues.slice(0, 30)) {
      console.error(`[frontend-artifact] ${issue.filePath}: ${issue.ruleId} - ${issue.message}`);
      console.error(`[frontend-artifact]   ${issue.excerpt}`);
    }
    if (result.issues.length > 30) {
      console.error(`[frontend-artifact] ...and ${result.issues.length - 30} more issue(s).`);
    }
    process.exit(1);
  }

  console.log(`[frontend-artifact] PASS scanned ${result.scannedFiles} files in ${result.root}`);
} catch (error) {
  console.error(`[frontend-artifact] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
