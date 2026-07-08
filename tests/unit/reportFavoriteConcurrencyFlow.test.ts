import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function routeBlock(signature: string) {
  const source = read("backend/src/routes/pageResources.ts");
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found in pageResources route source`);
  const next = source.indexOf("\n  app.", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const schemaSource = read("prisma/schema.prisma");
const migrationSource = read("prisma/migrations/20260706020000_report_favorite_row_versions/migration.sql");
const routeSource = read("backend/src/routes/pageResources.ts");
const serviceSource = read("src/api/service.ts");
const mainSource = read("src/main.tsx");

describe("report and favorite concurrency flow", () => {
  it("keeps report and favorite database rows versioned", () => {
    assert.match(schemaSource, /model ReportRun \{[\s\S]*rowVersion\s+Int\s+@default\(1\)[\s\S]*@@map\("report_runs"\)/, "ReportRun rows must carry rowVersion");
    assert.match(schemaSource, /model ReportSchedule \{[\s\S]*rowVersion\s+Int\s+@default\(1\)[\s\S]*@@map\("report_schedules"\)/, "ReportSchedule rows must carry rowVersion");
    assert.match(schemaSource, /model FavoriteItem \{[\s\S]*rowVersion\s+Int\s+@default\(1\)[\s\S]*@@map\("favorite_items"\)/, "FavoriteItem rows must carry rowVersion");
    assert.match(migrationSource, /ALTER TABLE "report_runs" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;/, "migration must add ReportRun.rowVersion");
    assert.match(migrationSource, /ALTER TABLE "report_schedules" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;/, "migration must add ReportSchedule.rowVersion");
    assert.match(migrationSource, /ALTER TABLE "favorite_items" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;/, "migration must add FavoriteItem.rowVersion");
  });

  it("exposes rowVersion values through report, schedule, and favorite DTOs", () => {
    assert.match(routeSource, /function toReportRow[\s\S]*rowVersion: String\(item\.rowVersion\)[\s\S]*보고서RowVersion: String\(item\.rowVersion\)/, "report rows must expose rowVersion metadata");
    assert.match(routeSource, /function toReportScheduleDto[\s\S]*rowVersion: item\.rowVersion/, "report schedule DTOs must expose rowVersion");
    assert.match(routeSource, /function toFavoriteRow[\s\S]*rowVersion: String\(item\.rowVersion\)[\s\S]*즐겨찾기RowVersion: String\(item\.rowVersion\)/, "favorite rows must expose rowVersion metadata");
    assert.match(serviceSource, /export type ReportScheduleDto = \{[\s\S]*rowVersion: number;/, "frontend report schedule contract must include rowVersion");
    assert.match(serviceSource, /export type PageActionRequest = \{[\s\S]*보고서RowVersion\?: number \| string;[\s\S]*즐겨찾기RowVersion\?: number \| string;/, "generic page mutations must carry report and favorite rowVersion aliases");
  });

  it("guards report run mutations with idempotency keys and conditional rowVersion writes", () => {
    const createBlock = routeBlock('app.post("/reports"');
    const updateBlock = routeBlock('app.patch("/reports/:reportName"');
    const deleteBlock = routeBlock('app.delete("/reports/:reportName"');
    const actionBlock = routeBlock('app.post("/reports/:reportName/:action"');

    assert.match(createBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "report create must replay or reject duplicate idempotency keys");
    assert.match(createBlock, /createAudit\(tx, request, user, "report_run"[\s\S]*idempotencyKey/, "report create audit must persist idempotency keys");
    assert.match(updateBlock, /readOptionalIntegerValue\(record, \["rowVersion", "보고서RowVersion"\]\)/, "report update must read displayed rowVersion");
    assert.match(updateBlock, /expectedRowVersion !== before\.rowVersion/, "report update must reject stale rowVersion");
    assert.match(updateBlock, /tx\.reportRun\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "report update must use a guarded write");
    assert.match(deleteBlock, /readOptionalIntegerValue\(record, \["rowVersion", "보고서RowVersion"\]\)/, "report delete must read displayed rowVersion");
    assert.match(deleteBlock, /tx\.reportRun\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "report delete must use a guarded write");
    assert.match(actionBlock, /보고서RowVersion/, "report action adapter must forward rowVersion metadata");
  });

  it("guards report schedule mutations with idempotency keys and conditional rowVersion writes", () => {
    const createBlock = routeBlock('app.post("/reports/schedules"');
    const updateBlock = routeBlock('app.patch("/reports/schedules/:scheduleId"');
    const deleteBlock = routeBlock('app.delete("/reports/schedules/:scheduleId"');

    assert.match(createBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "schedule create must replay or reject duplicate idempotency keys");
    assert.match(createBlock, /createAudit\(tx, request, user, "report_schedule"[\s\S]*idempotencyKey/, "schedule create audit must persist idempotency keys");
    assert.match(updateBlock, /readOptionalIntegerValue\(record, \["rowVersion", "예약RowVersion"\]\)/, "schedule update must read displayed rowVersion");
    assert.match(updateBlock, /tx\.reportSchedule\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "schedule update must use a guarded write");
    assert.match(deleteBlock, /readOptionalIntegerValue\(record, \["rowVersion", "예약RowVersion"\]\)/, "schedule delete must read displayed rowVersion");
    assert.match(deleteBlock, /tx\.reportSchedule\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "schedule delete must use a guarded write");
  });

  it("guards favorite mutations with idempotency keys and conditional rowVersion writes", () => {
    const createBlock = routeBlock('app.post("/favorites"');
    const updateBlock = routeBlock('app.patch("/favorites/:label"');
    const deleteBlock = routeBlock('app.delete("/favorites/:label"');
    const actionBlock = routeBlock('app.post("/favorites/:label/:action"');

    assert.match(createBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "favorite create must replay or reject duplicate idempotency keys");
    assert.match(createBlock, /createAudit\(tx, request, user, "favorite_item"[\s\S]*idempotencyKey/, "favorite create audit must persist idempotency keys");
    assert.match(updateBlock, /readOptionalIntegerValue\(record, \["rowVersion", "즐겨찾기RowVersion"\]\)/, "favorite update must read displayed rowVersion");
    assert.match(updateBlock, /expectedRowVersion !== before\.rowVersion/, "favorite update must reject stale rowVersion");
    assert.match(updateBlock, /tx\.favoriteItem\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "favorite update must use a guarded write");
    assert.match(deleteBlock, /readOptionalIntegerValue\(record, \["rowVersion", "즐겨찾기RowVersion"\]\)/, "favorite delete must read displayed rowVersion");
    assert.match(deleteBlock, /tx\.favoriteItem\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "favorite delete must use a guarded write");
    assert.match(actionBlock, /즐겨찾기RowVersion/, "favorite action adapter must forward rowVersion metadata");
  });

  it("sends report and favorite rowVersion metadata from the frontend", () => {
    assert.match(mainSource, /function reportMutationKey/, "report UI must build idempotency keys");
    assert.match(mainSource, /idempotencyKey: reportMutationKey\("create"/, "report generation must send idempotency keys");
    assert.match(mainSource, /rowVersion: editingSchedule\.rowVersion/, "schedule edits must submit the displayed rowVersion");
    assert.match(mainSource, /idempotencyKey: reportScheduleMutationKey\(editingSchedule \? "update" : "create"/, "schedule saves must send idempotency keys");
    assert.match(mainSource, /idempotencyKey: reportScheduleMutationKey\(schedule\.isActive \? "pause" : "resume"/, "schedule toggles must send idempotency keys");
    assert.match(mainSource, /function favoriteMutationKey/, "favorite UI must build idempotency keys");
    assert.match(mainSource, /rowVersion: item\.rowVersion \?\? "1"[\s\S]*즐겨찾기RowVersion: item\.rowVersion \?\? "1"/, "favorite bulk saves must submit displayed rowVersion");
    assert.match(mainSource, /deletePageRow\("favorites", selectedFavorite\.title, \{[\s\S]*idempotencyKey: favoriteMutationKey\("delete", selectedFavorite\)/, "favorite delete must submit idempotency and rowVersion metadata");
    assert.match(mainSource, /favoriteFromRow\(response\.data/, "favorite mutations must refresh local rowVersion from API responses");
  });
});
