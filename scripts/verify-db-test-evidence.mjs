#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredHarnessFiles = [
  "tests/integration/backendDataPersistence.test.ts",
  "tests/integration/backendSettingsPersistence.test.ts",
  "tests/integration/backendPaymentRequestFlow.test.ts",
  "tests/integration/backendNotificationOperationsFlow.test.ts",
  "tests/integration/backendOperatingDataFlow.test.ts",
  "tests/e2e/remote-auth-smoke.test.mjs",
  "tests/e2e/remote-ui-persistence.test.mjs",
];

function env(name) {
  return (process.env[name] ?? "").trim();
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function guardTestDatabaseUrl(url) {
  const lower = url.toLowerCase();
  if (/(^|[/:@._-])prod(uction)?([/:@._-]|$)/.test(lower)) {
    return "ERP_TEST_DATABASE_URL must not point to a production database.";
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return "ERP_TEST_DATABASE_URL must use PostgreSQL.";
  }
  if (!lower.includes("test") && env("ERP_ALLOW_NON_TEST_DATABASE_URL") !== "true") {
    return "ERP_TEST_DATABASE_URL must look like a disposable test database, or set ERP_ALLOW_NON_TEST_DATABASE_URL=true explicitly.";
  }
  return "";
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { __readError: error instanceof Error ? error.message : String(error) };
  }
}

function requireDbEvidence() {
  if (isTruthy(env("REQUIRE_DB_TEST_EVIDENCE"))) return true;
  return ["release-tag", "production-candidate", "go-live"].includes(env("DB_TEST_EVIDENCE_TARGET").toLowerCase());
}

function read(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const issues = [];
const warnings = [];
const required = requireDbEvidence();
const databaseUrl = env("ERP_TEST_DATABASE_URL");
const evidenceResultPath = env("DB_TEST_EVIDENCE_RESULT_PATH") || "release/db-test-evidence.json";
const resolvedEvidenceResultPath = resolve(process.cwd(), evidenceResultPath);

for (const filePath of requiredHarnessFiles) {
  if (!existsSync(resolve(process.cwd(), filePath))) {
    issues.push(`Missing DB-backed test harness: ${filePath}`);
  }
}

const ciSource = existsSync(resolve(process.cwd(), ".github/workflows/ci.yml")) ? read(".github/workflows/ci.yml") : "";
if (!/Require DB Test Evidence[\s\S]*npm run release:db-test-evidence/.test(ciSource)) {
  issues.push("CI must require DB test evidence on version tag release candidates.");
}

if (!/remote mode browser login persists session/.test(read("tests/e2e/remote-auth-smoke.test.mjs"))) {
  issues.push("Remote auth E2E must verify browser login/session persistence against backend/test DB.");
}
if (!/remote mode browser vendor registration uploads evidence and persists after reload and second browser login/.test(read("tests/e2e/remote-ui-persistence.test.mjs"))) {
  issues.push("Remote UI E2E must verify browser CRUD/upload persistence across reload and second browser login against backend/test DB.");
}
if (!/remote mode browser favorites reports and settings changes persist after reload and second browser login/.test(read("tests/e2e/remote-ui-persistence.test.mjs"))) {
  issues.push("Remote UI E2E must verify screen-level favorites, reports, and settings persistence across reload and second browser login against backend/test DB.");
}
if (!/remote mode browser payment submission approval handoff and disbursement hold persist with DB evidence/.test(read("tests/e2e/remote-ui-persistence.test.mjs"))) {
  issues.push("Remote UI E2E must verify payment request submission, approval handoff, and disbursement hold persistence with DB evidence.");
}

if (!databaseUrl) {
  if (required) {
    issues.push("ERP_TEST_DATABASE_URL is required for DB-backed release evidence.");
  } else {
    warnings.push("ERP_TEST_DATABASE_URL is not configured; DB-backed integration and remote UI E2E will skip outside strict release evidence mode.");
  }
} else {
  const guardError = guardTestDatabaseUrl(databaseUrl);
  if (guardError) issues.push(guardError);
}

function validateDbTestEvidenceResult() {
  if (!existsSync(resolvedEvidenceResultPath)) {
    if (required) {
      issues.push(`DB test evidence result is required: ${evidenceResultPath}. Run npm run release:db-test-evidence-run with ERP_TEST_DATABASE_URL.`);
    } else {
      warnings.push(`DB test evidence result is not present: ${evidenceResultPath}.`);
    }
    return;
  }

  const evidence = readJson(resolvedEvidenceResultPath);
  if (evidence.__readError) {
    issues.push(`DB test evidence result is not valid JSON: ${evidence.__readError}`);
    return;
  }

  if (evidence.schemaVersion !== 1) issues.push("DB test evidence result schemaVersion must be 1.");
  if (evidence.ok !== true) issues.push("DB test evidence result ok must be true.");
  if (!Number.isFinite(Date.parse(evidence.generatedAt ?? ""))) issues.push("DB test evidence result generatedAt must be an ISO timestamp.");
  if (evidence.databaseUrlSafety !== "pass") issues.push("DB test evidence result must record databaseUrlSafety=pass.");
  if (!/^[a-f0-9]{64}$/i.test(evidence.databaseUrlFingerprint ?? "")) {
    issues.push("DB test evidence result must include a SHA-256 databaseUrlFingerprint.");
  }
  if (databaseUrl && evidence.databaseUrlFingerprint !== sha256(databaseUrl)) {
    issues.push("DB test evidence result databaseUrlFingerprint does not match the configured ERP_TEST_DATABASE_URL.");
  }

  const expectedReleaseVersion = env("EXPECTED_RELEASE_VERSION") || env("RELEASE_VERSION");
  const expectedSourceRef = env("EXPECTED_RELEASE_SOURCE_REF") || env("RELEASE_SOURCE_REF");
  const expectedGitCommit = env("EXPECTED_RELEASE_GIT_COMMIT") || env("RELEASE_GIT_COMMIT");
  if (expectedReleaseVersion && evidence.releaseVersion !== expectedReleaseVersion) {
    issues.push(`DB test evidence releaseVersion mismatch: expected ${expectedReleaseVersion}, recorded ${evidence.releaseVersion ?? "none"}.`);
  }
  if (expectedSourceRef && evidence.sourceRef !== expectedSourceRef) {
    issues.push(`DB test evidence sourceRef mismatch: expected ${expectedSourceRef}, recorded ${evidence.sourceRef ?? "none"}.`);
  }
  if (expectedGitCommit && evidence.gitCommit !== expectedGitCommit) {
    issues.push(`DB test evidence gitCommit mismatch: expected ${expectedGitCommit}, recorded ${evidence.gitCommit ?? "none"}.`);
  }

  const evidenceHarness = new Map(Array.isArray(evidence.harnessFiles) ? evidence.harnessFiles.map((item) => [item.path, item]) : []);
  for (const filePath of requiredHarnessFiles) {
    const recorded = evidenceHarness.get(filePath);
    if (!recorded) {
      issues.push(`DB test evidence result is missing harness checksum for ${filePath}.`);
      continue;
    }
    if (!existsSync(resolve(process.cwd(), filePath))) continue;
    const currentSha256 = sha256(readFileSync(resolve(process.cwd(), filePath)));
    if (recorded.sha256 !== currentSha256) {
      issues.push(`DB test evidence result is stale for ${filePath}.`);
    }
  }

  const commandResults = new Map(Array.isArray(evidence.commands) ? evidence.commands.map((item) => [item.id, item]) : []);
  for (const commandId of ["db-integration", "remote-auth-e2e", "remote-ui-persistence-e2e"]) {
    const command = commandResults.get(commandId);
    if (!command) {
      issues.push(`DB test evidence result is missing command result ${commandId}.`);
      continue;
    }
    if (command.ok !== true || command.status !== 0) {
      issues.push(`DB test evidence command ${commandId} did not pass.`);
    }
    if (command.skipped) {
      issues.push(`DB test evidence command ${commandId} reported skipped tests.`);
    }
    if (Array.isArray(command.missingRequiredOutput) && command.missingRequiredOutput.length > 0) {
      issues.push(`DB test evidence command ${commandId} missed required output: ${command.missingRequiredOutput.join(", ")}`);
    }
  }
}

validateDbTestEvidenceResult();

console.log(`[db-test-evidence] mode=${required ? "required" : "audit"}`);
console.log(`[db-test-evidence] harnessFiles=${requiredHarnessFiles.length}`);
console.log(`[db-test-evidence] resultPath=${evidenceResultPath}`);
if (databaseUrl) console.log("[db-test-evidence] ERP_TEST_DATABASE_URL is configured and passes safety checks.");
for (const warning of warnings) console.log(`[db-test-evidence] WARN ${warning}`);

if (issues.length > 0) {
  console.error(`[db-test-evidence] FAIL ${issues.length} issue(s) found.`);
  for (const issue of issues) console.error(`[db-test-evidence] - ${issue}`);
  process.exit(1);
}

console.log("[db-test-evidence] PASS DB-backed test evidence gate is satisfied.");
