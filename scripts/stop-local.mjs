#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeStatePath = resolve(projectRoot, ".local-data", "runtime.json");

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let state;
  try {
    state = JSON.parse(await readFile(runtimeStatePath, "utf8"));
  } catch {
    console.log("[local] 기록된 로컬 시스템이 없습니다.");
    return;
  }

  const pid = Number(state.pid);
  if (!isProcessAlive(pid)) {
    await rm(runtimeStatePath, { force: true });
    console.log("[local] 종료된 실행 기록을 정리했습니다.");
    return;
  }

  const waitForExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) return true;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    return !isProcessAlive(pid);
  };

  let stopped = false;
  if (state.controlPort && state.controlToken) {
    try {
      const response = await fetch(`http://127.0.0.1:${state.controlPort}/shutdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${state.controlToken}` },
      });
      if (response.ok) stopped = await waitForExit(12_000);
    } catch {
      stopped = false;
    }
  }

  if (!stopped) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
    stopped = await waitForExit(5_000);
  }

  if (!stopped) {
    console.error(`[local] PID ${pid}를 종료하지 못했습니다.`);
    process.exitCode = 1;
    return;
  }

  await rm(runtimeStatePath, { force: true });
  console.log("[local] 로컬 시스템을 정상 종료했습니다.");
}

await main();
