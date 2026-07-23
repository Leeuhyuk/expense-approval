#!/usr/bin/env node
import { scanSensitiveDataExposureProject } from "./sensitiveDataExposureScanner.mjs";

const result = scanSensitiveDataExposureProject(process.cwd());

if (result.issues.length > 0) {
  for (const item of result.issues) {
    console.error(`[sensitive-data] FAIL ${item.filePath}:${item.line} [${item.ruleId}] ${item.message}`);
  }
  process.exit(1);
}

console.log(`[sensitive-data] PASS checked ${result.scannedFiles} production source file(s).`);
