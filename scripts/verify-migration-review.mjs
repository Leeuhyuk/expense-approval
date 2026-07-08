#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMigrationReview } from "./generate-migration-review.mjs";

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function env(name) {
  return (process.env[name] ?? "").trim();
}

function parseReviewArg(args) {
  const index = args.indexOf("--review");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return env("RELEASE_MIGRATION_REVIEW_PATH") || "release/migration-review.json";
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Migration review does not exist: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Migration review is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function verifyMigrationReview({
  projectRoot = process.cwd(),
  reviewPath = env("RELEASE_MIGRATION_REVIEW_PATH") || "release/migration-review.json",
  expectedReviewSha256 = env("EXPECTED_MIGRATION_REVIEW_SHA256"),
  expectedReleaseVersion = env("EXPECTED_RELEASE_VERSION") || env("EXPECTED_RELEASE_GIT_COMMIT"),
} = {}) {
  const root = resolve(projectRoot);
  const resolvedReviewPath = resolve(root, reviewPath);
  const recorded = readJson(resolvedReviewPath);
  const current = buildMigrationReview({
    projectRoot: root,
    releaseTarget: recorded.releaseTarget || env("RELEASE_TARGET") || "local",
    releaseVersion: recorded.releaseVersion || env("RELEASE_VERSION") || env("GITHUB_SHA") || "local",
    generatedAt: recorded.generatedAt || new Date().toISOString(),
  });
  const errors = [];

  if (expectedReviewSha256 && recorded.reviewSha256 !== expectedReviewSha256) {
    errors.push(`EXPECTED_MIGRATION_REVIEW_SHA256 mismatch: expected ${expectedReviewSha256}, recorded ${recorded.reviewSha256}.`);
  }

  if (expectedReleaseVersion && recorded.releaseVersion !== expectedReleaseVersion) {
    errors.push(`EXPECTED_RELEASE_VERSION mismatch: expected ${expectedReleaseVersion}, recorded ${recorded.releaseVersion ?? "none"}.`);
  }

  if (recorded.reviewSha256 !== current.reviewSha256) {
    errors.push(`reviewSha256 changed: recorded ${recorded.reviewSha256}, current ${current.reviewSha256}.`);
  }

  if (recorded.ok !== true || Array.isArray(recorded.issues) && recorded.issues.length > 0) {
    errors.push("Migration review must have ok=true and no open issues before release approval.");
  }

  if (recorded.approvalPolicy?.backwardCompatibility !== "pass") {
    errors.push("Migration review approvalPolicy.backwardCompatibility must be pass.");
  }

  if (!String(recorded.approvalPolicy?.rollbackReview ?? "").includes("manual approval required")) {
    errors.push("Migration review approvalPolicy.rollbackReview must require manual rollback approval before production deploy.");
  }

  if (recorded.approvalPolicy?.productionSeedExecution !== "blocked" || recorded.seedPolicy?.status !== "pass") {
    errors.push("Migration review must prove production seed execution is blocked.");
  }

  if (!Array.isArray(recorded.migrations)) {
    errors.push("Migration review migrations must be an array.");
  } else {
    for (const migration of recorded.migrations) {
      if (!migration.sqlSha256) errors.push(`${migration.id ?? "unknown migration"} is missing sqlSha256.`);
      if (!migration.rollbackImpact || !/PITR|compensating migration|DBA-approved/i.test(migration.rollbackImpact)) {
        errors.push(`${migration.id ?? "unknown migration"} is missing rollback impact guidance.`);
      }
      if (migration.compatibility !== "passed-static-backward-compatibility-guard") {
        errors.push(`${migration.id ?? "unknown migration"} did not pass the static backward compatibility guard.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    reviewPath: resolvedReviewPath,
    recorded,
    current,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const reviewPath = parseReviewArg(process.argv.slice(2));
    const result = verifyMigrationReview({ reviewPath });
    if (!result.ok) {
      for (const error of result.errors) {
        console.error(`[migration-review-check] FAIL ${error}`);
      }
      process.exit(1);
    }

    console.log(`[migration-review-check] PASS verified ${normalizePath(relative(process.cwd(), result.reviewPath))}`);
    console.log(`[migration-review-check] reviewSha256=${result.recorded.reviewSha256}`);
  } catch (error) {
    console.error(`[migration-review-check] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
