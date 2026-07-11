import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const operationsRoute = read("backend/src/routes/operations.ts");
const privacyReport = read("backend/src/operations/privacyAccessReport.ts");
const service = read("src/api/service.ts");
const mockService = read("src/api/mockService.ts");
const main = read("src/main.tsx");
const apiSpec = read("docs/api-spec.md");
const adminManual = read("docs/admin-manual.md");

describe("privacy access report", () => {
  it("exposes a guarded backend operations endpoint", () => {
    const route = operationsRoute.match(/app\.get\("\/operations\/privacy-access-report"[\s\S]*?app\.get\("\/operations\/audit-logs"/)?.[0] ?? "";

    assert.match(route, /requireAuth\(request, reply\)/);
    assert.match(route, /hasPermission\(user, "system:manage"\)/);
    assert.match(route, /hasPermission\(user, "audit:read"\)/);
    assert.match(route, /getPrivacyAccessReport\(\)/);
    assert.match(route, /reply\.send\(success\(request, report\)\)/);
  });

  it("summarizes privacy inventory and access events without raw values", () => {
    assert.match(privacyReport, /db\.user\.count/);
    assert.match(privacyReport, /db\.vendor\.count/);
    assert.match(privacyReport, /db\.attachment\.count/);
    assert.match(privacyReport, /action: "download_request"/);
    assert.match(privacyReport, /role: \{ code: "AUDITOR" \}/);
    assert.match(privacyReport, /beforeValue, afterValue, 계좌 원문, signed URL token을 반환하지 않습니다/);
    assert.doesNotMatch(privacyReport, /beforeValue: log\.beforeValue|afterValue: log\.afterValue/);
  });

  it("wires remote, mock, and settings UI consumers", () => {
    assert.match(service, /export type PrivacyAccessReport/);
    assert.match(service, /getPrivacyAccessReport\(\): Promise<MockApiResponse<PrivacyAccessReport>>/);
    assert.match(service, /requestRemote<PrivacyAccessReport>\("\/operations\/privacy-access-report"\)/);
    assert.match(mockService, /function buildMockPrivacyAccessReport\(\): PrivacyAccessReport/);
    assert.match(mockService, /async getPrivacyAccessReport\(\)/);
    assert.match(main, /function PrivacyAccessReportCard/);
    assert.match(main, /erpApi\.getPrivacyAccessReport\(\)/);
    assert.match(main, /<PrivacyAccessReportCard/);
  });

  it("documents the operation for administrators and API consumers", () => {
    assert.match(apiSpec, /`GET` \| `\/operations\/privacy-access-report`/);
    assert.match(apiSpec, /beforeValue.*afterValue.*signed URL token/);
    assert.match(adminManual, /개인정보 접근 리포트/);
    assert.match(adminManual, /계좌 원문/);
  });
});
