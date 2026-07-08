import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const healthSource = readFileSync(resolve("backend/src/routes/health.ts"), "utf8");

describe("backend operational health checks", () => {
  it("exposes job and external integration health endpoints", () => {
    assert.match(healthSource, /app\.get\("\/health\/version"/, "release identity health endpoint must be registered");
    assert.match(healthSource, /app\.get\("\/health\/jobs"/, "report job health endpoint must be registered");
    assert.match(healthSource, /app\.get\("\/health\/integrations"/, "external integration health endpoint must be registered");
    assert.match(healthSource, /reply\.code\(identity\.ok \? 200 : 503\)/, "version health must degrade HTTP status when release identity is incomplete");
    assert.match(healthSource, /reply\.code\(jobHealth\.ok \? 200 : 503\)/, "job health must degrade HTTP status when unhealthy");
    assert.match(healthSource, /reply\.code\(integrationStatus\.ok \? 200 : 503\)/, "integration health must degrade HTTP status when unhealthy");
  });

  it("checks report schedule backlog, queue readiness, and recent failures", () => {
    assert.match(healthSource, /prisma\.reportSchedule\.count\(\{ where: \{ isActive: true \} \}\)/, "active report schedules must be counted");
    assert.match(healthSource, /nextRunAt: \{ lte: now \}/, "due report schedules must be counted");
    assert.match(healthSource, /prisma\.reportRun\.findFirst/, "latest report run must be exposed");
    assert.match(healthSource, /status: "FAILED"/, "recent failed report runs must be counted");
    assert.match(healthSource, /REPORT_JOB_WORKER_ENABLED/, "job worker readiness must be configurable");
    assert.match(healthSource, /REPORT_QUEUE_URL/, "queue URL readiness must be configurable");
  });

  it("checks saved bank and accounting integration settings without exposing raw secrets", () => {
    assert.match(healthSource, /entityType: "system_setting"/, "integration health must read saved system setting snapshots");
    assert.match(healthSource, /systemSettingIds\.integrations/, "integration health must use the integrations setting id");
    assert.match(healthSource, /credentialRef/, "integration health must report credential references only");
    assert.match(healthSource, /credentialConfigured/, "integration health must report whether the referenced server secret exists");
    assert.match(healthSource, /endpointSecure/, "integration health must verify HTTPS endpoint configuration");
    assert.match(healthSource, /category === "bank"/, "bank integration must be required");
    assert.match(healthSource, /category === "accounting"/, "accounting integration must be required");
    assert.doesNotMatch(healthSource, /Bearer\s+\$\{env\[/, "health checks must not call external endpoints or emit secret-bearing Authorization headers");
  });
});
