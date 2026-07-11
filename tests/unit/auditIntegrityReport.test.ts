import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const operationsRoute = read("backend/src/routes/operations.ts");
const auditIntegrityReport = read("backend/src/operations/auditIntegrityReport.ts");
const service = read("src/api/service.ts");
const mockService = read("src/api/mockService.ts");
const main = read("src/main.tsx");
const apiSpec = read("docs/api-spec.md");
const adminManual = read("docs/admin-manual.md");
const deploymentOperations = read("docs/deployment-operations.md");

describe("audit integrity report", () => {
  it("exposes a guarded backend operations endpoint", () => {
    const route = operationsRoute.match(/app\.get\("\/operations\/audit-integrity-report"[\s\S]*?app\.get\("\/operations\/audit-logs"/)?.[0] ?? "";

    assert.match(route, /requireAuth\(request, reply\)/);
    assert.match(route, /hasPermission\(user, "system:manage"\)/);
    assert.match(route, /hasPermission\(user, "audit:read"\)/);
    assert.match(route, /getAuditIntegrityReport\(\)/);
    assert.match(route, /reply\.send\(success\(request, report\)\)/);
  });

  it("builds a deterministic sha256 hash chain without returning raw values", () => {
    assert.match(auditIntegrityReport, /createHash\(hashAlgorithm\)/);
    assert.match(auditIntegrityReport, /const hashAlgorithm = "sha256"/);
    assert.match(auditIntegrityReport, /version: hashChainVersion/);
    assert.match(auditIntegrityReport, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
    assert.match(auditIntegrityReport, /payloadHash/);
    assert.match(auditIntegrityReport, /previousHash/);
    assert.match(auditIntegrityReport, /recordHash/);
    assert.match(auditIntegrityReport, /AUDIT_ARCHIVE_ENDPOINT/);
    assert.match(auditIntegrityReport, /AUDIT_ARCHIVE_BUCKET/);
    assert.match(auditIntegrityReport, /sampledLinks: sampleLinks\(links\)/);
    assert.match(auditIntegrityReport, /beforeValue\/afterValue 원문 JSON을 응답하지 않고/);
  });

  it("wires remote, mock, and settings UI consumers", () => {
    assert.match(service, /export type AuditIntegrityReport/);
    assert.match(service, /getAuditIntegrityReport\(\): Promise<MockApiResponse<AuditIntegrityReport>>/);
    assert.match(service, /requestRemote<AuditIntegrityReport>\("\/operations\/audit-integrity-report"\)/);
    assert.match(mockService, /function buildMockAuditIntegrityReport\(\): AuditIntegrityReport/);
    assert.match(mockService, /async getAuditIntegrityReport\(\)/);
    assert.match(main, /function AuditIntegrityReportCard/);
    assert.match(main, /erpApi\.getAuditIntegrityReport\(\)/);
    assert.match(main, /<AuditIntegrityReportCard/);
  });

  it("documents the operation for administrators and deployment operators", () => {
    assert.match(apiSpec, /`GET` \| `\/operations\/audit-integrity-report`/);
    assert.match(apiSpec, /payloadHash.*previousHash.*recordHash/);
    assert.match(adminManual, /감사 로그 무결성 리포트/);
    assert.match(deploymentOperations, /AUDIT_ARCHIVE_ENDPOINT/);
    assert.match(deploymentOperations, /AUDIT_ARCHIVE_BUCKET/);
  });
});
