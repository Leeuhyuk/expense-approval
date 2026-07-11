#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const localDataRoot = process.env.ERP_LOCAL_DATA_DIR
  ? resolve(process.env.ERP_LOCAL_DATA_DIR)
  : resolve(projectRoot, ".local-data");
const profile = process.env.ERP_LOCAL_PROFILE?.trim() || "live";
const stopCommand = profile === "live" ? "npm run local:stop" : "npm run local:staging:stop";
const defaultDatabaseRoot = process.env.ERP_LOCAL_DATABASE_ROOT
  ? resolve(process.env.ERP_LOCAL_DATABASE_ROOT)
  : process.platform === "win32" && process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "expense-approval-erp")
    : localDataRoot;

export const defaultLocalBackupPaths = {
  projectRoot,
  databaseDir: process.env.ERP_LOCAL_DATABASE_DIR
    ? resolve(process.env.ERP_LOCAL_DATABASE_DIR)
    : resolve(defaultDatabaseRoot, "postgres"),
  fileStorageDir: process.env.ERP_LOCAL_FILE_STORAGE_DIR
    ? resolve(process.env.ERP_LOCAL_FILE_STORAGE_DIR)
    : resolve(localDataRoot, "files"),
  backupRoot: process.env.ERP_LOCAL_BACKUP_DIR
    ? resolve(process.env.ERP_LOCAL_BACKUP_DIR)
    : resolve(defaultDatabaseRoot, "backups"),
  runtimeStatePath: process.env.ERP_LOCAL_RUNTIME_STATE_PATH
    ? resolve(process.env.ERP_LOCAL_RUNTIME_STATE_PATH)
    : resolve(localDataRoot, "runtime.json"),
  databasePort: Number(process.env.ERP_LOCAL_DATABASE_PORT ?? 55432),
};

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function portIsOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function assertLocalSystemStopped({ runtimeStatePath, databasePort }) {
  try {
    const state = JSON.parse(await readFile(runtimeStatePath, "utf8"));
    if (isProcessAlive(Number(state.pid))) {
      throw new Error(`로컬 시스템이 실행 중입니다. 먼저 ${stopCommand}을 실행하세요.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("로컬 시스템이 실행 중")) throw error;
  }

  if (await portIsOpen(databasePort)) {
    throw new Error(`로컬 PostgreSQL 포트 ${databasePort}가 사용 중입니다. 백업 또는 복구 전에 종료하세요.`);
  }
}

function normalizeRelativePath(path) {
  return path.split(sep).join("/");
}

async function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolveHash(hash.digest("hex")));
    stream.once("error", rejectHash);
  });
}

function pathIsInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`심볼릭 링크는 로컬 백업에 포함할 수 없습니다: ${path}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function collectInventory(root) {
  const files = await walkFiles(root);
  return Promise.all(files.map(async (path) => {
    const info = await stat(path);
    return {
      path: normalizeRelativePath(relative(root, path)),
      size: info.size,
      sha256: await sha256File(path),
    };
  }));
}

function assertBackupId(backupId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(backupId)) {
    throw new Error("백업 ID 형식이 올바르지 않습니다.");
  }
}

function makeBackupId(now = new Date()) {
  return now.toISOString().replaceAll(/[-:.]/g, "");
}

async function readProjectMetadata(root) {
  let version = "unknown";
  try {
    version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version ?? version;
  } catch {
    // A backup remains usable even when project metadata is unavailable.
  }
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return { version, gitCommit: git.status === 0 ? git.stdout.trim() : null };
}

async function copyPayload(source, destination) {
  if (await pathExists(source)) {
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  } else {
    await mkdir(destination, { recursive: true });
  }
}

export async function validateBackup(backupDir, { expectedId = basename(backupDir) } = {}) {
  const manifest = JSON.parse(await readFile(resolve(backupDir, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !manifest.payload?.database || !manifest.payload?.files) {
    throw new Error("지원하지 않거나 손상된 로컬 백업 manifest입니다.");
  }
  if (manifest.id !== expectedId) {
    throw new Error("백업 ID와 manifest ID가 일치하지 않습니다.");
  }

  for (const sectionName of ["database", "files"]) {
    const section = manifest.payload[sectionName];
    const expectedDirectory = sectionName === "database" ? "postgres" : "files";
    if (section.directory !== expectedDirectory || !Array.isArray(section.inventory)) {
      throw new Error(`${sectionName} 백업 경로 또는 inventory가 올바르지 않습니다.`);
    }
    const actual = await collectInventory(resolve(backupDir, section.directory));
    const expected = section.inventory;
    if (actual.length !== expected.length) {
      throw new Error(`${sectionName} 백업 파일 수가 manifest와 다릅니다.`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      const left = actual[index];
      const right = expected[index];
      if (left.path !== right.path || left.size !== right.size || left.sha256 !== right.sha256) {
        throw new Error(`${sectionName} 백업 무결성 검증 실패: ${right.path}`);
      }
    }
  }
  return manifest;
}

export async function createBackup({
  databaseDir,
  fileStorageDir,
  backupRoot,
  projectRoot: metadataRoot = projectRoot,
  backupId = makeBackupId(),
  checkStopped = true,
  runtimeStatePath = defaultLocalBackupPaths.runtimeStatePath,
  databasePort = defaultLocalBackupPaths.databasePort,
}) {
  assertBackupId(backupId);
  if (pathIsInside(databaseDir, backupRoot) || pathIsInside(fileStorageDir, backupRoot)) {
    throw new Error("백업 경로는 PostgreSQL 또는 파일 저장소 내부에 둘 수 없습니다.");
  }
  if (checkStopped) await assertLocalSystemStopped({ runtimeStatePath, databasePort });
  if (!(await pathExists(databaseDir))) throw new Error(`PostgreSQL 데이터 디렉터리가 없습니다: ${databaseDir}`);
  if (await pathExists(resolve(databaseDir, "postmaster.pid"))) {
    throw new Error("PostgreSQL 실행 흔적(postmaster.pid)이 남아 있어 백업을 중단했습니다.");
  }

  await mkdir(backupRoot, { recursive: true });
  const finalDir = resolve(backupRoot, backupId);
  const tempDir = resolve(backupRoot, `.${backupId}.tmp-${process.pid}`);
  if (await pathExists(finalDir)) throw new Error(`같은 ID의 백업이 이미 있습니다: ${backupId}`);
  await rm(tempDir, { recursive: true, force: true });

  try {
    const databaseTarget = resolve(tempDir, "postgres");
    const filesTarget = resolve(tempDir, "files");
    await mkdir(tempDir, { recursive: true });
    await copyPayload(databaseDir, databaseTarget);
    await copyPayload(fileStorageDir, filesTarget);
    const postgresVersion = (await readFile(resolve(databaseTarget, "PG_VERSION"), "utf8")).trim();
    const manifest = {
      schemaVersion: 1,
      id: backupId,
      createdAt: new Date().toISOString(),
      kind: "cold-physical-backup",
      postgresVersion,
      application: await readProjectMetadata(metadataRoot),
      payload: {
        database: { directory: "postgres", inventory: await collectInventory(databaseTarget) },
        files: { directory: "files", inventory: await collectInventory(filesTarget) },
      },
    };
    await writeFile(resolve(tempDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await validateBackup(tempDir, { expectedId: backupId });
    await rename(tempDir, finalDir);
    return { backupDir: finalDir, manifest };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function listBackups({ backupRoot }) {
  if (!(await pathExists(backupRoot))) return [];
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backups = [];
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith(".")).sort((a, b) => b.name.localeCompare(a.name))) {
    try {
      const manifest = await validateBackup(resolve(backupRoot, entry.name));
      backups.push({ id: entry.name, createdAt: manifest.createdAt, postgresVersion: manifest.postgresVersion, valid: true });
    } catch (error) {
      backups.push({ id: entry.name, createdAt: null, postgresVersion: null, valid: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return backups;
}

async function restoreSection({ source, destination, inventory, token }) {
  const staging = resolve(dirname(destination), `.${basename(destination)}.restore-${token}`);
  await mkdir(dirname(destination), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
  const stagedInventory = await collectInventory(staging);
  if (JSON.stringify(stagedInventory) !== JSON.stringify(inventory)) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`복구 스테이징 무결성 검증 실패: ${destination}`);
  }
  return staging;
}

export async function restoreBackup({
  backupId,
  databaseDir,
  fileStorageDir,
  backupRoot,
  checkStopped = true,
  runtimeStatePath = defaultLocalBackupPaths.runtimeStatePath,
  databasePort = defaultLocalBackupPaths.databasePort,
}) {
  assertBackupId(backupId);
  if (pathIsInside(databaseDir, backupRoot) || pathIsInside(fileStorageDir, backupRoot)) {
    throw new Error("백업 경로는 PostgreSQL 또는 파일 저장소 내부에 둘 수 없습니다.");
  }
  if (checkStopped) await assertLocalSystemStopped({ runtimeStatePath, databasePort });
  const backupDir = resolve(backupRoot, backupId);
  const manifest = await validateBackup(backupDir);
  if (manifest.payload.database.inventory.some((item) => item.path === "postmaster.pid")) {
    throw new Error("실행 중 생성된 PostgreSQL 백업은 복구할 수 없습니다.");
  }

  const token = `${process.pid}-${Date.now()}`;
  const databaseStaging = await restoreSection({
    source: resolve(backupDir, manifest.payload.database.directory),
    destination: databaseDir,
    inventory: manifest.payload.database.inventory,
    token,
  });
  let filesStaging;
  try {
    filesStaging = await restoreSection({
      source: resolve(backupDir, manifest.payload.files.directory),
      destination: fileStorageDir,
      inventory: manifest.payload.files.inventory,
      token,
    });
  } catch (error) {
    await rm(databaseStaging, { recursive: true, force: true });
    throw error;
  }

  const databaseRollback = resolve(dirname(databaseDir), `.${basename(databaseDir)}.rollback-${token}`);
  const filesRollback = resolve(dirname(fileStorageDir), `.${basename(fileStorageDir)}.rollback-${token}`);
  const state = { databaseMoved: false, databaseInstalled: false, filesMoved: false, filesInstalled: false };
  try {
    if (await pathExists(databaseDir)) {
      await rename(databaseDir, databaseRollback);
      state.databaseMoved = true;
    }
    await rename(databaseStaging, databaseDir);
    state.databaseInstalled = true;
    if (await pathExists(fileStorageDir)) {
      await rename(fileStorageDir, filesRollback);
      state.filesMoved = true;
    }
    await rename(filesStaging, fileStorageDir);
    state.filesInstalled = true;
  } catch (error) {
    if (state.filesInstalled) await rm(fileStorageDir, { recursive: true, force: true });
    if (state.filesMoved) await rename(filesRollback, fileStorageDir);
    if (state.databaseInstalled) await rm(databaseDir, { recursive: true, force: true });
    if (state.databaseMoved) await rename(databaseRollback, databaseDir);
    throw error;
  } finally {
    await rm(databaseStaging, { recursive: true, force: true });
    await rm(filesStaging, { recursive: true, force: true });
  }

  await rm(databaseRollback, { recursive: true, force: true });
  await rm(filesRollback, { recursive: true, force: true });
  return { backupDir, manifest };
}

async function main() {
  const command = process.argv[2] ?? "list";
  if (command === "create") {
    const result = await createBackup({ ...defaultLocalBackupPaths });
    console.log(`[local-backup] 생성 완료: ${result.manifest.id}`);
    console.log(`[local-backup] 위치: ${result.backupDir}`);
    return;
  }
  if (command === "list") {
    const backups = await listBackups({ backupRoot: defaultLocalBackupPaths.backupRoot });
    if (backups.length === 0) console.log("[local-backup] 생성된 백업이 없습니다.");
    for (const backup of backups) {
      console.log(`${backup.valid ? "OK" : "INVALID"}\t${backup.id}\t${backup.createdAt ?? "-"}\tPG ${backup.postgresVersion ?? "-"}${backup.error ? `\t${backup.error}` : ""}`);
    }
    return;
  }
  if (command === "restore") {
    const backupId = process.argv[3];
    if (!backupId) throw new Error("사용법: npm run local:restore -- <백업-ID>");
    const result = await restoreBackup({ ...defaultLocalBackupPaths, backupId });
    console.log(`[local-backup] 복구 완료: ${result.manifest.id}`);
    console.log(`[local-backup] ${profile === "live" ? "npm run local" : "npm run local:staging"}로 시스템을 시작해 확인하세요.`);
    return;
  }
  throw new Error(`알 수 없는 명령: ${command}`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[local-backup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
