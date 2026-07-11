#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.env.ERP_LOCAL_PROFILE?.trim() || "live";
const localDataRoot = process.env.ERP_LOCAL_DATA_DIR ? resolve(process.env.ERP_LOCAL_DATA_DIR) : resolve(projectRoot, ".local-data");
const runtimeStatePath = process.env.ERP_LOCAL_RUNTIME_STATE_PATH ? resolve(process.env.ERP_LOCAL_RUNTIME_STATE_PATH) : resolve(localDataRoot, "runtime.json");

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probe(label, url) {
  try {
    const response = await fetch(url);
    console.log(`[local:${profile}] ${label}: ${response.ok ? "정상" : `HTTP ${response.status}`} (${url})`);
    return response.ok;
  } catch (error) {
    console.log(`[local:${profile}] ${label}: 연결 실패 (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}

try {
  const state = JSON.parse(await readFile(runtimeStatePath, "utf8"));
  const alive = isProcessAlive(Number(state.pid));
  console.log(`[local:${profile}] 실행기: ${alive ? "실행 중" : "종료됨"} (PID ${state.pid})`);
  const frontendOk = await probe("화면", state.url ?? "http://127.0.0.1:3000");
  const backendOk = await probe("백엔드 DB", `http://127.0.0.1:${state.backendPort ?? 4310}/api/health/db`);
  if (!alive || !frontendOk || !backendOk) process.exitCode = 1;
} catch {
  console.log(`[local:${profile}] 실행 기록이 없습니다.`);
  process.exitCode = 1;
}
