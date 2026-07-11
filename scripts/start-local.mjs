#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalPostgres } from "./local-postgres.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.env.ERP_LOCAL_PROFILE?.trim() || "live";
const localDataRoot = process.env.ERP_LOCAL_DATA_DIR
  ? resolve(process.env.ERP_LOCAL_DATA_DIR)
  : resolve(projectRoot, ".local-data");
const defaultDatabaseRoot = process.env.ERP_LOCAL_DATABASE_ROOT
  ? resolve(process.env.ERP_LOCAL_DATABASE_ROOT)
  : process.platform === "win32" && process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "expense-approval-erp")
    : localDataRoot;
const databaseDir = process.env.ERP_LOCAL_DATABASE_DIR
  ? resolve(process.env.ERP_LOCAL_DATABASE_DIR)
  : resolve(defaultDatabaseRoot, "postgres");
const fileStorageDir = process.env.ERP_LOCAL_FILE_STORAGE_DIR
  ? resolve(process.env.ERP_LOCAL_FILE_STORAGE_DIR)
  : resolve(localDataRoot, "files");
const runtimeStatePath = process.env.ERP_LOCAL_RUNTIME_STATE_PATH
  ? resolve(process.env.ERP_LOCAL_RUNTIME_STATE_PATH)
  : resolve(localDataRoot, "runtime.json");
const databaseName = process.env.ERP_LOCAL_DATABASE_NAME?.trim() || "payment_approval_erp";
const databaseUser = process.env.ERP_LOCAL_DATABASE_USER?.trim() || "erp_local";
const databasePassword = process.env.ERP_LOCAL_DATABASE_PASSWORD || "erp_local_only";
const databasePort = Number(process.env.ERP_LOCAL_DATABASE_PORT ?? 55432);
const backendPort = Number(process.env.ERP_LOCAL_BACKEND_PORT ?? 4310);
const controlPort = Number(process.env.ERP_LOCAL_CONTROL_PORT ?? 4309);
const frontendPort = Number(process.env.ERP_LOCAL_FRONTEND_PORT ?? 3000);
const useBuildArtifact = process.env.ERP_LOCAL_USE_BUILD_ARTIFACT === "true";
const controlToken = randomUUID();
const databaseUrl = `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}?schema=public`;
const children = new Set();
let postgres;
let controlServer;
let shuttingDown = false;

function log(message) {
  console.log(`[local:${profile}] ${message}`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeState() {
  try {
    return JSON.parse(await readFile(runtimeStatePath, "utf8"));
  } catch {
    return null;
  }
}

async function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolvePort(true));
    });
  });
}

async function assertPortAvailable(port, label) {
  if (!(await portAvailable(port))) {
    throw new Error(`${label} 포트 ${port}가 이미 사용 중입니다. npm run local:status로 실행 상태를 확인하세요.`);
  }
}

function nodeCommand(relativeScript, args = [], options = {}) {
  return spawn(process.execPath, [resolve(projectRoot, relativeScript), ...args], {
    cwd: projectRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  });
}

async function runNodeStep(label, relativeScript, args, env) {
  log(label);
  const child = nodeCommand(relativeScript, args, { env });
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (exitCode, signal) => {
      if (signal) rejectExit(new Error(`${label} 단계가 ${signal} 신호로 종료되었습니다.`));
      else resolveExit(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${label} 단계가 종료 코드 ${code}로 실패했습니다.`);
}

async function waitForHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "응답 없음";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(`상태 확인 시간 초과: ${url} (${lastError})`);
}

async function prismaClientMatchesSchema() {
  try {
    const [sourceSchema, generatedSchema, generatedEngine] = await Promise.all([
      stat(resolve(projectRoot, "prisma/schema.prisma")),
      stat(resolve(projectRoot, "backend/generated/prisma/schema.prisma")),
      stat(resolve(projectRoot, "backend/generated/prisma/index.js")),
    ]);
    return generatedSchema.mtimeMs >= sourceSchema.mtimeMs && generatedEngine.size > 0;
  } catch {
    return false;
  }
}

async function ensureApplicationDatabase() {
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const result = await client.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (result.rowCount === 0) {
      await client.query(`create database ${databaseName}`);
      return true;
    }
    return false;
  } finally {
    await client.end();
  }
}

async function databaseNeedsSeed() {
  const client = postgres.getPgClient(databaseName, "127.0.0.1");
  await client.connect();
  try {
    const table = await client.query("select to_regclass('public.users') as table_name");
    if (!table.rows[0]?.table_name) return true;
    const result = await client.query("select count(*)::int as count from users");
    return Number(result.rows[0]?.count ?? 0) === 0;
  } finally {
    await client.end();
  }
}

function startService(label, relativeScript, args, env) {
  log(`${label} 시작`);
  const child = nodeCommand(relativeScript, args, { env });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[local] ${label}가 예기치 않게 종료되었습니다. code=${code ?? "none"} signal=${signal ?? "none"}`);
      void shutdown(1);
    }
  });
  child.once("error", (error) => {
    console.error(`[local] ${label} 시작 실패: ${error.message}`);
    void shutdown(1);
  });
  return child;
}

async function startControlServer() {
  controlServer = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url === "/shutdown" &&
      request.headers.authorization === `Bearer ${controlToken}`
    ) {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      setTimeout(() => void shutdown(0), 25).unref();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    controlServer.once("error", rejectListen);
    controlServer.listen(controlPort, "127.0.0.1", resolveListen);
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("로컬 시스템 종료 중");
  if (controlServer) {
    const server = controlServer;
    controlServer = undefined;
    await new Promise((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
  }
  for (const child of children) child.kill();
  children.clear();
  if (postgres) await postgres.stop().catch(() => undefined);
  await rm(runtimeStatePath, { force: true }).catch(() => undefined);
  process.exitCode = exitCode;
}

async function main() {
  const currentState = await readRuntimeState();
  if (currentState && isProcessAlive(Number(currentState.pid))) {
    log(`이미 실행 중입니다: http://127.0.0.1:${frontendPort}`);
    return;
  }

  await mkdir(localDataRoot, { recursive: true });
  await mkdir(fileStorageDir, { recursive: true });
  await rm(runtimeStatePath, { force: true }).catch(() => undefined);
  await assertPortAvailable(frontendPort, "프런트엔드");
  await assertPortAvailable(backendPort, "백엔드");
  await assertPortAvailable(controlPort, "로컬 종료 제어");
  await assertPortAvailable(databasePort, "데이터베이스");

  postgres = await createLocalPostgres({
    runtimeRoot: resolve(defaultDatabaseRoot, "runtime"),
    databaseDir,
    user: databaseUser,
    password: databasePassword,
    port: databasePort,
    onLog: (message) => {
      if (/ready to accept connections|database system is shut down/i.test(String(message))) {
        log(String(message).trim());
      }
    },
    onError: (error) => console.error(`[local:postgres] ${error instanceof Error ? error.message : String(error)}`),
  });

  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) {
    log("내장 PostgreSQL 최초 초기화");
    await postgres.initialise();
  }
  log(`내장 PostgreSQL 시작 (${databasePort})`);
  await postgres.start();
  const databaseCreated = await ensureApplicationDatabase();

  const sharedEnv = {
    ...process.env,
    NODE_ENV: process.env.ERP_LOCAL_NODE_ENV ?? "development",
    DATABASE_URL: databaseUrl,
    ERP_TEST_DATABASE_URL: databaseUrl,
    HOST: "127.0.0.1",
    PORT: String(backendPort),
    FRONTEND_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_DIR: fileStorageDir,
    CSRF_SECRET: process.env.CSRF_SECRET ?? "local-csrf-secret-for-payment-approval-erp",
    FILE_URL_SECRET: process.env.FILE_URL_SECRET ?? "local-file-url-secret-for-payment-approval-erp",
    BANK_ACCOUNT_SECRET: process.env.BANK_ACCOUNT_SECRET ?? "local-bank-account-secret-for-payment-approval-erp",
    BANK_ACCOUNT_VERIFICATION_MODE: process.env.BANK_ACCOUNT_VERIFICATION_MODE ?? "internal",
    RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED ?? "true",
    REPORT_JOB_WORKER_ENABLED: process.env.REPORT_JOB_WORKER_ENABLED ?? "false",
    DATA_QUALITY_JOB_ENABLED: process.env.DATA_QUALITY_JOB_ENABLED ?? "false",
  };

  if (process.env.ERP_LOCAL_REGENERATE_PRISMA === "true" || !(await prismaClientMatchesSchema())) {
    await runNodeStep(
      "Prisma 클라이언트 생성",
      "node_modules/prisma/build/index.js",
      ["generate", "--schema", "prisma/schema.prisma"],
      sharedEnv,
    );
  } else {
    log("Prisma 클라이언트가 현재 schema와 일치해 재생성을 건너뜁니다.");
  }
  await runNodeStep(
    "DB 마이그레이션 적용",
    "node_modules/prisma/build/index.js",
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    sharedEnv,
  );
  if (databaseCreated || (await databaseNeedsSeed()) || process.env.ERP_LOCAL_RESEED === "true") {
    await runNodeStep("기본 업무 데이터 생성", "node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], sharedEnv);
  }

  if (useBuildArtifact && (!existsSync(resolve(projectRoot, "backend/dist/server.js")) || !existsSync(resolve(projectRoot, "dist/index.html")))) {
    throw new Error("build artifact가 없습니다. staging은 먼저 npm run local:staging:prepare를 실행하세요.");
  }
  if (useBuildArtifact) {
    startService("백엔드 build artifact", "backend/dist/server.js", [], sharedEnv);
  } else {
    startService("백엔드", "node_modules/tsx/dist/cli.mjs", ["backend/src/server.ts"], sharedEnv);
  }
  await waitForHealth(`http://127.0.0.1:${backendPort}/api/health/db`);

  const frontendEnv = {
    ...sharedEnv,
    VITE_ERP_API_MODE: "remote",
    VITE_ERP_API_BASE_URL: "/api",
    VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
  };
  const frontendArgs = useBuildArtifact
    ? ["preview", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort", "--config", "vite.config.js", "--configLoader", "runner"]
    : ["--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort", "--config", "vite.config.js", "--configLoader", "runner"];
  startService(
    useBuildArtifact ? "프런트엔드 build artifact" : "프런트엔드",
    "node_modules/vite/bin/vite.js",
    frontendArgs,
    frontendEnv,
  );
  await waitForHealth(`http://127.0.0.1:${frontendPort}`);
  await startControlServer();

  await writeFile(runtimeStatePath, `${JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    profile,
    artifactMode: useBuildArtifact ? "build" : "source",
    releaseVersion: sharedEnv.RELEASE_VERSION ?? null,
    releaseSourceRef: sharedEnv.RELEASE_SOURCE_REF ?? null,
    releaseGitCommit: sharedEnv.RELEASE_GIT_COMMIT ?? null,
    releaseManifestSha256: sharedEnv.RELEASE_MANIFEST_SHA256 ?? null,
    url: `http://127.0.0.1:${frontendPort}`,
    frontendPort,
    backendPort,
    controlPort,
    controlToken,
    databasePort,
    databaseName,
    databaseUser,
    databaseDir,
    fileStorageDir,
  }, null, 2)}\n`);

  log(`준비 완료: http://127.0.0.1:${frontendPort}`);
  log("관리자 로그인: kim.minsu@example.local / password");
  log(`종료: Ctrl+C 또는 ${profile === "live" ? "npm run local:stop" : "npm run local:staging:stop"}`);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("uncaughtException", (error) => {
  console.error(`[local] 치명적 오류: ${error instanceof Error ? error.stack : String(error)}`);
  void shutdown(1);
});
process.once("unhandledRejection", (error) => {
  console.error(`[local] 처리되지 않은 오류: ${error instanceof Error ? error.stack : String(error)}`);
  void shutdown(1);
});

try {
  await main();
} catch (error) {
  console.error(`[local] 시작 실패: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
