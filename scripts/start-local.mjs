#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalPostgres } from "./local-postgres.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDataRoot = resolve(projectRoot, ".local-data");
const defaultDatabaseRoot = process.platform === "win32" && process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "expense-approval-erp")
  : localDataRoot;
const databaseDir = process.env.ERP_LOCAL_DATABASE_DIR
  ? resolve(process.env.ERP_LOCAL_DATABASE_DIR)
  : resolve(defaultDatabaseRoot, "postgres");
const fileStorageDir = resolve(localDataRoot, "files");
const runtimeStatePath = resolve(localDataRoot, "runtime.json");
const databaseName = "payment_approval_erp";
const databaseUser = "erp_local";
const databasePassword = "erp_local_only";
const databasePort = Number(process.env.ERP_LOCAL_DATABASE_PORT ?? 55432);
const backendPort = Number(process.env.ERP_LOCAL_BACKEND_PORT ?? 4310);
const controlPort = Number(process.env.ERP_LOCAL_CONTROL_PORT ?? 4309);
const frontendPort = 3000;
const controlToken = randomUUID();
const databaseUrl = `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}?schema=public`;
const children = new Set();
let postgres;
let controlServer;
let shuttingDown = false;

function log(message) {
  console.log(`[local] ${message}`);
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
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    ERP_TEST_DATABASE_URL: databaseUrl,
    HOST: "127.0.0.1",
    PORT: String(backendPort),
    FRONTEND_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_DIR: fileStorageDir,
    CSRF_SECRET: "local-csrf-secret-for-payment-approval-erp",
    FILE_URL_SECRET: "local-file-url-secret-for-payment-approval-erp",
    BANK_ACCOUNT_SECRET: "local-bank-account-secret-for-payment-approval-erp",
    BANK_ACCOUNT_VERIFICATION_MODE: "internal",
    RATE_LIMIT_DISABLED: "true",
    REPORT_JOB_WORKER_ENABLED: "false",
    DATA_QUALITY_JOB_ENABLED: "false",
  };

  await runNodeStep(
    "Prisma 클라이언트 생성",
    "node_modules/prisma/build/index.js",
    ["generate", "--schema", "prisma/schema.prisma"],
    sharedEnv,
  );
  await runNodeStep(
    "DB 마이그레이션 적용",
    "node_modules/prisma/build/index.js",
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    sharedEnv,
  );
  if (databaseCreated || process.env.ERP_LOCAL_RESEED === "true") {
    await runNodeStep("기본 업무 데이터 생성", "node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], sharedEnv);
  }

  startService("백엔드", "node_modules/tsx/dist/cli.mjs", ["backend/src/server.ts"], sharedEnv);
  await waitForHealth(`http://127.0.0.1:${backendPort}/api/health/db`);

  const frontendEnv = {
    ...sharedEnv,
    VITE_ERP_API_MODE: "remote",
    VITE_ERP_API_BASE_URL: "/api",
    VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
  };
  startService(
    "프런트엔드",
    "node_modules/vite/bin/vite.js",
    ["--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort", "--config", "vite.config.js", "--configLoader", "runner"],
    frontendEnv,
  );
  await waitForHealth(`http://127.0.0.1:${frontendPort}`);
  await startControlServer();

  await writeFile(runtimeStatePath, `${JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    url: `http://127.0.0.1:${frontendPort}`,
    frontendPort,
    backendPort,
    controlPort,
    controlToken,
    databasePort,
    databaseDir,
    fileStorageDir,
  }, null, 2)}\n`);

  log(`준비 완료: http://127.0.0.1:${frontendPort}`);
  log("관리자 로그인: kim.minsu@example.local / password");
  log("종료: Ctrl+C 또는 npm run local:stop");
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
