import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const routeFiles = [
  "backend/src/routes/approvals.ts",
  "backend/src/routes/auth.ts",
  "backend/src/routes/disbursements.ts",
  "backend/src/routes/files.ts",
  "backend/src/routes/health.ts",
  "backend/src/routes/notifications.ts",
  "backend/src/routes/operations.ts",
  "backend/src/routes/pageResources.ts",
  "backend/src/routes/paymentRequests.ts",
] as const;

const guardedRoutes = [
  ["backend/src/routes/paymentRequests.ts", 'app.post("/payment-requests"', "결제 요청 생성"],
  ["backend/src/routes/paymentRequests.ts", 'app.patch("/payment-requests/:requestCode"', "결제 요청 수정"],
  ["backend/src/routes/approvals.ts", 'app.patch("/approvals/:requestCode"', "승인 처리"],
  ["backend/src/routes/disbursements.ts", 'app.get("/disbursements/bank-transfer-export"', "은행 이체 파일 생성"],
  ["backend/src/routes/disbursements.ts", 'app.post("/disbursements/bank-result-reconcile"', "은행 결과 대사"],
  ["backend/src/routes/disbursements.ts", 'app.patch("/disbursements/:disbursementCode"', "지급 변경"],
  ["backend/src/routes/disbursements.ts", 'app.post("/disbursements/:disbursementCode/execution-approval"', "지급 실행 확인"],
  ["backend/src/routes/files.ts", 'app.post("/files/presign-upload"', "파일 업로드 URL 발급"],
  ["backend/src/routes/files.ts", 'app.post("/files/complete"', "파일 업로드 완료"],
  ["backend/src/routes/files.ts", 'app.delete("/files/:id"', "파일 삭제"],
  ["backend/src/routes/operations.ts", 'app.get("/operations/alerts"', "운영 알림 조회"],
  ["backend/src/routes/operations.ts", 'app.get("/operations/business-failure-alerts"', "업무 실패 알림 조회"],
  ["backend/src/routes/operations.ts", 'app.post("/operations/business-failure-alerts/notify"', "업무 실패 알림 발송"],
  ["backend/src/routes/operations.ts", 'app.get("/operations/data-quality"', "데이터 품질 점검"],
  ["backend/src/routes/pageResources.ts", 'app.get("/budgets/:departmentName/adjustments"', "예산 조정 이력 조회"],
  ["backend/src/routes/pageResources.ts", 'app.post("/budgets/:departmentName/adjustments"', "예산 조정"],
  ["backend/src/routes/pageResources.ts", 'app.get("/reports/:reportName/download"', "보고서 다운로드"],
  ["backend/src/routes/pageResources.ts", 'app.post("/reports/schedules"', "보고서 예약 등록"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/reports/schedules/:scheduleId"', "보고서 예약 수정"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/reports/schedules/:scheduleId"', "보고서 예약 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/vendors"', "거래처 등록"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/vendors/:vendorName"', "거래처 수정"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings/integrations/:integrationId/test"', "외부 연동 테스트"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings/roles"', "권한 그룹 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/settings/roles/:roleId"', "권한 그룹 수정"],
  ["backend/src/routes/pageResources.ts", 'app.delete("/settings/roles/:roleId"', "권한 그룹 삭제"],
  ["backend/src/routes/pageResources.ts", 'app.post("/settings"', "사용자 권한 생성"],
  ["backend/src/routes/pageResources.ts", 'app.patch("/settings/:userName"', "사용자 권한 수정"],
] as const;

function routeBlock(filePath: string, routeSignature: string) {
  const source = readFileSync(resolve(filePath), "utf8");
  const start = source.indexOf(routeSignature);
  assert.notEqual(start, -1, `${routeSignature} route not found in ${filePath}`);
  const nextRoute = source.indexOf("\n  app.", start + routeSignature.length);
  return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

function allRouteBlocks(filePath: string) {
  const source = readFileSync(resolve(filePath), "utf8");
  const matches = [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? source.length;
    return {
      method: match[1].toUpperCase(),
      path: match[2],
      block: source.slice(start, next),
      filePath,
    };
  });
}

function routeKey(method: string, path: string) {
  return `${method} ${path}`;
}

const publicRoutePatterns: Array<[RegExp, RegExp]> = [
  [/^GET \/health(\/.*)?$/, /success\(|checkDatabaseHealth|checkStorageHealth|checkFileSecurityHealth/],
  [/^POST \/auth\/login$/, /verifyPassword\(/],
  [/^POST \/auth\/logout$/, /clearSession\(/],
  [/^GET \/auth\/me$/, /getCurrentUser\(/],
  [/^POST \/auth\/refresh$/, /refreshSession\(/],
  [/^GET \/auth\/password-policy$/, /passwordPolicyPayload\(/],
  [/^POST \/auth\/password\/change-expired$/, /verifyPassword\(input\.data\.currentPassword/],
  [/^PUT \/files\/:id\/content$/, /verifyToken\([^)]*"upload"/],
  [/^GET \/files\/:id\/content$/, /verifyToken\([^)]*"download"/],
];

function publicRouteGuardPattern(method: string, path: string) {
  return publicRoutePatterns.find(([pattern]) => pattern.test(routeKey(method, path)))?.[1] ?? null;
}

describe("backend direct API permission guards", () => {
  it("keeps every backend route behind auth, health, or signed-token handling", () => {
    for (const route of routeFiles.flatMap(allRouteBlocks)) {
      const publicGuard = publicRouteGuardPattern(route.method, route.path);
      if (publicGuard) {
        assert.match(route.block, publicGuard, `${routeKey(route.method, route.path)} in ${route.filePath} must keep its explicit public/signed-token guard`);
        continue;
      }

      assert.match(
        route.block,
        /requireAuth\(|getCurrentUser\(|app\.inject\(/,
        `${routeKey(route.method, route.path)} in ${route.filePath} must authenticate direct API calls or delegate to a guarded route`,
      );
    }
  });

  for (const [filePath, routeSignature, label] of guardedRoutes) {
    it(`keeps a server-side permission guard on ${label}`, () => {
      const block = routeBlock(filePath, routeSignature);
      assert.match(block, /requireAuth\(/, `${label} route must authenticate direct API calls`);
      assert.match(block, /FORBIDDEN/, `${label} route must return FORBIDDEN when the authenticated user lacks permission`);
      assert.match(block, /hasPermission\(|can\(|canUpdate|canRead|canWrite/, `${label} route must evaluate a backend permission predicate`);
    });
  }
});
