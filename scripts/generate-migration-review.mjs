#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateMigrationDirectory } from "./migrationGuard.mjs";

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function migrationDirectories(projectRoot, migrationsDir) {
  const resolved = resolve(projectRoot, migrationsDir);
  if (!existsSync(resolved)) return [];
  return readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sqlStatements(sql) {
  return stripSqlComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function detectOperations(sql) {
  const normalized = stripSqlComments(sql);
  const rules = [
    ["create-type", /\bCREATE\s+TYPE\b/i],
    ["create-table", /\bCREATE\s+TABLE\b/i],
    ["alter-table", /\bALTER\s+TABLE\b/i],
    ["add-column", /\bADD\s+COLUMN\b/i],
    ["create-index", /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i],
    ["foreign-key", /\bFOREIGN\s+KEY\b/i],
    ["create-trigger", /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i],
    ["create-function", /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i],
    ["comment", /\bCOMMENT\s+ON\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(normalized)).map(([id]) => id);
}

function migrationIssueMap(issues) {
  const map = new Map();
  for (const issue of issues) {
    const key = issue.migration ?? "global";
    const list = map.get(key) ?? [];
    list.push(issue);
    map.set(key, list);
  }
  return map;
}

function seedPolicy(projectRoot) {
  const seedSource = readIfExists(resolve(projectRoot, "prisma/seed.ts"));
  const seedSafetySource = readIfExists(resolve(projectRoot, "prisma/seedSafety.ts"));
  const releaseGateSource = readIfExists(resolve(projectRoot, "scripts/verify-release-env.mjs"));
  const productionSeedGuard = /\bassertSeedAllowed\(\)/.test(seedSource) && /NODE_ENV/.test(seedSafetySource) && /RELEASE_TARGET/.test(seedSafetySource);
  const releaseGateBlocksOverride = /ALLOW_PRODUCTION_SEED/.test(releaseGateSource) && /\bfail\(/.test(releaseGateSource);

  return {
    productionSeedGuard,
    releaseGateBlocksOverride,
    status: productionSeedGuard && releaseGateBlocksOverride ? "pass" : "fail",
    statement:
      productionSeedGuard && releaseGateBlocksOverride
        ? "Production-like seed execution is blocked by prisma/seedSafety.ts and release gate forbids ALLOW_PRODUCTION_SEED."
        : "Production-like seed execution guard or release gate evidence is missing.",
  };
}

export function buildMigrationReview({
  projectRoot = process.cwd(),
  migrationsDir = "prisma/migrations",
  schemaPath = "prisma/schema.prisma",
  releaseTarget = process.env.RELEASE_TARGET || "local",
  releaseVersion = process.env.RELEASE_VERSION || process.env.GITHUB_SHA || "local",
  generatedAt = new Date().toISOString(),
} = {}) {
  const root = resolve(projectRoot);
  const evaluation = evaluateMigrationDirectory({ projectRoot: root, schemaPath, migrationsDir });
  const issuesByMigration = migrationIssueMap(evaluation.issues);
  const migrations = migrationDirectories(root, migrationsDir).map((migrationId) => {
    const sqlPath = resolve(root, migrationsDir, migrationId, "migration.sql");
    const sql = readIfExists(sqlPath);
    const issues = issuesByMigration.get(migrationId) ?? [];
    const operations = detectOperations(sql);
    return {
      id: migrationId,
      path: normalizePath(relative(root, sqlPath)),
      sqlSha256: sql ? sha256(sql) : null,
      statementCount: sql ? sqlStatements(sql).length : 0,
      operations,
      compatibility: issues.length === 0 ? "passed-static-backward-compatibility-guard" : "blocked-by-risky-migration-rule",
      rollbackImpact:
        issues.length === 0
          ? "Forward-only Prisma migration. Production rollback requires approved backup/PITR restore or a separately reviewed compensating migration."
          : "Blocked until migration risk is removed or an explicit DBA-approved rollback plan is attached.",
      issues,
    };
  });

  const seed = seedPolicy(root);
  const summaryIssues = [...evaluation.issues];
  if (seed.status !== "pass") {
    summaryIssues.push({ ruleId: "seed-policy", message: seed.statement });
  }

  const stablePayload = {
    reviewVersion: 1,
    releaseTarget,
    releaseVersion,
    migrationCount: evaluation.checkedMigrations.length,
    migrations,
    warnings: evaluation.warnings,
    issues: summaryIssues,
    seedPolicy: seed,
    approvalPolicy: {
      backwardCompatibility: summaryIssues.length === 0 ? "pass" : "fail",
      rollbackReview: "manual approval required before production migration deploy",
      productionSeedExecution: seed.status === "pass" ? "blocked" : "unverified",
    },
  };

  return {
    ...stablePayload,
    generatedAt,
    reviewSha256: sha256(JSON.stringify(stablePayload)),
    ok: summaryIssues.length === 0,
  };
}

export function writeMigrationReview(review, outputPath = process.env.RELEASE_MIGRATION_REVIEW_PATH || "release/migration-review.json") {
  const resolvedOutput = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(review, null, 2)}\n`);
  return resolvedOutput;
}

function parseOutputArg(args) {
  const index = args.indexOf("--output");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return process.env.RELEASE_MIGRATION_REVIEW_PATH || "release/migration-review.json";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const outputPath = parseOutputArg(process.argv.slice(2));
    const review = buildMigrationReview();
    const writtenPath = writeMigrationReview(review, outputPath);
    if (!review.ok) {
      console.error(`[migration-review] FAIL wrote ${normalizePath(relative(process.cwd(), writtenPath))} with ${review.issues.length} issue(s).`);
      for (const issue of review.issues) {
        console.error(`[migration-review] ${issue.migration ?? "global"} ${issue.ruleId}: ${issue.message}`);
      }
      process.exit(1);
    }

    console.log(`[migration-review] PASS wrote ${normalizePath(relative(process.cwd(), writtenPath))}`);
    console.log(`[migration-review] reviewSha256=${review.reviewSha256}`);
    console.log(`[migration-review] migrations=${review.migrationCount}, seedPolicy=${review.seedPolicy.status}`);
  } catch (error) {
    console.error(`[migration-review] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
