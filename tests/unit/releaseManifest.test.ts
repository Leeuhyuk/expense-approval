import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReleaseManifest, defaultReleaseManifestSections } from "../../scripts/generate-release-manifest.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-release-manifest-"));
}

describe("release artifact manifest", () => {
  it("hashes frontend, backend, and migration artifact files deterministically", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      mkdirSync(join(root, "backend", "dist"), { recursive: true });
      mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
      writeFileSync(join(root, "dist", "index.html"), "<div>app</div>");
      writeFileSync(join(root, "backend", "dist", "server.js"), "console.log('server');");
      writeFileSync(join(root, "prisma", "migrations", "migration_lock.toml"), 'provider = "postgresql"');

      const manifest = buildReleaseManifest({
        projectRoot: root,
        releaseTarget: "staging",
        releaseSourceRef: "v1.2.3",
        generatedAt: "2026-07-05T00:00:00.000Z",
        sections: [
          { id: "frontend", paths: ["dist"], required: true },
          { id: "backend", paths: ["backend/dist"], required: true },
          { id: "prisma-migrations", paths: ["prisma/migrations"], required: true },
        ],
      });

      assert.equal(manifest.manifestVersion, 1);
      assert.equal(manifest.releaseTarget, "staging");
      assert.equal(manifest.sourceRef, "v1.2.3");
      assert.equal(manifest.artifacts.length, 3);
      assert.equal(manifest.artifacts.find((section) => section.id === "frontend")?.fileCount, 1);
      assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
      assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(
        manifest.artifacts.flatMap((section) => section.files.map((file) => file.path)).sort(),
        ["backend/dist/server.js", "dist/index.html", "prisma/migrations/migration_lock.toml"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a required artifact section is missing", () => {
    const root = makeRoot();
    try {
      assert.throws(
        () =>
          buildReleaseManifest({
            projectRoot: root,
            sections: [{ id: "frontend", paths: ["dist"], required: true }],
          }),
        /Missing required release manifest path/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps release gate scripts in the manifest input hash", () => {
    const releaseInputs = defaultReleaseManifestSections.find((section) => section.id === "release-inputs");
    assert.ok(releaseInputs, "release-inputs section must exist");

    for (const scriptPath of [
      "scripts/verify-release-env.mjs",
      "scripts/verify-role-uat-evidence.mjs",
      "scripts/verify-mutation-safety.mjs",
      "scripts/sensitiveDataExposureScanner.mjs",
      "scripts/verify-sensitive-data-exposure.mjs",
      "scripts/verify-db-test-evidence.mjs",
      "scripts/generate-db-test-evidence.mjs",
      "scripts/verify-performance-capacity.mjs",
      "scripts/verify-operational-docs.mjs",
      "scripts/verify-backup-restore-evidence.mjs",
      "scripts/verify-data-migration-evidence.mjs",
      "scripts/verify-final-acceptance-evidence.mjs",
      "scripts/verify-post-go-live-stabilization-evidence.mjs",
      "scripts/verify-production-go-live-evidence.mjs",
      "scripts/verify-production-environment-inventory.mjs",
      "scripts/verify-staging-smoke-evidence.mjs",
      "scripts/verify-go-live-handoff.mjs",
      "scripts/verify-go-live-readiness.mjs",
      "scripts/mutationSafetyCatalog.mjs",
      "scripts/goLiveReadiness.mjs",
      "scripts/generate-go-live-readiness-report.mjs",
      "prisma/seed.ts",
      "src/domain/rolePolicy.ts",
      "scripts/verify-migration-review.mjs",
      "docs/user-manual.md",
      "docs/admin-manual.md",
      "docs/incident-response.md",
      "docs/test-automation.md",
      "docs/backup-restore-rehearsal-template.md",
      "docs/data-migration-evidence-template.md",
      "docs/final-acceptance-evidence-template.md",
      "docs/post-go-live-stabilization-evidence-template.md",
      "docs/production-go-live-evidence-template.md",
      "docs/production-environment-inventory-template.md",
      "docs/role-uat-evidence-template.md",
      "docs/staging-smoke-evidence-template.md",
      "docs/go-live-handoff-template.md",
      "docs/deployment-operations.md",
      "tests/e2e/remote-auth-smoke.test.mjs",
      "tests/e2e/remote-ui-persistence.test.mjs",
      "tests/integration/backendPaymentRequestFlow.test.ts",
    ]) {
      assert.ok(releaseInputs.paths.includes(scriptPath), `${scriptPath} must be part of release-inputs`);
    }
  });

  it("keeps generated release evidence artifacts in the manifest hash", () => {
    const releaseEvidence = defaultReleaseManifestSections.find((section) => section.id === "release-evidence");
    assert.ok(releaseEvidence, "release-evidence section must exist");
    assert.equal(releaseEvidence.required, true);

    for (const evidencePath of [
      "release/migration-review.json",
      "release/go-live-readiness-report.json",
      "release/go-live-readiness-report.md",
    ]) {
      assert.ok(releaseEvidence.paths.includes(evidencePath), `${evidencePath} must be part of release evidence`);
    }
  });

  it("keeps CI release manifests pinned to the GitHub release ref", () => {
    const ciSource = readFileSync(".github/workflows/ci.yml", "utf8");

    assert.match(ciSource, /Generate Release Manifest[\s\S]*RELEASE_SOURCE_REF:\s*\$\{\{ github\.ref_name \}\}/);
    assert.match(ciSource, /Verify Release Manifest[\s\S]*EXPECTED_RELEASE_SOURCE_REF:\s*\$\{\{ github\.ref_name \}\}/);
  });
});
