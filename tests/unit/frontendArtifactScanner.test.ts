import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { scanArtifactDirectory, scanArtifactText } from "../../scripts/frontendArtifactScanner.mjs";

describe("frontend production artifact scanner", () => {
  it("detects mock fixtures, test identities, seed markers, dev secrets, and local endpoints", () => {
    const issues = scanArtifactText(
      [
        "mock-download:file-1",
        "kim.minsu@example.local",
        "http://127.0.0.1:4000/api",
        "seed:encrypted:vendor",
        "dev-file-url-secret-change-in-production",
      ].join("\n"),
      "assets/index.js",
    );

    assert.deepEqual(
      [...new Set(issues.map((issue) => issue.ruleId))].sort(),
      ["dev-secret", "local-endpoint", "mock-fixture-runtime", "seed-data", "test-email"],
    );
  });

  it("passes a remote-only artifact directory", () => {
    const root = mkdtempSync(join(tmpdir(), "erp-artifact-"));
    try {
      writeFileSync(join(root, "index.html"), "<script type=\"module\" src=\"/assets/index.js\"></script>");
      writeFileSync(join(root, "index.js"), "const apiMode='remote';const apiBase='/api';");

      const result = scanArtifactDirectory(root);

      assert.equal(result.scannedFiles, 2);
      assert.equal(result.issues.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
