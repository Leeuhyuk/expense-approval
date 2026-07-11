import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const routeSource = readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");

describe("vendor persistence flow", () => {
  it("persists vendor create and update changes through backend transactions and audit logs", () => {
    assert.match(routeSource, /app\.post\("\/vendors"/, "vendor create route must exist");
    assert.match(routeSource, /app\.patch\("\/vendors\/:vendorName"/, "vendor update route must exist");
    assert.match(routeSource, /tx\.vendor\.create/, "vendor create must write Vendor rows");
    assert.match(routeSource, /tx\.vendor\.updateMany\(\{ where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "vendor update must use a guarded rowVersion write");
    assert.match(routeSource, /tx\.vendor\.findUniqueOrThrow/, "vendor update must reread the persisted row after a guarded write");
    assert.match(routeSource, /createAudit\(tx, request, user, "vendor"[\s\S]*"create"/, "vendor create must be audited");
    assert.match(routeSource, /createAudit\(tx, request, user, "vendor"[\s\S]*"update"/, "vendor update must be audited");
    assert.match(routeSource, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "vendor mutations must detect duplicate idempotency keys");
    assert.match(routeSource, /expectedRowVersion !== before\.rowVersion/, "vendor updates must reject stale client rowVersion values");
    assert.match(routeSource, /IDEMPOTENCY_CONFLICT/, "vendor mutations must reject reused keys from other operations");
    assert.match(routeSource, /encryptBankAccount\(bankAccount\)/, "vendor bank accounts must be encrypted on create");
    assert.match(routeSource, /data\.bankAccountEncrypted = encryptBankAccount\(bankAccount\)/, "vendor bank accounts must be encrypted on update");
    assert.match(routeSource, /이미 등록된 거래처명 또는 사업자번호/, "backend must reject duplicate vendor identities");
  });

  it("delegates vendor deactivation to the audited update route", () => {
    assert.match(routeSource, /app\.delete\("\/vendors\/:vendorName"/, "vendor delete/deactivate route must exist");
    assert.match(routeSource, /payload: \{ 상태: "비활성", 작업사유: reason, rowVersion: String\(before\.rowVersion\), idempotencyKey \}/, "delete route must persist deactivation state with concurrency metadata");
    assert.match(routeSource, /app\.post\("\/vendors\/:vendorName\/:action"/, "vendor action route must exist");
    assert.match(routeSource, /params\.action === "deactivate"[\s\S]*상태: "비활성"/, "deactivate action must map to inactive status");
    assert.match(routeSource, /app\.inject\(\{[\s\S]*method: "PATCH"[\s\S]*\/api\/vendors\//, "vendor actions must delegate to PATCH for audit coverage");
  });

  it("calculates deactivation impact from payment and disbursement data on the server", () => {
    assert.match(routeSource, /const vendorActivePaymentStatuses = \[/, "backend must define active payment statuses for vendor impact");
    assert.match(routeSource, /const vendorOpenDisbursementStatuses = \[/, "backend must define open disbursement statuses for vendor impact");
    assert.match(routeSource, /async function getVendorDeactivationImpact/, "backend must calculate vendor deactivation impact");
    assert.match(routeSource, /tx\.paymentRequest\.count\(\{[\s\S]*vendorId[\s\S]*status: \{ in: vendorActivePaymentStatuses \}/, "impact must count active payment requests");
    assert.match(routeSource, /tx\.disbursement\.count\(\{[\s\S]*vendorId[\s\S]*status: \{ in: vendorOpenDisbursementStatuses \}/, "impact must count open disbursements");
    assert.match(routeSource, /비활성화영향요청: String\(impact\.activePaymentRequestCount\)/, "response row must include active payment request impact");
    assert.match(routeSource, /비활성화영향지급예약: String\(impact\.openDisbursementCount\)/, "response row must include open disbursement impact");
    assert.match(routeSource, /patch\.상태 === "비활성" \? await getVendorDeactivationImpact/, "deactivation updates must calculate impact in the update transaction");
  });

  it("keeps the vendor UI on API persistence and refresh after mutations", () => {
    assert.match(mainSource, /erpApi\.listPageRows\("vendors"/, "VendorBody must load vendor rows from the API");
    assert.match(mainSource, /erpApi\.createPageRow\("vendors", mutationPayload\)/, "new vendors must be created through the API");
    assert.match(mainSource, /erpApi\.updatePageRow\("vendors", draft\.originalName, mutationPayload\)/, "vendor edits must be updated through the API");
    assert.match(mainSource, /vendorRowVersion\(currentVendor\)/, "vendor edits must submit the displayed rowVersion");
    assert.match(mainSource, /idempotencyKey: vendorMutationKey\(isPendingVendor \? "create" : "update"/, "vendor saves must include idempotency keys");
    assert.match(mainSource, /erpApi\.executePageAction\("vendors", selectedVendor\.거래처명, "deactivate"/, "vendor deactivation must use the API action");
    assert.match(mainSource, /idempotencyKey: vendorMutationKey\("deactivate"/, "vendor deactivation must include idempotency keys");
    assert.match(mainSource, /idempotencyKey: vendorMutationKey\("verify"/, "vendor account verification must include idempotency keys");
    assert.match(mainSource, /setVendorRefreshVersion\(\(current\) => current \+ 1\)/, "vendor mutations must trigger a fresh API reload");
    assert.match(mainSource, /window\.dispatchEvent\(new CustomEvent\("erp:vendor-saved"/, "saved vendors must notify dependent forms to refresh master data");
    assert.match(mainSource, /setVendorSummary\(\{[\s\S]*registered: registered\.data\.total[\s\S]*pending: pending\.data\.total[\s\S]*verified: verified\.data\.total[\s\S]*inactive: inactive\.data\.total/, "vendor KPI cards must use server total counts");
    assert.match(mainSource, /const vendorKpis = page\.kpis\.map/, "vendor KPI cards must render the DB summary instead of static zero values");
    assert.match(mainSource, /isPending \? "등록" : "수정"/, "new vendor forms must label the save action as registration");
    assert.match(mainSource, /disabled=\{isEmpty \|\| isPending \|\| selected\.상태 === "비활성"\}/, "unsaved vendors must not expose deactivation");
  });

  it("shows deactivation impact from the API response instead of local fixtures", () => {
    assert.match(mainSource, /Number\(updatedVendor\.비활성화영향요청 \?\? "0"\)/, "UI must read active payment impact from backend response");
    assert.match(mainSource, /Number\(updatedVendor\.비활성화영향지급예약 \?\? "0"\)/, "UI must read disbursement impact from backend response");
    assert.match(mainSource, /서버 기준 진행 중 요청/, "deactivation message must identify the server-calculated impact");
  });
});
