import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { localStagingProfile } from "../../scripts/local-profile.mjs";

test("local staging profile isolates live ports and persistent paths", () => {
  assert.deepEqual(
    [localStagingProfile.frontendPort, localStagingProfile.backendPort, localStagingProfile.controlPort, localStagingProfile.databasePort],
    [3100, 4410, 4409, 55442],
  );
  assert.match(localStagingProfile.databaseDir, /expense-approval-erp-staging|database-runtime/);
  assert.match(localStagingProfile.fileStorageDir, /expense-approval-erp-staging|database-runtime/);
  assert.match(localStagingProfile.runtimeStatePath, /\.local-data[\\/]staging[\\/]runtime\.json/);
});

test("staging start requires verified build artifacts and release identity", async () => {
  const [profileSource, startSource, smokeSource, viteSource] = await Promise.all([
    readFile("scripts/local-profile.mjs", "utf8"),
    readFile("scripts/start-local.mjs", "utf8"),
    readFile("scripts/verify-local-staging.mjs", "utf8"),
    readFile("vite.config.js", "utf8"),
  ]);
  assert.match(profileSource, /ERP_LOCAL_USE_BUILD_ARTIFACT: "true"/);
  assert.match(profileSource, /release:verify-manifest/);
  assert.match(profileSource, /buildIdentityPath/);
  assert.match(profileSource, /status", "--porcelain/);
  assert.match(profileSource, /manifest\.git\?\.dirty !== false/);
  assert.match(startSource, /ERP_LOCAL_USE_BUILD_ARTIFACT/);
  assert.match(smokeSource, /release_identity/);
  assert.match(smokeSource, /isolated_database/);
  assert.match(viteSource, /preview:/);
  assert.match(viteSource, /VITE_DEV_API_PROXY_TARGET/);
});
