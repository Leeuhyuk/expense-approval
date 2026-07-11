#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultOutputPath = "release/db-test-evidence.json";
const requiredHarnessFiles = [
  "tests/integration/backendDataPersistence.test.ts",
  "tests/integration/backendListQueryConsistency.test.ts",
  "tests/integration/backendSettingsPersistence.test.ts",
  "tests/integration/backendPaymentRequestFlow.test.ts",
  "tests/integration/backendNotificationOperationsFlow.test.ts",
  "tests/integration/backendOperatingDataFlow.test.ts",
  "tests/e2e/remote-auth-smoke.test.mjs",
  "tests/e2e/remote-ui-persistence.test.mjs",
];

const commands = [
  {
    id: "db-integration",
    command: "npm",
    args: ["run", "test:integration"],
    requiredOutputPatterns: [
      "persists vendor creation across refresh and a second login",
      "keeps server search filters sorting and pagination consistent with DB results",
      "persists role and user permission changes across refresh and a second login",
      "persists master data, draft creation, file upload, submit, and approval steps in the DB",
      "keeps notification reads idempotent and business failure owner notifications de-duplicated",
      "persists budget adjustments, reports, schedules, and favorites with DB/audit evidence",
    ],
  },
  {
    id: "remote-auth-e2e",
    command: "node",
    args: ["--test", "tests/e2e/remote-auth-smoke.test.mjs"],
    requiredOutputPatterns: ["remote mode browser login persists session and logs out against backend/test DB"],
  },
  {
    id: "remote-ui-persistence-e2e",
    command: "node",
    args: ["--test", "tests/e2e/remote-ui-persistence.test.mjs"],
    requiredOutputPatterns: [
      "remote mode browser vendor registration uploads evidence and persists after reload and second browser login",
      "remote mode browser favorites reports and settings changes persist after reload and second browser login",
      "remote mode browser payment submission approval handoff and disbursement hold persist with DB evidence",
    ],
  },
];

function env(name) {
  return (process.env[name] ?? "").trim();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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

function harnessHashes(projectRoot) {
  return requiredHarnessFiles.map((path) => {
    const resolved = resolve(projectRoot, path);
    if (!existsSync(resolved)) throw new Error(`Missing DB-backed test harness: ${path}`);
    return {
      path,
      sha256: sha256(readFileSync(resolved)),
    };
  });
}

function spawnCommand(commandSpec, projectRoot) {
  const startedAt = Date.now();
  const executable = process.platform === "win32" && commandSpec.command === "npm" ? "cmd.exe" : commandSpec.command;
  const args = process.platform === "win32" && commandSpec.command === "npm"
    ? ["/d", "/s", "/c", ["npm", ...commandSpec.args].join(" ")]
    : commandSpec.args;
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const missingRequiredOutput = commandSpec.requiredOutputPatterns.filter((pattern) => !output.includes(pattern));
  const skipped = /\bskipped\s+[1-9]\d*\b|\bskip\b/i.test(output);

  return {
    id: commandSpec.id,
    command: [commandSpec.command, ...commandSpec.args].join(" "),
    status: result.status ?? 1,
    signal: result.signal ?? null,
    durationMs: Date.now() - startedAt,
    ok: result.status === 0 && missingRequiredOutput.length === 0 && !skipped,
    missingRequiredOutput,
    skipped,
    stdoutTail: (result.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(-40),
    stderrTail: (result.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-40),
  };
}

export function buildDbTestEvidence({
  projectRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  runCommands = true,
} = {}) {
  const databaseUrl = env("ERP_TEST_DATABASE_URL");
  if (!databaseUrl) throw new Error("ERP_TEST_DATABASE_URL is required to generate DB-backed test evidence.");
  const guardError = guardTestDatabaseUrl(databaseUrl);
  if (guardError) throw new Error(guardError);

  const commandResults = runCommands ? commands.map((command) => spawnCommand(command, projectRoot)) : [];
  return {
    schemaVersion: 1,
    generatedAt,
    releaseVersion: env("RELEASE_VERSION") || env("GITHUB_SHA") || "local",
    sourceRef: env("RELEASE_SOURCE_REF") || env("GITHUB_REF_NAME") || "local",
    gitCommit: env("RELEASE_GIT_COMMIT") || env("GITHUB_SHA") || "local",
    databaseUrlFingerprint: sha256(databaseUrl),
    databaseUrlSafety: "pass",
    harnessFiles: harnessHashes(projectRoot),
    commands: commandResults,
    ok: commandResults.length > 0 && commandResults.every((command) => command.ok),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outputPath = process.env.DB_TEST_EVIDENCE_RESULT_PATH || defaultOutputPath;
  try {
    const projectRoot = process.cwd();
    const evidence = buildDbTestEvidence({ projectRoot });
    const resolvedOutput = resolve(projectRoot, outputPath);
    mkdirSync(dirname(resolvedOutput), { recursive: true });
    writeFileSync(resolvedOutput, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`[db-test-evidence-run] wrote ${relative(projectRoot, resolvedOutput).replaceAll("\\", "/")}`);
    console.log(`[db-test-evidence-run] commands=${evidence.commands.length} ok=${evidence.ok}`);
    if (!evidence.ok) {
      for (const command of evidence.commands.filter((item) => !item.ok)) {
        console.error(`[db-test-evidence-run] FAIL ${command.id} status=${command.status} skipped=${command.skipped}`);
        for (const line of command.stderrTail) console.error(`[db-test-evidence-run] ${line}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(`[db-test-evidence-run] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
