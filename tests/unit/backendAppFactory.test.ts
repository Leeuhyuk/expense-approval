import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../../backend/src/app";

describe("backend app factory", () => {
  it("builds the Fastify app without listening and serves health checks through inject", async () => {
    const app = await buildApp({ logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      const payload = response.json();

      assert.equal(response.statusCode, 200);
      assert.equal(payload.status, "success");
      assert.equal(payload.data.ok, true);
      assert.equal(payload.data.service, "payment-approval-erp-backend");
    } finally {
      await app.close();
    }
  });

  it("exposes backend release identity for frontend/backend version matching", async () => {
    const previous = {
      RELEASE_VERSION: process.env.RELEASE_VERSION,
      RELEASE_SOURCE_REF: process.env.RELEASE_SOURCE_REF,
      RELEASE_GIT_COMMIT: process.env.RELEASE_GIT_COMMIT,
      RELEASE_MANIFEST_SHA256: process.env.RELEASE_MANIFEST_SHA256,
    };
    process.env.RELEASE_VERSION = "release-test-version";
    process.env.RELEASE_SOURCE_REF = "v2026.07.06";
    process.env.RELEASE_GIT_COMMIT = "release-test-commit";
    process.env.RELEASE_MANIFEST_SHA256 = "a".repeat(64);

    const app = await buildApp({ logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/health/version" });
      const payload = response.json();

      assert.equal(response.statusCode, 200);
      assert.equal(payload.status, "success");
      assert.equal(payload.data.ok, true);
      assert.equal(payload.data.releaseVersion, "release-test-version");
      assert.equal(payload.data.sourceRef, "v2026.07.06");
      assert.equal(payload.data.gitCommit, "release-test-commit");
      assert.equal(payload.data.manifestSha256, "a".repeat(64));
      assert.deepEqual(payload.data.missing, []);
      assert.deepEqual(payload.data.issues, []);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await app.close();
    }
  });
});
