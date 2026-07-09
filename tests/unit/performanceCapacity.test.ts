import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  runPerformanceCapacityChecks,
  syntheticFileUploadWorkload,
  syntheticListCapacityWorkload,
  syntheticReportDownloadWorkload,
  syntheticReportGenerationWorkload,
  syntheticServerPaginationWorkload,
} from "../../scripts/verify-performance-capacity.mjs";

describe("performance capacity release gate", () => {
  it("runs production-volume list, server pagination, report, and upload workloads within configured budgets", () => {
    const list = syntheticListCapacityWorkload({ rowCount: 20_000, maxMs: 2_000 });
    assert.equal(list.ok, true);
    assert.equal(list.returned, 100);
    assert.ok(list.total >= 100);

    const serverPage = syntheticServerPaginationWorkload({ rowCount: 20_000, maxMs: 2_000 });
    assert.equal(serverPage.ok, true);
    assert.equal(serverPage.returned, 100);
    assert.equal(serverPage.hasOverlap, false);

    const generatedReport = syntheticReportGenerationWorkload({ rowCount: 750, maxMs: 2_000 });
    assert.equal(generatedReport.ok, true);
    assert.ok(generatedReport.departmentCount > 1);

    const report = syntheticReportDownloadWorkload({ rowCount: 750, maxMs: 2_000, maxBytes: 1_000_000 });
    assert.equal(report.ok, true);
    assert.ok(report.bytes > 0);

    const upload = syntheticFileUploadWorkload({ bytes: 2 * 1024 * 1024, maxMs: 2_000 });
    assert.equal(upload.ok, true);
    assert.equal(upload.uploadedBytes, upload.bytes);
    assert.equal(upload.checksum.length, 64);
  });

  it("validates route pagination, Prisma indexes, upload size, body limit, and rate limit evidence", () => {
    const result = runPerformanceCapacityChecks({
      projectRoot: resolve("."),
      expectedRows: 20_000,
      reportRows: 750,
      maxListMs: 2_000,
      maxReportMs: 2_000,
      maxReportBytes: 1_000_000,
    });

    assert.equal(result.ok, true, result.failures.map((failure) => failure.label).join(", "));
    assert.ok(result.checks.length >= 20);
    assert.equal(result.metrics.listWorkload.returned, 100);
    assert.ok(result.metrics.reportWorkload.bytes > 0);
  });

  it("keeps the capacity gate wired into release commands and manifest inputs", () => {
    const packageJson = readFileSync(resolve("package.json"), "utf8");
    const manifestScript = readFileSync(resolve("scripts/generate-release-manifest.mjs"), "utf8");
    const ciSource = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

    assert.match(packageJson, /"release:performance-capacity":\s*"node scripts\/verify-performance-capacity\.mjs"/);
    assert.match(manifestScript, /"scripts\/verify-performance-capacity\.mjs"/);
    assert.match(ciSource, /Verify Performance Capacity[\s\S]*npm run release:performance-capacity/);
  });
});
