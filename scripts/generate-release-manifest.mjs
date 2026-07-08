#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultReleaseManifestSections = [
  { id: "frontend", paths: ["dist"], required: true },
  { id: "backend", paths: ["backend/dist"], required: true },
  { id: "prisma-migrations", paths: ["prisma/migrations"], required: true },
  {
    id: "release-evidence",
    paths: [
      "release/migration-review.json",
      "release/go-live-readiness-report.json",
      "release/go-live-readiness-report.md",
    ],
    required: true,
  },
  {
    id: "release-inputs",
    paths: [
      "package.json",
      "package-lock.json",
      "backend/package.json",
      "backend/package-lock.json",
      "prisma/schema.prisma",
      "prisma/seed.ts",
      ".github/workflows/ci.yml",
      "docs/admin-manual.md",
      "docs/api-spec.md",
      "docs/backup-restore-rehearsal-template.md",
      "docs/button-action-map.md",
      "docs/checklist-sequential-execution-log.md",
      "docs/core-smoke-runbook.md",
      "docs/data-migration-evidence-template.md",
      "docs/data-migration-readiness.md",
      "docs/release-readiness-decision.md",
      "docs/release-approval-exceptions.json",
      "docs/release-submission-package.md",
      "docs/hypercare-runbook.md",
      "docs/user-training-faq.md",
      "docs/cutover-runbook.md",
      "docs/deployment-operations.md",
      "docs/environment-separation-matrix-template.md",
      "docs/frontend-cache-revalidation-policy.md",
      "docs/frontend-hosting-policy.md",
      "docs/final-acceptance-evidence-template.md",
      "docs/go-live-handoff-template.md",
      "docs/incident-response.md",
      "docs/post-go-live-stabilization-evidence-template.md",
      "docs/production-go-live-evidence-template.md",
      "docs/production-environment-inventory-template.md",
      "docs/release-note-template.md",
      "docs/rollback-break-glass-runbook.md",
      "docs/role-uat-evidence-template.md",
      "docs/staging-smoke-evidence-template.md",
      "docs/test-automation.md",
      "docs/user-manual.md",
      "public/_headers",
      "src/domain/rolePolicy.ts",
      "scripts/generate-release-manifest.mjs",
      "scripts/run-core-smoke-check.mjs",
      "scripts/generate-go-live-readiness-report.mjs",
      "scripts/generate-release-submission.mjs",
      "scripts/generate-migration-review.mjs",
      "scripts/verify-release-manifest.mjs",
      "scripts/verify-migration-review.mjs",
      "scripts/verify-audit-append-only.mjs",
      "scripts/verify-backend-production-start.mjs",
      "scripts/verify-frontend-artifact.mjs",
      "scripts/verify-final-acceptance-evidence.mjs",
      "scripts/verify-migrations.mjs",
      "scripts/verify-release-env.mjs",
      "scripts/verify-role-uat-evidence.mjs",
      "scripts/sensitiveDataExposureScanner.mjs",
      "scripts/verify-sensitive-data-exposure.mjs",
      "scripts/mutationSafetyCatalog.mjs",
      "scripts/verify-mutation-safety.mjs",
      "scripts/verify-performance-capacity.mjs",
      "scripts/verify-operational-docs.mjs",
      "scripts/verify-backup-restore-evidence.mjs",
      "scripts/verify-data-migration-evidence.mjs",
      "scripts/verify-post-go-live-stabilization-evidence.mjs",
      "scripts/verify-production-go-live-evidence.mjs",
      "scripts/verify-production-environment-inventory.mjs",
      "scripts/verify-environment-separation.mjs",
      "scripts/verify-staging-smoke-evidence.mjs",
      "scripts/verify-go-live-handoff.mjs",
      "scripts/verify-release-note.mjs",
      "scripts/goLiveReadiness.mjs",
      "scripts/verify-go-live-readiness.mjs",
      "scripts/generate-db-test-evidence.mjs",
      "scripts/verify-db-test-evidence.mjs",
      "tests/unit/backendFileSecurity.test.ts",
      "tests/unit/fileRules.test.ts",
      "tests/unit/frontendFilePreview.test.ts",
      "tests/e2e/remote-auth-smoke.test.mjs",
      "tests/e2e/remote-ui-persistence.test.mjs",
      "tests/integration/backendDataPersistence.test.ts",
      "tests/integration/backendNotificationOperationsFlow.test.ts",
      "tests/integration/backendOperatingDataFlow.test.ts",
      "tests/integration/backendPaymentRequestFlow.test.ts",
      "tests/integration/backendSettingsPersistence.test.ts",
    ],
    required: true,
  },
];

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function walkFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  if (!stats.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const childPath = resolve(path, entry.name);
    if (entry.isDirectory()) return walkFiles(childPath);
    if (entry.isFile()) return [childPath];
    return [];
  });
}

function collectSectionFiles(projectRoot, section) {
  const files = [];
  const missing = [];

  for (const itemPath of section.paths) {
    const absolutePath = resolve(projectRoot, itemPath);
    if (!existsSync(absolutePath)) {
      missing.push(itemPath);
      continue;
    }
    files.push(...walkFiles(absolutePath));
  }

  if (section.required && missing.length > 0) {
    throw new Error(`Missing required release manifest path(s) for ${section.id}: ${missing.join(", ")}`);
  }

  return [...new Set(files)]
    .map((absolutePath) => {
      const content = readFileSync(absolutePath);
      return {
        path: normalizePath(relative(projectRoot, absolutePath)),
        bytes: content.byteLength,
        sha256: sha256(content),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function gitValue(projectRoot, args) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function gitMetadata(projectRoot) {
  const commit = gitValue(projectRoot, ["rev-parse", "HEAD"]);
  if (!commit) return null;
  return {
    commit,
    branch: gitValue(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: Boolean(gitValue(projectRoot, ["status", "--porcelain"])),
  };
}

export function buildReleaseManifest({
  projectRoot = process.cwd(),
  sections = defaultReleaseManifestSections,
  releaseTarget = process.env.RELEASE_TARGET || "local",
  releaseSourceRef = process.env.RELEASE_SOURCE_REF || process.env.GITHUB_REF_NAME || "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const root = resolve(projectRoot);
  const artifactSections = sections.map((section) => {
    const files = collectSectionFiles(root, section);
    if (section.required && files.length === 0) {
      throw new Error(`Release manifest section ${section.id} has no files.`);
    }
    return {
      id: section.id,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      sha256: sha256(Buffer.from(JSON.stringify(files), "utf8")),
      files,
    };
  });

  const git = gitMetadata(root);
  const sourceRef = releaseSourceRef || git?.branch || null;
  const stablePayload = {
    manifestVersion: 1,
    releaseTarget,
    sourceRef,
    artifacts: artifactSections.map((section) => ({
      id: section.id,
      fileCount: section.fileCount,
      totalBytes: section.totalBytes,
      sha256: section.sha256,
      files: section.files,
    })),
  };

  return {
    manifestVersion: stablePayload.manifestVersion,
    releaseTarget: stablePayload.releaseTarget,
    sourceRef: stablePayload.sourceRef,
    git,
    artifacts: stablePayload.artifacts,
    generatedAt,
    manifestSha256: sha256(Buffer.from(JSON.stringify(stablePayload), "utf8")),
  };
}

export function writeReleaseManifest(manifest, outputPath = process.env.RELEASE_MANIFEST_PATH || "release/release-manifest.json") {
  const resolvedOutput = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`);
  return resolvedOutput;
}

function parseOutputArg(args) {
  const index = args.indexOf("--output");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return process.env.RELEASE_MANIFEST_PATH || "release/release-manifest.json";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const outputPath = parseOutputArg(process.argv.slice(2));
    const manifest = buildReleaseManifest();
    const writtenPath = writeReleaseManifest(manifest, outputPath);
    console.log(`[release-manifest] PASS wrote ${normalizePath(relative(process.cwd(), writtenPath))}`);
    console.log(`[release-manifest] manifestSha256=${manifest.manifestSha256}`);
    for (const section of manifest.artifacts) {
      console.log(`[release-manifest] ${section.id}: ${section.fileCount} file(s), sha256=${section.sha256}`);
    }
  } catch (error) {
    console.error(`[release-manifest] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
