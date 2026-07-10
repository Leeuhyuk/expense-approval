import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { runOperationalDocsChecks } from "../../scripts/verify-operational-docs.mjs";

describe("operational documentation release gate", () => {
  it("verifies user, admin, incident, deployment, button, API, and migration readiness docs", () => {
    const result = runOperationalDocsChecks({ projectRoot: resolve(".") });

    assert.equal(result.ok, true, result.failures.map((failure) => `${failure.label}: ${failure.detail}`).join("\n"));
    assert.ok(result.checks.length >= 15);
  });

  it("keeps operational documentation checks wired into release evidence", () => {
    const packageJson = readFileSync(resolve("package.json"), "utf8");
    const manifestScript = readFileSync(resolve("scripts/generate-release-manifest.mjs"), "utf8");
    const ciSource = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
    const deploymentRunbook = readFileSync(resolve("docs/deployment-operations.md"), "utf8");

    assert.match(packageJson, /"release:operational-docs":\s*"node scripts\/verify-operational-docs\.mjs"/);
    assert.match(manifestScript, /"scripts\/verify-operational-docs\.mjs"/);
    assert.match(manifestScript, /"docs\/disaster-recovery-failover-runbook\.md"/);
    assert.match(ciSource, /Verify Operational Documentation[\s\S]*npm run release:operational-docs/);
    assert.match(deploymentRunbook, /npm run release:operational-docs/);
    assert.match(deploymentRunbook, /docs\/incident-response\.md/);
    assert.match(deploymentRunbook, /docs\/disaster-recovery-failover-runbook\.md/);
  });
});
