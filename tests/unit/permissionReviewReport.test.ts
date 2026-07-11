import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const operationsRoute = read("backend/src/routes/operations.ts");
const permissionReview = read("backend/src/operations/permissionReviewReport.ts");
const service = read("src/api/service.ts");
const mockService = read("src/api/mockService.ts");
const main = read("src/main.tsx");
const apiSpec = read("docs/api-spec.md");
const adminManual = read("docs/admin-manual.md");

describe("permission review report", () => {
  it("exposes a guarded backend operations endpoint", () => {
    const route = operationsRoute.match(/app\.get\("\/operations\/permission-review"[\s\S]*?app\.get\("\/operations\/audit-logs"/)?.[0] ?? "";

    assert.match(route, /requireAuth\(request, reply\)/);
    assert.match(route, /hasPermission\(user, "system:manage"\)/);
    assert.match(route, /hasPermission\(user, "audit:read"\)/);
    assert.match(route, /getPermissionReviewReport\(\)/);
    assert.match(route, /reply\.send\(success\(request, report\)\)/);
  });

  it("tracks high-risk permissions and exception expiry states", () => {
    assert.match(permissionReview, /highRiskPermissionLabels[\s\S]*"system:manage"[\s\S]*"disbursement:execute"[\s\S]*"audit:read"/);
    assert.ok(permissionReview.includes("const exceptionPattern = /^exception:(.+):(\\d{4}-\\d{2}-\\d{2})$/;"));
    assert.match(permissionReview, /"expiry_missing" \| "expired" \| "expiring" \| "current"/);
    assert.match(permissionReview, /entityType: "permission_review"/);
    assert.match(permissionReview, /Role\.permissions exception:\$\{permission\}/);
  });

  it("wires remote, mock, and settings UI consumers", () => {
    assert.match(service, /export type PermissionReviewReport/);
    assert.match(service, /getPermissionReviewReport\(\): Promise<MockApiResponse<PermissionReviewReport>>/);
    assert.match(service, /requestRemote<PermissionReviewReport>\("\/operations\/permission-review"\)/);
    assert.match(mockService, /function buildMockPermissionReviewReport\(\): PermissionReviewReport/);
    assert.match(mockService, /async getPermissionReviewReport\(\)/);
    assert.match(main, /function PermissionReviewReportCard/);
    assert.match(main, /erpApi\.getPermissionReviewReport\(\)/);
    assert.match(main, /refreshPermissionReviewReport\(false\)/);
  });

  it("preserves exception expiry markers during role permission edits", () => {
    assert.match(main, /permissionExceptionPattern = \/\^exception:\.\+:\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
    assert.match(main, /function isPermissionExceptionCode/);
    assert.match(main, /const exceptionCodes = clean\.filter\(isPermissionExceptionCode\)/);
    assert.match(main, /return directCodes\.includes\("\*"\) \? \["\*", \.\.\.exceptionCodes\]/);
  });

  it("documents the operation for administrators and API consumers", () => {
    assert.match(apiSpec, /`GET` \| `\/operations\/permission-review`/);
    assert.match(apiSpec, /`exception:<permission>:YYYY-MM-DD`/);
    assert.match(adminManual, /정기 권한 검토 리포트/);
    assert.match(adminManual, /permission_review/);
  });
});
