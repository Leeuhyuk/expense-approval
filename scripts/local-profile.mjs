#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDataRoot = resolve(projectRoot, ".local-data", "staging");
const databaseRoot = process.platform === "win32" && process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "expense-approval-erp-staging")
  : resolve(localDataRoot, "database-runtime");
const manifestPath = resolve(projectRoot, "release", "release-manifest.json");
const buildIdentityPath = resolve(localDataRoot, "build-identity.json");
const npmCliPath = process.env.npm_execpath || resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

export const localStagingProfile = {
  name: "staging-local",
  frontendPort: 3100,
  backendPort: 4410,
  controlPort: 4409,
  databasePort: 55442,
  dataRoot: localDataRoot,
  databaseRoot,
  databaseDir: resolve(databaseRoot, "postgres"),
  fileStorageDir: resolve(databaseRoot, "files"),
  runtimeStatePath: resolve(localDataRoot, "runtime.json"),
  backupRoot: resolve(databaseRoot, "backups"),
  buildIdentityPath,
};

function profileEnv(extra = {}) {
  return {
    ...process.env,
    ERP_LOCAL_PROFILE: localStagingProfile.name,
    ERP_LOCAL_DATA_DIR: localStagingProfile.dataRoot,
    ERP_LOCAL_DATABASE_ROOT: localStagingProfile.databaseRoot,
    ERP_LOCAL_DATABASE_DIR: localStagingProfile.databaseDir,
    ERP_LOCAL_FILE_STORAGE_DIR: localStagingProfile.fileStorageDir,
    ERP_LOCAL_RUNTIME_STATE_PATH: localStagingProfile.runtimeStatePath,
    ERP_LOCAL_BACKUP_DIR: localStagingProfile.backupRoot,
    ERP_LOCAL_FRONTEND_PORT: String(localStagingProfile.frontendPort),
    ERP_LOCAL_BACKEND_PORT: String(localStagingProfile.backendPort),
    ERP_LOCAL_CONTROL_PORT: String(localStagingProfile.controlPort),
    ERP_LOCAL_DATABASE_PORT: String(localStagingProfile.databasePort),
    ERP_LOCAL_DATABASE_NAME: "payment_approval_erp_staging",
    ERP_LOCAL_DATABASE_USER: "erp_staging_local",
    ERP_LOCAL_DATABASE_PASSWORD: "erp_staging_local_only",
    ERP_LOCAL_USE_BUILD_ARTIFACT: "true",
    ERP_LOCAL_NODE_ENV: "development",
    CSRF_SECRET: "staging-local-csrf-secret-payment-approval-erp",
    FILE_URL_SECRET: "staging-local-file-url-secret-payment-approval-erp",
    BANK_ACCOUNT_SECRET: "staging-local-bank-account-secret-payment-approval-erp",
    RATE_LIMIT_DISABLED: "false",
    REPORT_JOB_WORKER_ENABLED: "false",
    DATA_QUALITY_JOB_ENABLED: "false",
    ...extra,
  };
}

function runStep(label, command, args, env = profileEnv()) {
  console.log(`[staging-local] ${label}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} 실패 (exit=${result.status ?? "unknown"})`);
}

function gitValue(args) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || "Git release identity 조회 실패").trim());
  return result.stdout.trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function prepare() {
  const dirtyFiles = gitValue(["status", "--porcelain"]);
  if (dirtyFiles) throw new Error("staging artifact는 clean Git commit에서만 준비할 수 있습니다. 변경을 커밋한 뒤 다시 실행하세요.");
  const commit = gitValue(["rev-parse", "HEAD"]);
  const sourceRef = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const releaseVersion = commit;
  const buildEnv = profileEnv({
    VITE_ERP_API_MODE: "remote",
    VITE_ERP_API_BASE_URL: "/api",
    VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${localStagingProfile.backendPort}`,
    VITE_RELEASE_VERSION: releaseVersion,
    VITE_RELEASE_SOURCE_REF: sourceRef,
    VITE_RELEASE_GIT_COMMIT: commit,
  });

  runStep("frontend production artifact build", process.execPath, [npmCliPath, "run", "build"], buildEnv);
  runStep("backend production artifact build", process.execPath, [npmCliPath, "--prefix", "backend", "run", "build"], buildEnv);
  runStep("release manifest 생성", process.execPath, [npmCliPath, "run", "release:manifest"], buildEnv);
  runStep("release manifest 검증", process.execPath, [npmCliPath, "run", "release:verify-manifest"], buildEnv);

  const manifest = await readJson(manifestPath);
  if (manifest.git?.dirty !== false || manifest.git?.commit !== commit || manifest.sourceRef !== sourceRef) {
    throw new Error("release manifest가 clean staging source identity와 일치하지 않습니다.");
  }
  const identity = {
    profile: localStagingProfile.name,
    releaseVersion,
    sourceRef,
    gitCommit: commit,
    manifestSha256: manifest.manifestSha256,
    frontendArtifactSha256: manifest.artifacts.find((item) => item.id === "frontend")?.sha256 ?? null,
    backendArtifactSha256: manifest.artifacts.find((item) => item.id === "backend")?.sha256 ?? null,
    preparedAt: new Date().toISOString(),
  };
  await mkdir(localDataRoot, { recursive: true });
  await writeFile(buildIdentityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  console.log(`[staging-local] prepare 완료 manifest=${identity.manifestSha256}`);
}

async function verifiedArtifactEnv() {
  runStep("고정 artifact checksum 검증", process.execPath, [npmCliPath, "run", "release:verify-manifest"]);
  const [manifest, identity] = await Promise.all([readJson(manifestPath), readJson(buildIdentityPath)]);
  if (
    identity.profile !== localStagingProfile.name ||
    identity.manifestSha256 !== manifest.manifestSha256 ||
    identity.gitCommit !== manifest.git?.commit ||
    identity.sourceRef !== manifest.sourceRef ||
    manifest.git?.dirty !== false
  ) {
    throw new Error("staging build identity가 현재 release manifest와 다릅니다. npm run local:staging:prepare를 다시 실행하세요.");
  }
  return profileEnv({
    RELEASE_VERSION: identity.releaseVersion,
    RELEASE_SOURCE_REF: identity.sourceRef,
    RELEASE_GIT_COMMIT: identity.gitCommit,
    RELEASE_MANIFEST_SHA256: identity.manifestSha256,
    VITE_RELEASE_VERSION: identity.releaseVersion,
    VITE_RELEASE_SOURCE_REF: identity.sourceRef,
    VITE_RELEASE_GIT_COMMIT: identity.gitCommit,
    VITE_ERP_API_MODE: "remote",
    VITE_ERP_API_BASE_URL: "/api",
    VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${localStagingProfile.backendPort}`,
  });
}

async function runNodeScript(script, args = [], env = profileEnv()) {
  const child = spawn(process.execPath, [resolve(projectRoot, script), ...args], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

async function main() {
  const profile = process.argv[2];
  const command = process.argv[3] ?? "status";
  const trailingArgs = process.argv.slice(4);
  if (profile !== "staging") throw new Error("지원 프로필: staging");
  if (command === "prepare") return prepare();
  if (command === "start") return runNodeScript("scripts/start-local.mjs", [], await verifiedArtifactEnv());
  if (command === "status") return runNodeScript("scripts/local-status.mjs", [], profileEnv());
  if (command === "stop") return runNodeScript("scripts/stop-local.mjs", [], profileEnv());
  if (command === "smoke") return runNodeScript("scripts/verify-local-staging.mjs", [], await verifiedArtifactEnv());
  if (command === "backup") return runNodeScript("scripts/local-backup.mjs", ["create"], profileEnv());
  if (command === "backups") return runNodeScript("scripts/local-backup.mjs", ["list"], profileEnv());
  if (command === "restore") return runNodeScript("scripts/local-backup.mjs", ["restore", ...trailingArgs], profileEnv());
  throw new Error(`알 수 없는 staging 명령: ${command}`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[staging-local] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
