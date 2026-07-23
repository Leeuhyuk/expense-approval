import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend report schedules", () => {
  const mainSource = () => readFileSync(resolve("src/main.tsx"), "utf8");
  const serviceSource = () => readFileSync(resolve("src/api/service.ts"), "utf8");
  const mockServiceSource = () => readFileSync(resolve("src/api/mockService.ts"), "utf8");
  const reportRoutesSource = () => readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");

  it("keeps report schedule buttons wired to erpApi", () => {
    const source = mainSource();
    assert.match(source, /erpApi\.listReportSchedules\(\)/, "report schedule list must load from the API");
    assert.match(source, /erpApi\.createReportSchedule\(input\)/, "report schedule add button must create through the API");
    assert.match(source, /erpApi\.updateReportSchedule\(editingScheduleId, input\)/, "report schedule edit must update through the API");
    assert.match(source, /erpApi\.updateReportSchedule\(schedule\.id, \{[\s\S]*isActive: !schedule\.isActive,[\s\S]*rowVersion: schedule\.rowVersion,[\s\S]*idempotencyKey: reportScheduleMutationKey\(schedule\.isActive \? "pause" : "resume", schedule\)/, "report schedule pause/resume must update through the API with concurrency metadata");
    assert.doesNotMatch(source, /useState<Array<\[string, string, string, boolean\]>>/, "report schedules must not be a browser-only tuple list");
  });

  it("keeps remote and mock services on the same schedule contract", () => {
    const service = serviceSource();
    assert.match(service, /listReportSchedules\(\): Promise<MockApiResponse<ReportScheduleDto\[\]>>/, "ErpApiService must expose schedule listing");
    assert.match(service, /createReportSchedule\(input: ReportScheduleInput\)/, "ErpApiService must expose schedule creation");
    assert.match(service, /updateReportSchedule\(scheduleId: string, patch: Partial<ReportScheduleInput>\)/, "ErpApiService must expose schedule updates");
    assert.match(service, /\/reports\/schedules\/\$\{encodeURIComponent\(scheduleId\)\}/, "remote service must call the schedule detail route");
    assert.match(mockServiceSource(), /mockReportScheduleStore/, "mock service must keep schedule state behind the API contract");
  });

  it("keeps backend schedule persistence audited and notification-backed", () => {
    const source = reportRoutesSource();
    assert.match(source, /app\.post\("\/reports\/schedules"/, "backend must expose schedule creation");
    assert.match(source, /app\.patch\("\/reports\/schedules\/:scheduleId"/, "backend must expose schedule updates");
    assert.match(source, /tx\.reportSchedule\.create/, "schedule creation must persist ReportSchedule");
    assert.match(source, /createAudit\(tx, request, user, "report_schedule"/, "schedule changes must write audit logs");
    assert.match(source, /tx\.notification\.create/, "schedule changes must enqueue an internal notification");
  });
});
