import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReleaseManifest } from "../../scripts/generate-release-manifest.mjs";
import { verifyReleaseManifest } from "../../scripts/verify-release-manifest.mjs";

const sections = [
  { id: "frontend", paths: ["dist"], required: true },
  { id: "backend", paths: ["backend/dist"], required: true },
  { id: "prisma-migrations", paths: ["prisma/migrations"], required: true },
];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "erp-release-manifest-verify-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "backend", "dist"), { recursive: true });
  mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
  writeFileSync(join(root, "dist", "index.html"), "<div>app</div>");
  writeFileSync(join(root, "backend", "dist", "server.js"), "console.log('server');");
  writeFileSync(join(root, "prisma", "migrations", "migration_lock.toml"), 'provider = "postgresql"');
  return root;
}

function writeManifest(root: string) {
  const manifest = buildReleaseManifest({
    projectRoot: root,
    releaseTarget: "staging",
    releaseSourceRef: "v1.2.3",
    generatedAt: "2026-07-05T00:00:00.000Z",
    sections,
  });
  writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

describe("release manifest verification", () => {
  it("passes when the recorded manifest matches current artifacts", () => {
    const root = makeRoot();
    try {
      const manifest = writeManifest(root);

      const result = verifyReleaseManifest({
        projectRoot: root,
        manifestPath: "release-manifest.json",
        sections,
        expectedManifestSha256: manifest.manifestSha256,
        expectedSourceRef: "v1.2.3",
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.errors, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the promotion manifest checksum does not match", () => {
    const root = makeRoot();
    try {
      writeManifest(root);

      const result = verifyReleaseManifest({
        projectRoot: root,
        manifestPath: "release-manifest.json",
        sections,
        expectedManifestSha256: "0".repeat(64),
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /EXPECTED_RELEASE_MANIFEST_SHA256 mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the expected release git commit does not match the recorded manifest", () => {
    const root = makeRoot();
    try {
      const manifest = writeManifest(root);
      manifest.git = { commit: "recorded-commit", branch: "release", dirty: false };
      writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      const result = verifyReleaseManifest({
        projectRoot: root,
        manifestPath: "release-manifest.json",
        sections,
        expectedGitCommit: "different-commit",
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /EXPECTED_RELEASE_GIT_COMMIT mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the expected release source ref does not match the recorded manifest", () => {
    const root = makeRoot();
    try {
      writeManifest(root);

      const result = verifyReleaseManifest({
        projectRoot: root,
        manifestPath: "release-manifest.json",
        sections,
        expectedSourceRef: "v9.9.9",
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /EXPECTED_RELEASE_SOURCE_REF mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when artifact files change after manifest generation", () => {
    const root = makeRoot();
    try {
      writeManifest(root);
      writeFileSync(join(root, "dist", "index.html"), "<div>changed</div>");

      const result = verifyReleaseManifest({
        projectRoot: root,
        manifestPath: "release-manifest.json",
        sections,
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /manifestSha256 changed|frontend\/dist\/index\.html/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
