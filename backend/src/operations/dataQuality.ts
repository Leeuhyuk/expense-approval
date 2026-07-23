import { Prisma, type PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";

export type DataQualitySeverity = "warning" | "critical";

export type DataQualityCheck = {
  id: string;
  label: string;
  ok: boolean;
  severity: DataQualitySeverity;
  count: number;
  detail: string;
  sample?: string[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function check(input: Omit<DataQualityCheck, "ok">): DataQualityCheck {
  return { ...input, ok: input.count === 0 };
}

function sample(values: string[], limit = 5) {
  return values.slice(0, limit);
}

function testDataPattern() {
  return /(example\.(local|test)|통합테스트|샘플|sample|test user|test vendor|테스트계정)/i;
}

async function rawCount(db: Pick<PrismaClient, "$queryRaw">, query: Prisma.Sql) {
  const rows = await db.$queryRaw<Array<{ count: bigint | number }>>(query);
  return Number(rows[0]?.count ?? 0);
}

async function attachmentOwnerCounts(db: Pick<PrismaClient, "$queryRaw">) {
  const [orphanPaymentAttachments, orphanVendorAttachments, submittedRequestsWithoutCleanAttachment] = await Promise.all([
    rawCount(
      db,
      Prisma.sql`select count(*)::int as count
       from "attachments" a
       where a."ownerType" = 'PAYMENT_REQUEST'
       and not exists (select 1 from "payment_requests" pr where pr."id" = a."ownerId")`,
    ),
    rawCount(
      db,
      Prisma.sql`select count(*)::int as count
       from "attachments" a
       where a."ownerType" = 'VENDOR'
       and not exists (select 1 from "vendors" v where v."id" = a."ownerId")`,
    ),
    rawCount(
      db,
      Prisma.sql`select count(*)::int as count
       from "payment_requests" pr
       where pr."status" in ('SUBMITTED', 'APPROVAL_PENDING', 'APPROVAL_IN_PROGRESS')
       and not exists (
         select 1
         from "attachments" a
         where a."ownerType" = 'PAYMENT_REQUEST'
         and a."ownerId" = pr."id"
         and a."checksum" <> 'pending'
         and a."checksum" not like 'blocked:%'
       )`,
    ),
  ]);
  return { orphanPaymentAttachments, orphanVendorAttachments, submittedRequestsWithoutCleanAttachment };
}

export async function getDataQualitySummary(db: Pick<
  PrismaClient,
  "$queryRaw" | "department" | "user" | "role" | "vendor" | "budget" | "budgetItem" | "paymentRequest" | "approvalStep" | "disbursement" | "attachment"
> = prisma) {
  const [
    departments,
    users,
    roles,
    vendors,
    budgets,
    budgetItems,
    paymentRequests,
    approvalSteps,
    disbursements,
    attachmentCount,
    attachmentCounts,
  ] = await Promise.all([
    db.department.findMany({ select: { id: true, name: true, isActive: true } }),
    db.user.findMany({ select: { id: true, name: true, email: true, isActive: true, department: { select: { isActive: true, name: true } }, roles: { select: { roleId: true } } } }),
    db.role.findMany({ select: { id: true, code: true, name: true, permissions: true, isActive: true } }),
    db.vendor.findMany({
      select: {
        id: true,
        name: true,
        businessNumber: true,
        isActive: true,
        bankName: true,
        bankAccountEncrypted: true,
        bankAccountMasked: true,
        taxInvoiceEmail: true,
        accountVerificationStatus: true,
      },
    }),
    db.budget.findMany({ select: { id: true, fiscalYear: true, allocatedAmount: true, usedAmount: true, status: true, department: { select: { name: true, isActive: true } } } }),
    db.budgetItem.findMany({ select: { id: true, name: true, allocatedAmount: true, usedAmount: true, status: true, budget: { select: { fiscalYear: true, department: { select: { name: true } } } } } }),
    db.paymentRequest.findMany({ select: { id: true, requestCode: true, status: true, amount: true, budgetItemId: true, requester: { select: { email: true, isActive: true } }, vendor: { select: { name: true, isActive: true } }, department: { select: { name: true, isActive: true } }, approvalSteps: { select: { id: true, status: true } } } }),
    db.approvalStep.findMany({ select: { id: true, status: true, paymentRequestId: true, approver: { select: { email: true, isActive: true } } } }),
    db.disbursement.findMany({ select: { id: true, disbursementCode: true, status: true, amount: true, paymentRequestId: true, vendor: { select: { name: true, isActive: true } } } }),
    db.attachment.count(),
    attachmentOwnerCounts(db),
  ]);

  const activeUsersWithoutRoles = users.filter((user) => user.isActive && user.roles.length === 0);
  const activeUsersInInactiveDepartments = users.filter((user) => user.isActive && !user.department.isActive);
  const activeRolesWithoutPermissions = roles.filter((role) => role.isActive && (!Array.isArray(role.permissions) || role.permissions.length === 0));
  const activeVendors = vendors.filter((vendor) => vendor.isActive);
  const activeVendorsMissingBankData = activeVendors.filter((vendor) => !vendor.bankName.trim() || !vendor.bankAccountEncrypted.startsWith("v1:") || !vendor.bankAccountMasked.includes("****"));
  const activeVendorsUnverified = activeVendors.filter((vendor) => vendor.accountVerificationStatus !== "VERIFIED");
  const activeVendorsMissingTaxEmail = activeVendors.filter((vendor) => !vendor.taxInvoiceEmail.trim());
  const vendorNameCounts = activeVendors.reduce<Record<string, number>>((acc, vendor) => {
    acc[vendor.name] = (acc[vendor.name] ?? 0) + 1;
    return acc;
  }, {});
  const duplicateVendorNames = Object.entries(vendorNameCounts).filter(([, count]) => count > 1).map(([name]) => name);
  const budgetsOverAllocated = budgets.filter((budget) => numberValue(budget.usedAmount) > numberValue(budget.allocatedAmount));
  const budgetItemsOverAllocated = budgetItems.filter((item) => numberValue(item.usedAmount) > numberValue(item.allocatedAmount));
  const openStatuses = new Set(["SUBMITTED", "APPROVAL_PENDING", "APPROVAL_IN_PROGRESS"]);
  const openRequestsMissingBudget = paymentRequests.filter((request) => openStatuses.has(request.status) && !request.budgetItemId);
  const openRequestsInactiveReferences = paymentRequests.filter((request) => openStatuses.has(request.status) && (!request.requester.isActive || !request.vendor.isActive || !request.department.isActive));
  const openRequestsWithoutApprovalSteps = paymentRequests.filter((request) => openStatuses.has(request.status) && request.approvalSteps.length === 0);
  const approvedRequestsWithPendingSteps = paymentRequests.filter((request) => request.status === "APPROVED" && request.approvalSteps.some((step) => step.status === "PENDING"));
  const approvalStepsWithInactiveApprover = approvalSteps.filter((step) => step.status === "PENDING" && !step.approver.isActive);
  const openDisbursementsInactiveVendor = disbursements.filter((item) => ["SCHEDULED", "DUE_TODAY", "HELD", "ERROR"].includes(item.status) && !item.vendor.isActive);
  const pattern = testDataPattern();
  const testDataUsers = users.filter((user) => pattern.test(user.email) || pattern.test(user.name));
  const testDataVendors = vendors.filter((vendor) => pattern.test(vendor.name) || pattern.test(vendor.businessNumber));
  const testDataDepartments = departments.filter((department) => pattern.test(department.name));

  const checks: DataQualityCheck[] = [
    check({ id: "active_users_without_roles", label: "Active users without roles", severity: "critical", count: activeUsersWithoutRoles.length, detail: "활성 사용자는 최소 1개 이상의 권한 그룹이 필요합니다.", sample: sample(activeUsersWithoutRoles.map((user) => user.email)) }),
    check({ id: "active_users_in_inactive_departments", label: "Active users in inactive departments", severity: "critical", count: activeUsersInInactiveDepartments.length, detail: "활성 사용자가 비활성 부서에 남아 있으면 권한/보고 범위가 어긋납니다.", sample: sample(activeUsersInInactiveDepartments.map((user) => user.email)) }),
    check({ id: "active_roles_without_permissions", label: "Active roles without permissions", severity: "critical", count: activeRolesWithoutPermissions.length, detail: "활성 권한 그룹은 명시적 permission 목록이 필요합니다.", sample: sample(activeRolesWithoutPermissions.map((role) => role.code)) }),
    check({ id: "active_vendors_missing_bank_data", label: "Active vendors missing encrypted bank data", severity: "critical", count: activeVendorsMissingBankData.length, detail: "활성 거래처는 은행명, v1 암호화 계좌, 마스킹 계좌가 필요합니다.", sample: sample(activeVendorsMissingBankData.map((vendor) => vendor.name)) }),
    check({ id: "active_vendors_unverified", label: "Active vendors with unverified accounts", severity: "warning", count: activeVendorsUnverified.length, detail: "활성 거래처 중 계좌 확인이 완료되지 않은 건은 지급 전 검증 대상입니다.", sample: sample(activeVendorsUnverified.map((vendor) => vendor.name)) }),
    check({ id: "active_vendors_missing_tax_email", label: "Active vendors missing tax invoice email", severity: "warning", count: activeVendorsMissingTaxEmail.length, detail: "세금계산서 수신 이메일이 없는 활성 거래처를 확인해야 합니다.", sample: sample(activeVendorsMissingTaxEmail.map((vendor) => vendor.name)) }),
    check({ id: "duplicate_active_vendor_names", label: "Duplicate active vendor names", severity: "warning", count: duplicateVendorNames.length, detail: "사업자번호는 고유하지만 같은 거래처명이 중복되면 화면/정산 대사 혼선이 생길 수 있습니다.", sample: sample(duplicateVendorNames) }),
    check({ id: "budgets_over_allocated", label: "Budgets over allocated amount", severity: "critical", count: budgetsOverAllocated.length, detail: "예산 사용액이 배정액을 초과한 예산을 확인해야 합니다.", sample: sample(budgetsOverAllocated.map((budget) => `${budget.department.name}/${budget.fiscalYear}`)) }),
    check({ id: "budget_items_over_allocated", label: "Budget items over allocated amount", severity: "critical", count: budgetItemsOverAllocated.length, detail: "예산 항목 사용액이 배정액을 초과한 항목을 확인해야 합니다.", sample: sample(budgetItemsOverAllocated.map((item) => `${item.budget.department.name}/${item.name}`)) }),
    check({ id: "open_requests_missing_budget", label: "Open payment requests missing budget item", severity: "critical", count: openRequestsMissingBudget.length, detail: "열린 결제 요청은 예산 항목과 연결되어야 합니다.", sample: sample(openRequestsMissingBudget.map((request) => request.requestCode)) }),
    check({ id: "open_requests_inactive_references", label: "Open payment requests with inactive references", severity: "critical", count: openRequestsInactiveReferences.length, detail: "열린 결제 요청이 비활성 사용자/부서/거래처를 참조합니다.", sample: sample(openRequestsInactiveReferences.map((request) => request.requestCode)) }),
    check({ id: "open_requests_without_approval_steps", label: "Open payment requests without approval steps", severity: "critical", count: openRequestsWithoutApprovalSteps.length, detail: "제출/승인 진행 중 결제 요청에는 결재 단계가 필요합니다.", sample: sample(openRequestsWithoutApprovalSteps.map((request) => request.requestCode)) }),
    check({ id: "submitted_requests_without_clean_attachment", label: "Submitted requests without clean attachment", severity: "critical", count: attachmentCounts.submittedRequestsWithoutCleanAttachment, detail: "제출된 결제 요청은 보안 검사를 통과한 첨부가 1개 이상 필요합니다." }),
    check({ id: "approved_requests_with_pending_steps", label: "Approved requests with pending approval steps", severity: "critical", count: approvedRequestsWithPendingSteps.length, detail: "승인 완료 요청에 대기 결재 단계가 남아 있으면 상태 정합성이 깨진 것입니다.", sample: sample(approvedRequestsWithPendingSteps.map((request) => request.requestCode)) }),
    check({ id: "pending_steps_with_inactive_approver", label: "Pending approval steps with inactive approver", severity: "critical", count: approvalStepsWithInactiveApprover.length, detail: "대기 결재 단계의 승인자가 비활성이면 결재가 멈춥니다.", sample: sample(approvalStepsWithInactiveApprover.map((step) => step.id)) }),
    check({ id: "open_disbursements_inactive_vendor", label: "Open disbursements with inactive vendor", severity: "critical", count: openDisbursementsInactiveVendor.length, detail: "열린 지급 건이 비활성 거래처를 참조합니다.", sample: sample(openDisbursementsInactiveVendor.map((item) => item.disbursementCode)) }),
    check({ id: "orphan_payment_attachments", label: "Orphan payment request attachments", severity: "critical", count: attachmentCounts.orphanPaymentAttachments, detail: "결제 요청 소유 첨부가 존재하지 않는 요청을 가리킵니다." }),
    check({ id: "orphan_vendor_attachments", label: "Orphan vendor attachments", severity: "critical", count: attachmentCounts.orphanVendorAttachments, detail: "거래처 소유 첨부가 존재하지 않는 거래처를 가리킵니다." }),
    check({ id: "production_test_data_markers", label: "Production test data markers", severity: "critical", count: testDataUsers.length + testDataVendors.length + testDataDepartments.length, detail: "운영 데이터에 example.local/example.test/통합테스트/샘플 식별자가 남아 있으면 안 됩니다.", sample: sample([...testDataUsers.map((user) => user.email), ...testDataVendors.map((vendor) => vendor.name), ...testDataDepartments.map((department) => department.name)]) }),
  ];

  const criticalFailures = checks.filter((item) => !item.ok && item.severity === "critical");
  const warningFailures = checks.filter((item) => !item.ok && item.severity === "warning");
  const paymentAmountsByStatus = paymentRequests.reduce<Record<string, { count: number; amount: number }>>((acc, request) => {
    const current = acc[request.status] ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += numberValue(request.amount);
    acc[request.status] = current;
    return acc;
  }, {});
  const disbursementAmountsByStatus = disbursements.reduce<Record<string, { count: number; amount: number }>>((acc, item) => {
    const current = acc[item.status] ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += numberValue(item.amount);
    acc[item.status] = current;
    return acc;
  }, {});
  const totalBudgetAllocated = budgets.reduce((sum, budget) => sum + numberValue(budget.allocatedAmount), 0);
  const totalBudgetUsed = budgets.reduce((sum, budget) => sum + numberValue(budget.usedAmount), 0);

  return {
    ok: criticalFailures.length === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      departments: departments.length,
      users: users.length,
      roles: roles.length,
      vendors: vendors.length,
      activeVendors: activeVendors.length,
      budgets: budgets.length,
      budgetItems: budgetItems.length,
      paymentRequests: paymentRequests.length,
      approvalSteps: approvalSteps.length,
      disbursements: disbursements.length,
      attachments: attachmentCount,
      totalBudgetAllocated,
      totalBudgetUsed,
      totalBudgetRemaining: totalBudgetAllocated - totalBudgetUsed,
      paymentAmountsByStatus,
      disbursementAmountsByStatus,
    },
    checks,
    criticalFailures,
    warningFailures,
  };
}
