import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const atomicAuditRoutes = [
  ["backend/src/routes/paymentRequests.ts", 'app.post("/payment-requests"', "결제 요청 생성"],
  ["backend/src/routes/paymentRequests.ts", 'app.patch("/payment-requests/:requestCode"', "결제 요청 수정"],
  ["backend/src/routes/approvals.ts", 'app.patch("/approvals/:requestCode"', "승인 처리"],
  ["backend/src/routes/disbursements.ts", 'app.post("/disbursements/bank-result-reconcile"', "은행 결과 대사"],
  ["backend/src/routes/disbursements.ts", 'app.patch("/disbursements/:disbursementCode"', "지급 변경"],
  ["backend/src/routes/files.ts", 'app.post("/files/presign-upload"', "파일 업로드 사전 등록"],
  ["backend/src/routes/files.ts", 'app.post("/files/complete"', "파일 업로드 완료"],
  ["backend/src/routes/files.ts", 'app.delete("/files/:id"', "파일 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/budgets"', "예산 등록"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/budgets/:departmentName"', "예산 수정"],
  ["backend/src/routes/pageResources.ts", 'app.post("/budgets/:departmentName/adjustments"', "예산 조정"],
  ["backend/src/routes/pageResources.ts", 'app.post("/vendors"', "거래처 등록"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/vendors/:vendorName"', "거래처 수정"],
  ["backend/src/routes/pageResources.ts", 'app.post("/reports",', "보고서 생성"],
  ["backend/src/routes/pageResources.ts", 'app.post("/reports/schedules"', "보고서 예약 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/reports/:reportName"', "보고서 수정"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/reports/schedules/:scheduleId"', "보고서 예약 수정"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/reports/:reportName"', "보고서 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/reports/schedules/:scheduleId"', "보고서 예약 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings/roles"', "권한 그룹 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/settings/roles/:roleId"', "권한 그룹 수정"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/settings/roles/:roleId"', "권한 그룹 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings"', "사용자 권한 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/settings/:userName"', "사용자 권한 수정"],
  ["backend/src/routes/pageResources.ts", 'app.post("/favorites"', "즐겨찾기 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/favorites/:label"', "즐겨찾기 수정"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/favorites/:label"', "즐겨찾기 삭제"],
] as const;

const auditOnlyRoutes = [
  ["backend/src/routes/disbursements.ts", 'app.get("/disbursements/bank-transfer-export"', "은행 이체 파일 생성"],
  ["backend/src/routes/disbursements.ts", 'app.post("/disbursements/:disbursementCode/execution-approval"', "지급 실행 2인 확인"],
  ["backend/src/routes/pageResources.ts", 'app.get("/reports/:reportName/download"', "보고서 다운로드"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/settings/config/:settingKey"', "시스템 설정 저장"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings/integrations/:integrationId/test"', "외부 연동 테스트"],
] as const;

const delegatedMutationRoutes = [
  ["backend/src/routes/paymentRequests.ts", 'app.post("/payment-requests/:requestCode/:action"', "결제 요청 액션"],
  ["backend/src/routes/approvals.ts", 'app.post("/approvals/:requestCode/:action"', "승인 액션"],
  ["backend/src/routes/disbursements.ts", 'app.post("/disbursements/:disbursementCode/:action"', "지급 액션"],
  ["backend/src/routes/pageResources.ts", 'app.post("/budgets/:departmentName/:action"', "예산 액션"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/vendors/:vendorName"', "거래처 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/vendors/:vendorName/:action"', "거래처 액션"],
  ["backend/src/routes/pageResources.ts", 'app.post("/reports/:reportName/:action"', "보고서 액션"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/settings/:userName"', "사용자 비활성화"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings/:userName/:action"', "사용자 권한 액션"],
  ["backend/src/routes/pageResources.ts", 'app.post("/favorites/:label/:action"', "즐겨찾기 액션"],
] as const;

function routeBlock(filePath: string, routeSignature: string) {
  const source = readFileSync(resolve(filePath), "utf8");
  const start = source.indexOf(routeSignature);
  assert.notEqual(start, -1, `${routeSignature} route not found in ${filePath}`);
  const nextRoute = source.indexOf("\n  app.", start + routeSignature.length);
  return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

describe("backend audit log transaction coverage", () => {
  for (const [filePath, routeSignature, label] of atomicAuditRoutes) {
    it(`keeps ${label} data change and audit log in one transaction`, () => {
      const block = routeBlock(filePath, routeSignature);
      assert.match(block, /prisma\.\$transaction\(/, `${label} must use a Prisma transaction`);
      assert.match(block, /createAudit\(tx, request|tx\.auditLog\.create\(/, `${label} must write audit log through the transaction client`);
      assert.match(block, /auditRequestContext\(request\)|createAudit\(tx, request/, `${label} audit log must include request context`);
    });
  }

  for (const [filePath, routeSignature, label] of auditOnlyRoutes) {
    it(`keeps ${label} on audit log request context`, () => {
      const block = routeBlock(filePath, routeSignature);
      assert.match(block, /auditLog\.create\(/, `${label} must write an audit log entry`);
      assert.match(block, /auditRequestContext\(request\)/, `${label} audit log must include request context`);
    });
  }

  for (const [filePath, routeSignature, label] of delegatedMutationRoutes) {
    it(`keeps ${label} delegated to an audited route`, () => {
      const block = routeBlock(filePath, routeSignature);
      assert.match(block, /app\.inject\(/, `${label} must delegate to a canonical audited mutation route`);
    });
  }
});
