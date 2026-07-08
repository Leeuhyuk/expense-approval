import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const serviceSource = readFileSync(resolve("src/api/service.ts"), "utf8");
const viteEnvSource = readFileSync(resolve("src/vite-env.d.ts"), "utf8");

describe("frontend release identity", () => {
  it("keeps frontend build release values available for backend comparison", () => {
    assert.match(viteEnvSource, /VITE_RELEASE_VERSION/, "frontend build must type the release version env var");
    assert.match(viteEnvSource, /VITE_RELEASE_SOURCE_REF/, "frontend build must type the release source ref env var");
    assert.match(viteEnvSource, /VITE_RELEASE_GIT_COMMIT/, "frontend build must type the release git commit env var");

    assert.match(serviceSource, /getFrontendReleaseIdentity/, "frontend must expose its build release identity");
    assert.match(serviceSource, /VITE_RELEASE_VERSION/, "frontend release identity must include release version");
    assert.match(serviceSource, /VITE_RELEASE_SOURCE_REF/, "frontend release identity must include source ref");
    assert.match(serviceSource, /VITE_RELEASE_GIT_COMMIT/, "frontend release identity must include git commit");
  });

  it("compares frontend release identity against the backend health version endpoint", () => {
    assert.match(serviceSource, /verifyRemoteReleaseIdentity/, "frontend must expose a remote release identity comparison helper");
    assert.match(serviceSource, /requestRemote<ReleaseIdentityDto>\("\/health\/version"\)/, "comparison helper must call the backend version endpoint");
    assert.match(serviceSource, /releaseVersion.*mismatch/s, "comparison helper must detect version mismatches");
    assert.match(serviceSource, /sourceRef.*mismatch/s, "comparison helper must detect source ref mismatches");
    assert.match(serviceSource, /gitCommit.*mismatch/s, "comparison helper must detect git commit mismatches");
  });
});
