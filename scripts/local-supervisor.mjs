#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDataRoot = resolve(projectRoot, ".local-data");
const runtimeStatePath = resolve(localDataRoot, "runtime.json");
const supervisorStatePath = resolve(localDataRoot, "supervisor.json");
const supervisorLogPath = resolve(localDataRoot, "local-supervisor.log");
const serviceLogPath = resolve(localDataRoot, "local-server-supervised.log");
const startScriptPath = resolve(projectRoot, "scripts", "start-local.mjs");
const restartWindowMs = 5 * 60 * 1000;
const maxRestartsInWindow = 5;
const supervisorPort = 4308;

let activeChild;
let stopping = false;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(supervisorLogPath, line, "utf8").catch(() => undefined);
}

function wait(delayMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

export function shouldRestart(exitCode, isStopping = false) {
  return !isStopping && exitCode !== 0;
}

export function restartDelayMs(restartCount) {
  return Math.min(30_000, 2_000 * (2 ** Math.max(0, restartCount - 1)));
}


async function acquireSupervisorLock() {
  return new Promise((resolveLock, rejectLock) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") resolveLock(null);
      else rejectLock(error);
    });
    server.listen(supervisorPort, "127.0.0.1", () => resolveLock(server));
  });
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}
async function existingProcessAlive(path) {
  const state = await readJson(path);
  return state && isProcessAlive(Number(state.pid)) ? state : null;
}

async function runService() {
  const logFd = openSync(serviceLogPath, "a");
  try {
    activeChild = spawn(process.execPath, [startScriptPath], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    return await new Promise((resolveExit, rejectExit) => {
      activeChild.once("error", rejectExit);
      activeChild.once("exit", (code, signal) => {
        resolveExit(signal ? 1 : (code ?? 1));
      });
    });
  } finally {
    activeChild = undefined;
    closeSync(logFd);
  }
}

async function supervise() {
  await mkdir(localDataRoot, { recursive: true });
  const lockServer = await acquireSupervisorLock();
  if (!lockServer) {
    await log(`이미 supervisor lock 포트 ${supervisorPort}가 사용 중입니다.`);
    return;
  }

  try {
    const existingRuntime = await existingProcessAlive(runtimeStatePath);
    if (existingRuntime) {
      await log(`로컬 ERP가 이미 실행 중이므로 추가 supervisor를 시작하지 않습니다. pid=${existingRuntime.pid}`);
      return;
    }

    await writeFile(supervisorStatePath, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      projectRoot,
      supervisorPort,
    }, null, 2)}\n`, "utf8");
    await log(`supervisor 시작 pid=${process.pid} lockPort=${supervisorPort}`);

    const restartTimes = [];
    while (!stopping) {
      const exitCode = await runService();
      if (!shouldRestart(exitCode, stopping)) {
        await log(`로컬 ERP 정상 종료 code=${exitCode}`);
        return;
      }

      const now = Date.now();
      while (restartTimes.length > 0 && restartTimes[0] < now - restartWindowMs) restartTimes.shift();
      if (restartTimes.length >= maxRestartsInWindow) {
        throw new Error(`${restartWindowMs / 60_000}분 안에 ${maxRestartsInWindow}회 재시작해 자동 복구를 중단합니다.`);
      }
      restartTimes.push(now);
      const delayMs = restartDelayMs(restartTimes.length);
      await log(`로컬 ERP 비정상 종료 code=${exitCode}; ${delayMs}ms 후 재시작 (${restartTimes.length}/${maxRestartsInWindow})`);
      await wait(delayMs);
    }
  } finally {
    await rm(supervisorStatePath, { force: true });
    await closeServer(lockServer);
    await log("supervisor 종료");
  }
}

function requestStop() {
  stopping = true;
  if (activeChild && !activeChild.killed) activeChild.kill("SIGTERM");
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  supervise().catch(async (error) => {
    await log(`supervisor 오류: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    await rm(supervisorStatePath, { force: true }).catch(() => undefined);
    process.exitCode = 1;
  });
}
