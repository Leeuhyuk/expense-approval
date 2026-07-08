import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

type MutationSpec = {
  label: string;
  sourcePath: string;
  sourcePattern: RegExp;
  docPattern: RegExp;
};

const requiredMutations: MutationSpec[] = [
  { label: "승인 처리", sourcePath: "backend/src/routes/approvals.ts", sourcePattern: /app\.patch\("\/approvals\/:requestCode"/, docPattern: /`PATCH`\s*\|\s*`\/approvals\/\{id\}`/ },
  { label: "승인 action adapter", sourcePath: "backend/src/routes/approvals.ts", sourcePattern: /app\.post\("\/approvals\/:requestCode\/:action"/, docPattern: /`POST`\s*\|\s*`\/approvals\/\{id\}\/\{action\}`/ },
  { label: "지급 변경", sourcePath: "backend/src/routes/disbursements.ts", sourcePattern: /app\.patch\("\/disbursements\/:disbursementCode"/, docPattern: /`PATCH`\s*\|\s*`\/disbursements\/\{id\}`/ },
  { label: "지급 실행 확인", sourcePath: "backend/src/routes/disbursements.ts", sourcePattern: /app\.post\("\/disbursements\/:disbursementCode\/execution-approval"/, docPattern: /`POST`\s*\|\s*`\/disbursements\/\{id\}\/execution-approval`/ },
  { label: "지급 action adapter", sourcePath: "backend/src/routes/disbursements.ts", sourcePattern: /app\.post\("\/disbursements\/:disbursementCode\/:action"/, docPattern: /`POST`\s*\|\s*`\/disbursements\/\{id\}\/\{action\}`/ },
  { label: "은행 결과 대사", sourcePath: "backend/src/routes/disbursements.ts", sourcePattern: /app\.post\("\/disbursements\/bank-result-reconcile"/, docPattern: /`POST`\s*\|\s*`\/disbursements\/bank-result-reconcile`/ },
  { label: "예산 등록", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/budgets"/, docPattern: /`POST`\s*\|\s*`\/budgets`/ },
  { label: "예산 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/budgets\/:departmentName"/, docPattern: /`PATCH`\s*\|\s*`\/budgets\/\{id\}`/ },
  { label: "예산 조정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/budgets\/:departmentName\/adjustments"/, docPattern: /`POST`\s*\|\s*`\/budgets\/\{id\}\/adjustments`/ },
  { label: "거래처 등록", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/vendors"/, docPattern: /`POST`\s*\|\s*`\/vendors`/ },
  { label: "거래처 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/vendors\/:vendorName"/, docPattern: /`PATCH`\s*\|\s*`\/vendors\/\{id\}`/ },
  { label: "거래처 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/vendors\/:vendorName"/, docPattern: /`DELETE`\s*\|\s*`\/vendors\/\{id\}`/ },
  { label: "거래처 action adapter", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/vendors\/:vendorName\/:action"/, docPattern: /`POST`\s*\|\s*`\/vendors\/\{id\}\/\{action\}`/ },
  { label: "보고서 생성", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/reports"/, docPattern: /`POST`\s*\|\s*`\/reports`/ },
  { label: "보고서 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/reports\/:reportName"/, docPattern: /`PATCH`\s*\|\s*`\/reports\/\{id\}`/ },
  { label: "보고서 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/reports\/:reportName"/, docPattern: /`DELETE`\s*\|\s*`\/reports\/\{id\}`/ },
  { label: "보고서 action adapter", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/reports\/:reportName\/:action"/, docPattern: /`POST`\s*\|\s*`\/reports\/\{id\}\/\{action\}`/ },
  { label: "보고서 예약 등록", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/reports\/schedules"/, docPattern: /`POST`\s*\|\s*`\/reports\/schedules`/ },
  { label: "보고서 예약 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/reports\/schedules\/:scheduleId"/, docPattern: /`PATCH`\s*\|\s*`\/reports\/schedules\/\{id\}`/ },
  { label: "보고서 예약 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/reports\/schedules\/:scheduleId"/, docPattern: /`DELETE`\s*\|\s*`\/reports\/schedules\/\{id\}`/ },
  { label: "설정 스냅샷 저장", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/settings\/config\/:settingKey"/, docPattern: /`PATCH`\s*\|\s*`\/settings\/config\/\{settingKey\}`/ },
  { label: "외부 연동 테스트", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/settings\/integrations\/:integrationId\/test"/, docPattern: /`POST`\s*\|\s*`\/settings\/integrations\/\{integrationId\}\/test`/ },
  { label: "권한 그룹 생성", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/settings\/roles"/, docPattern: /`POST`\s*\|\s*`\/settings\/roles`/ },
  { label: "권한 그룹 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/settings\/roles\/:roleId"/, docPattern: /`PATCH`\s*\|\s*`\/settings\/roles\/\{id\}`/ },
  { label: "권한 그룹 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/settings\/roles\/:roleId"/, docPattern: /`DELETE`\s*\|\s*`\/settings\/roles\/\{id\}`/ },
  { label: "사용자 권한 생성", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/settings"/, docPattern: /`POST`\s*\|\s*`\/settings`/ },
  { label: "사용자 권한 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/settings\/:userName"/, docPattern: /`PATCH`\s*\|\s*`\/settings\/\{userName\}`/ },
  { label: "사용자 권한 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/settings\/:userName"/, docPattern: /`DELETE`\s*\|\s*`\/settings\/\{userName\}`/ },
  { label: "사용자 권한 action adapter", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/settings\/:userName\/:action"/, docPattern: /`POST`\s*\|\s*`\/settings\/\{userName\}\/\{action\}`/ },
  { label: "즐겨찾기 생성", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/favorites"/, docPattern: /`POST`\s*\|\s*`\/favorites`/ },
  { label: "즐겨찾기 수정", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.patch\("\/favorites\/:label"/, docPattern: /`PATCH`\s*\|\s*`\/favorites\/\{label\}`/ },
  { label: "즐겨찾기 삭제", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.delete\("\/favorites\/:label"/, docPattern: /`DELETE`\s*\|\s*`\/favorites\/\{label\}`/ },
  { label: "즐겨찾기 action adapter", sourcePath: "backend/src/routes/pageResources.ts", sourcePattern: /app\.post\("\/favorites\/:label\/:action"/, docPattern: /`POST`\s*\|\s*`\/favorites\/\{label\}\/\{action\}`/ },
];

describe("API mutation spec coverage", () => {
  const docs = readFileSync(resolve("docs/api-spec.md"), "utf8");

  for (const route of requiredMutations) {
    it(`documents and implements ${route.label}`, () => {
      const routeSource = readFileSync(resolve(route.sourcePath), "utf8");
      assert.match(routeSource, route.sourcePattern, `${route.label} route must be implemented`);
      assert.match(docs, route.docPattern, `${route.label} must be documented in docs/api-spec.md`);
    });
  }
});
