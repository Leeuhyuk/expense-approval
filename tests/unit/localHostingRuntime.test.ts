import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const packageJson = readFileSync(resolve("package.json"), "utf8");
const viteConfig = readFileSync(resolve("vite.config.js"), "utf8");
const startSource = readFileSync(resolve("scripts/start-local.mjs"), "utf8");
const postgresSource = readFileSync(resolve("scripts/local-postgres.mjs"), "utf8");
const stopSource = readFileSync(resolve("scripts/stop-local.mjs"), "utf8");
const statusSource = readFileSync(resolve("scripts/local-status.mjs"), "utf8");

describe("local hosting runtime", () => {
  it("keeps a single fixed user entrypoint on port 3000", () => {
    assert.match(packageJson, /"local": "node scripts\/start-local\.mjs"/);
    assert.match(packageJson, /"local:status": "node scripts\/local-status\.mjs"/);
    assert.match(packageJson, /"local:stop": "node scripts\/stop-local\.mjs"/);
    assert.match(startSource, /ERP_LOCAL_FRONTEND_PORT \?\? 3000/);
    assert.match(startSource, /VITE_ERP_API_MODE: "remote"/);
    assert.match(startSource, /VITE_DEV_API_PROXY_TARGET/);
    assert.match(viteConfig, /port: 3000/);
    assert.match(viteConfig, /strictPort: true/);
    assert.match(viteConfig, /"\/api"[\s\S]*VITE_DEV_API_PROXY_TARGET/);
  });

  it("initializes persistent PostgreSQL, migrations, seed data, and local file storage", () => {
    assert.match(packageJson, /"embedded-postgres": "18\.4\.0-beta\.17"/);
    assert.match(startSource, /LOCALAPPDATA[\s\S]*expense-approval-erp/);
    assert.match(startSource, /existsSync\(resolve\(databaseDir, "PG_VERSION"\)\)/);
    assert.match(startSource, /\["migrate", "deploy", "--schema", "prisma\/schema\.prisma"\]/);
    assert.match(startSource, /databaseCreated \|\| \(await databaseNeedsSeed\(\)\) \|\| process\.env\.ERP_LOCAL_RESEED === "true"/);
    assert.match(startSource, /FILE_STORAGE_DIR: fileStorageDir/);
    assert.match(postgresSource, /@embedded-postgres\/windows-x64/);
    assert.match(postgresSource, /cp\(sourceNativeDir, this\.nativeDir/);
    assert.match(postgresSource, /"--encoding=UTF8"/);
    assert.match(postgresSource, /"--no-locale"/);
  });

  it("waits for DB health and supports status plus graceful shutdown", () => {
    assert.match(startSource, /waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{backendPort\}\/api\/health\/db`\)/);
    assert.match(startSource, /request\.url === "\/shutdown"/);
    assert.match(startSource, /authorization === `Bearer \$\{controlToken\}`/);
    assert.match(postgresSource, /"pg_ctl\.exe"/);
    assert.match(postgresSource, /"fast"/);
    assert.match(stopSource, /fetch\(`http:\/\/127\.0\.0\.1:\$\{state\.controlPort\}\/shutdown`/);
    assert.match(stopSource, /taskkill/);
    assert.match(statusSource, /\/api\/health\/db/);
  });
});
