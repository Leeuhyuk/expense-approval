import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { dataQualityJobPolicy, dataQualityScheduleKey } from "../../backend/src/operations/dataQualityJobWorker";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("data quality recurring batch", () => {
  it("builds deterministic schedule buckets and bounded worker policy", () => {
    const first = new Date("2026-07-10T00:01:00.000Z");
    const second = new Date("2026-07-10T00:59:59.999Z");
    assert.equal(dataQualityScheduleKey(first, 60), dataQualityScheduleKey(second, 60));
    assert.notEqual(dataQualityScheduleKey(first, 60), dataQualityScheduleKey(new Date("2026-07-10T01:00:00.000Z"), 60));

    const policy = dataQualityJobPolicy({
      DATA_QUALITY_JOB_ENABLED: "true",
      DATA_QUALITY_JOB_INTERVAL_MINUTES: "30",
      DATA_QUALITY_JOB_HISTORY_LIMIT: "40",
      DATA_QUALITY_JOB_RUN_ON_START: "true",
      DATA_QUALITY_JOB_START_DELAY_MS: "2000",
    });
    assert.deepEqual(policy, {
      enabled: true,
      intervalMinutes: 30,
      historyLimit: 40,
      runOnStart: true,
      startDelayMs: 2000,
    });
  });

  it("persists runs, blocks duplicate schedule buckets, alerts owners, and exposes operator routes", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20260710010000_data_quality_runs/migration.sql");
    const worker = read("backend/src/operations/dataQualityJobWorker.ts");
    const app = read("backend/src/app.ts");
    const routes = read("backend/src/routes/operations.ts");

    assert.match(schema, /model DataQualityRun/);
    assert.match(schema, /scheduleKey\s+String\?\s+@unique/);
    assert.match(migration, /CREATE TABLE "data_quality_runs"/);
    assert.match(worker, /dataQualityRun\.create/);
    assert.match(worker, /code\?: string.*P2002/s);
    assert.match(worker, /NotificationType\.OPERATIONAL_ALERT/);
    assert.match(worker, /setInterval/);
    assert.match(worker, /addHook\("onClose"/);
    assert.match(app, /registerDataQualityScheduler\(app\)/);
    assert.match(routes, /app\.post\("\/operations\/data-quality\/run"/);
    assert.match(routes, /app\.get\("\/operations\/data-quality\/runs"/);
    assert.match(routes, /app\.get\("\/operations\/data-quality\/runs\/:runId\/download"/);
    assert.match(routes, /hasPermission\(user, "system:manage"\)/);
  });

  it("keeps system settings actions and release evidence wired to the same batch", () => {
    const service = read("src/api/service.ts");
    const mockService = read("src/api/mockService.ts");
    const main = read("src/main.tsx");
    const envExample = read(".env.example");
    const apiSpec = read("docs/api-spec.md");
    const buttonMap = read("docs/button-action-map.md");
    const checklist = read("erp-system-checklist.md");
    const manifest = read("scripts/generate-release-manifest.mjs");

    for (const method of ["listDataQualityRuns", "runDataQualityJob", "downloadDataQualityRun"]) {
      assert.match(service, new RegExp(method));
      assert.match(mockService, new RegExp(method));
    }
    assert.match(main, /function DataQualityRunCard/);
    assert.match(main, /지금 실행/);
    assert.match(main, /데이터 품질 JSON 리포트 다운로드/);
    assert.match(envExample, /DATA_QUALITY_JOB_ENABLED=/);
    assert.match(apiSpec, /\/operations\/data-quality\/runs/);
    assert.match(buttonMap, /데이터 품질 배치/);
    assert.match(checklist, /\[x\] P2: 데이터 품질 리포트와 반복 정합성 점검 배치 운영/);
    assert.match(manifest, /backend\/src\/operations\/dataQualityJobWorker\.ts/);
    assert.match(manifest, /tests\/unit\/dataQualityBatch\.test\.ts/);
  });
});