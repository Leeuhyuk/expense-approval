import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createBackup, listBackups, restoreBackup } from "../../scripts/local-backup.mjs";

async function makeFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "expense-approval-backup-"));
  const databaseDir = resolve(root, "live", "postgres");
  const fileStorageDir = resolve(root, "live", "files");
  const backupRoot = resolve(root, "backups");
  await mkdir(resolve(databaseDir, "base", "1"), { recursive: true });
  await mkdir(resolve(fileStorageDir, "evidence"), { recursive: true });
  await writeFile(resolve(databaseDir, "PG_VERSION"), "18\n");
  await writeFile(resolve(databaseDir, "base", "1", "record.bin"), "original-database");
  await writeFile(resolve(fileStorageDir, "evidence", "receipt.pdf"), "original-file");
  return { root, databaseDir, fileStorageDir, backupRoot };
}

test("cold backup restores database and uploaded files together", async (context) => {
  const fixture = await makeFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));

  const created = await createBackup({ ...fixture, projectRoot: fixture.root, backupId: "backup-001", checkStopped: false });
  assert.equal(created.manifest.postgresVersion, "18");
  assert.equal((await listBackups(fixture))[0]?.valid, true);

  await writeFile(resolve(fixture.databaseDir, "base", "1", "record.bin"), "mutated-database");
  await rm(fixture.fileStorageDir, { recursive: true, force: true });
  await restoreBackup({ ...fixture, backupId: "backup-001", checkStopped: false });

  assert.equal(await readFile(resolve(fixture.databaseDir, "base", "1", "record.bin"), "utf8"), "original-database");
  assert.equal(await readFile(resolve(fixture.fileStorageDir, "evidence", "receipt.pdf"), "utf8"), "original-file");
});

test("corrupt backup is rejected without changing current data", async (context) => {
  const fixture = await makeFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await createBackup({ ...fixture, projectRoot: fixture.root, backupId: "backup-002", checkStopped: false });
  await writeFile(resolve(fixture.backupRoot, "backup-002", "postgres", "base", "1", "record.bin"), "corrupt");
  await writeFile(resolve(fixture.databaseDir, "base", "1", "record.bin"), "current-safe-data");

  await assert.rejects(restoreBackup({ ...fixture, backupId: "backup-002", checkStopped: false }), /무결성 검증 실패/);
  assert.equal(await readFile(resolve(fixture.databaseDir, "base", "1", "record.bin"), "utf8"), "current-safe-data");
});

test("restore rejects path traversal backup IDs", async (context) => {
  const fixture = await makeFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await assert.rejects(restoreBackup({ ...fixture, backupId: "../outside", checkStopped: false }), /백업 ID 형식/);
});

test("restore rejects a manifest payload path outside the backup", async (context) => {
  const fixture = await makeFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await createBackup({ ...fixture, projectRoot: fixture.root, backupId: "backup-003", checkStopped: false });
  const manifestPath = resolve(fixture.backupRoot, "backup-003", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.payload.database.directory = "../../live/postgres";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(
    restoreBackup({ ...fixture, backupId: "backup-003", checkStopped: false }),
    /백업 경로 또는 inventory/,
  );
});
test("backup rejects a destination nested inside live data", async (context) => {
  const fixture = await makeFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await assert.rejects(
    createBackup({
      ...fixture,
      backupRoot: resolve(fixture.databaseDir, "backups"),
      backupId: "backup-004",
      checkStopped: false,
    }),
    /백업 경로는 PostgreSQL 또는 파일 저장소 내부/,
  );
});