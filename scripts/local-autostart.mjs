#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDataRoot = resolve(projectRoot, ".local-data");
const defaultRuntimeRoot = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "expense-approval-erp")
  : localDataRoot;
const launcherPath = resolve(defaultRuntimeRoot, "autostart.vbs");
const supervisorPath = resolve(projectRoot, "scripts", "local-supervisor.mjs");
const supervisorStatePath = resolve(localDataRoot, "supervisor.json");
const runtimeStatePath = resolve(localDataRoot, "runtime.json");
const registryKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const registryValue = "ExpenseApprovalERP";

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    return { ...state, alive: isProcessAlive(Number(state.pid)) };
  } catch {
    return null;
  }
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} 실행 실패`).trim());
  }
  return result;
}

function vbsEscape(value) {
  return value.replaceAll('"', '""');
}

export function buildVbsLauncher(nodePath, scriptPath) {
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${vbsEscape(nodePath)}" & Chr(34) & " " & Chr(34) & "${vbsEscape(scriptPath)}" & Chr(34), 0, False`,
    "",
  ].join("\r\n");
}

async function writeLauncher() {
  await mkdir(dirname(launcherPath), { recursive: true });
  const content = buildVbsLauncher(process.execPath, supervisorPath);
  const encoded = Buffer.from(content, "utf16le");
  await writeFile(launcherPath, Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]));
}

async function install() {
  await writeLauncher();
  const command = `wscript.exe "${launcherPath}"`;
  run("reg.exe", ["add", registryKey, "/v", registryValue, "/t", "REG_SZ", "/d", command, "/f"]);
  console.log(`[local-autostart] 사용자 로그인 자동 시작 등록 완료: ${registryValue}`);
  console.log(`[local-autostart] launcher: ${launcherPath}`);
}

async function start() {
  await writeLauncher();
  run("wscript.exe", [launcherPath]);
  console.log("[local-autostart] 백그라운드 supervisor 시작을 요청했습니다.");
}

async function status() {
  const registration = run("reg.exe", ["query", registryKey, "/v", registryValue], { allowFailure: true });
  const expectedCommand = `wscript.exe "${launcherPath}"`;
  let launcherValid = false;
  try {
    const encoded = await readFile(launcherPath);
    const offset = encoded[0] === 0xff && encoded[1] === 0xfe ? 2 : 0;
    launcherValid = encoded.subarray(offset).toString("utf16le") === buildVbsLauncher(process.execPath, supervisorPath);
  } catch {
    launcherValid = false;
  }
  const registered = registration.status === 0 && registration.stdout.includes(expectedCommand) && launcherValid;
  const supervisor = await readState(supervisorStatePath);
  const runtime = await readState(runtimeStatePath);
  console.log(`[local-autostart] 로그인 자동 시작: ${registered ? "등록됨" : registration.status === 0 ? "등록 경로 오류" : "미등록"}`);
  console.log(`[local-autostart] supervisor: ${supervisor?.alive ? `실행 중 (PID ${supervisor.pid})` : "실행 안 됨"}`);
  console.log(`[local-autostart] 로컬 ERP: ${runtime?.alive ? `실행 중 (PID ${runtime.pid}, http://127.0.0.1:3000)` : "실행 안 됨"}`);
  if (!registered) process.exitCode = 1;
}

async function remove() {
  run("reg.exe", ["delete", registryKey, "/v", registryValue, "/f"], { allowFailure: true });
  await rm(launcherPath, { force: true });
  console.log(`[local-autostart] 사용자 로그인 자동 시작 등록을 제거했습니다: ${registryValue}`);
}

async function main() {
  if (process.platform !== "win32") throw new Error("현재 자동 시작 등록 명령은 Windows에서만 지원합니다.");
  const command = process.argv[2] ?? "status";
  if (command === "install") return install();
  if (command === "start") return start();
  if (command === "status") return status();
  if (command === "remove") return remove();
  throw new Error(`알 수 없는 명령: ${command}`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[local-autostart] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
