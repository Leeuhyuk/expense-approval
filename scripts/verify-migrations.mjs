#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { evaluateMigrationDirectory } from "./migrationGuard.mjs";

const prismaCliPath = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const requireShadowDatabaseUrl = ["1", "true", "yes", "on"].includes((process.env.REQUIRE_SHADOW_DATABASE_URL ?? "").trim().toLowerCase());

function runNodeScript(scriptPath, args, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    ...options,
  });
  return result;
}

const evaluation = evaluateMigrationDirectory();

for (const warning of evaluation.warnings) {
  console.log(`[migration-check][WARN] ${warning.migration ?? "global"} ${warning.ruleId}: ${warning.message}`);
}

if (evaluation.issues.length > 0) {
  console.error(`[migration-check] FAIL static migration guard found ${evaluation.issues.length} issue(s).`);
  for (const issue of evaluation.issues) {
    console.error(`[migration-check] ${issue.migration ?? "global"} ${issue.ruleId}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`[migration-check] PASS static migration guard checked ${evaluation.checkedMigrations.length} migration(s).`);

const validateResult = runNodeScript(prismaCliPath, ["validate", "--schema", "prisma/schema.prisma"], {
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://migration:migration@example.com:5432/payment_approval_erp?schema=public",
  },
});
if (validateResult.status !== 0) {
  console.error("[migration-check] FAIL prisma validate failed.");
  if (validateResult.error) console.error(validateResult.error.message);
  if (validateResult.stdout) console.error(validateResult.stdout.trim());
  if (validateResult.stderr) console.error(validateResult.stderr.trim());
  process.exit(validateResult.status ?? 1);
}
console.log("[migration-check] PASS prisma schema validate.");

if (process.env.SHADOW_DATABASE_URL) {
  const diffResult = runNodeScript(prismaCliPath, [
    "migrate",
    "diff",
    "--from-empty",
    "--to-migrations",
    "prisma/migrations",
    "--shadow-database-url",
    process.env.SHADOW_DATABASE_URL,
    "--script",
  ]);
  if (diffResult.status !== 0) {
    console.error("[migration-check] FAIL migration diff dry-run failed.");
    if (diffResult.error) console.error(diffResult.error.message);
    if (diffResult.stdout) console.error(diffResult.stdout.trim());
    if (diffResult.stderr) console.error(diffResult.stderr.trim());
    process.exit(diffResult.status ?? 1);
  }
  console.log("[migration-check] PASS migration diff dry-run with SHADOW_DATABASE_URL.");
} else if (requireShadowDatabaseUrl) {
  console.error("[migration-check] FAIL SHADOW_DATABASE_URL is required when REQUIRE_SHADOW_DATABASE_URL=true.");
  process.exit(1);
} else {
  console.log("[migration-check][WARN] SHADOW_DATABASE_URL is not set; skipped Prisma migration diff dry-run.");
}
