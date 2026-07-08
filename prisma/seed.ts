import {
  AccountVerificationStatus,
  ApprovalStatus,
  BudgetAdjustmentStatus,
  BudgetStatus,
  DisbursementStatus,
  FavoriteKind,
  NotificationType,
  PaymentRequestStatus,
  PrismaClient,
  ReportRunStatus,
  ReportScheduleFrequency,
  ReportType,
  VendorStatus,
} from "../backend/generated/prisma/index.js";
import { defaultRolePolicies } from "../src/domain/rolePolicy.js";
import { assertSeedAllowed } from "./seedSafety.js";

assertSeedAllowed();

const prisma = new PrismaClient();

const ids = {
  departmentFinance: "10000000-0000-4000-8000-000000000001",
  departmentMarketing: "10000000-0000-4000-8000-000000000002",
  departmentIt: "10000000-0000-4000-8000-000000000003",
  roleRequester: "20000000-0000-4000-8000-000000000001",
  roleApprover: "20000000-0000-4000-8000-000000000002",
  roleFinance: "20000000-0000-4000-8000-000000000003",
  roleAdmin: "20000000-0000-4000-8000-000000000004",
  roleAuditor: "20000000-0000-4000-8000-000000000005",
  userMarketing: "30000000-0000-4000-8000-000000000001",
  userFinanceApprover: "30000000-0000-4000-8000-000000000002",
  userExecutiveApprover: "30000000-0000-4000-8000-000000000003",
  userIt: "30000000-0000-4000-8000-000000000004",
  vendorInnovation: "40000000-0000-4000-8000-000000000001",
  vendorCloud: "40000000-0000-4000-8000-000000000002",
  budgetMarketing: "50000000-0000-4000-8000-000000000001",
  budgetIt: "50000000-0000-4000-8000-000000000002",
  budgetItemMarketingSaas: "51000000-0000-4000-8000-000000000001",
  budgetItemItLicense: "51000000-0000-4000-8000-000000000002",
  budgetAdjustmentMarketing: "52000000-0000-4000-8000-000000000001",
  paymentCloudInfra: "60000000-0000-4000-8000-000000000001",
  paymentErpLicense: "60000000-0000-4000-8000-000000000002",
  paymentCampaignTool: "60000000-0000-4000-8000-000000000003",
  disbursementErpLicense: "70000000-0000-4000-8000-000000000001",
  attachmentCloudInvoice: "80000000-0000-4000-8000-000000000001",
  auditCloudSubmit: "90000000-0000-4000-8000-000000000001",
  auditErpApproved: "90000000-0000-4000-8000-000000000002",
  notificationApprovalRequested: "a0000000-0000-4000-8000-000000000001",
  notificationRejected: "a0000000-0000-4000-8000-000000000002",
  notificationHeld: "a0000000-0000-4000-8000-000000000003",
  notificationApproved: "a0000000-0000-4000-8000-000000000004",
  notificationDisbursementScheduled: "a0000000-0000-4000-8000-000000000005",
  notificationDisbursementCompleted: "a0000000-0000-4000-8000-000000000006",
  notificationBudgetExceeded: "a0000000-0000-4000-8000-000000000007",
  notificationApprovalDelayed: "a0000000-0000-4000-8000-000000000008",
  notificationSystemChanged: "a0000000-0000-4000-8000-000000000009",
  reportDefinitionMonthly: "b0000000-0000-4000-8000-000000000001",
  reportRunMonthly: "b0000000-0000-4000-8000-000000000002",
  reportScheduleMonthly: "b0000000-0000-4000-8000-000000000003",
  favoriteDashboard: "c0000000-0000-4000-8000-000000000001",
  favoriteApprovalFilter: "c0000000-0000-4000-8000-000000000002",
  favoriteMonthlyReport: "c0000000-0000-4000-8000-000000000003",
} as const;

const seedPasswordHash = "scrypt$16384$8$1$cGF5bWVudC1hcHByb3ZhbC1lcnAtZGV2LXNlZWQtdjE$9baODRHKiYUM3HsBbGTCjfEkVXcxLXgELss2Pj_P9qLF_VfP0vSlZ_1TZ5nRv8pcRJ871zTiWKnIGH6r2-bgEQ";

async function ensureUserRole(userId: string, roleId: string) {
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    update: {},
    create: { userId, roleId },
  });
}

const roleIds = {
  REQUESTER: ids.roleRequester,
  APPROVER: ids.roleApprover,
  FINANCE: ids.roleFinance,
  ADMIN: ids.roleAdmin,
  AUDITOR: ids.roleAuditor,
} as const;

async function main() {
  await prisma.department.upsert({
    where: { id: ids.departmentFinance },
    update: { name: "재무팀", isActive: true },
    create: { id: ids.departmentFinance, name: "재무팀" },
  });
  await prisma.department.upsert({
    where: { id: ids.departmentMarketing },
    update: { name: "마케팅팀", isActive: true },
    create: { id: ids.departmentMarketing, name: "마케팅팀" },
  });
  await prisma.department.upsert({
    where: { id: ids.departmentIt },
    update: { name: "IT운영팀", isActive: true },
    create: { id: ids.departmentIt, name: "IT운영팀" },
  });

  for (const role of defaultRolePolicies) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        permissions: role.permissions,
        isActive: true,
      },
      create: {
        id: roleIds[role.code],
        code: role.code,
        name: role.name,
        permissions: role.permissions,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: "lee.juyeon@example.local" },
    update: { name: "이주연", departmentId: ids.departmentMarketing, isActive: true },
    create: {
      id: ids.userMarketing,
      departmentId: ids.departmentMarketing,
      name: "이주연",
      email: "lee.juyeon@example.local",
      passwordHash: seedPasswordHash,
    },
  });
  await prisma.user.upsert({
    where: { email: "park.jungwoo@example.local" },
    update: { name: "박정우", departmentId: ids.departmentFinance, isActive: true },
    create: {
      id: ids.userFinanceApprover,
      departmentId: ids.departmentFinance,
      name: "박정우",
      email: "park.jungwoo@example.local",
      passwordHash: seedPasswordHash,
    },
  });
  await prisma.user.upsert({
    where: { email: "kim.minsu@example.local" },
    update: { name: "김민수", departmentId: ids.departmentFinance, isActive: true },
    create: {
      id: ids.userExecutiveApprover,
      departmentId: ids.departmentFinance,
      name: "김민수",
      email: "kim.minsu@example.local",
      passwordHash: seedPasswordHash,
    },
  });
  await prisma.user.upsert({
    where: { email: "choi.sora@example.local" },
    update: { name: "최소라", departmentId: ids.departmentIt, isActive: true },
    create: {
      id: ids.userIt,
      departmentId: ids.departmentIt,
      name: "최소라",
      email: "choi.sora@example.local",
      passwordHash: seedPasswordHash,
    },
  });

  await ensureUserRole(ids.userMarketing, ids.roleRequester);
  await ensureUserRole(ids.userIt, ids.roleRequester);
  await ensureUserRole(ids.userFinanceApprover, ids.roleApprover);
  await ensureUserRole(ids.userFinanceApprover, ids.roleFinance);
  await ensureUserRole(ids.userExecutiveApprover, ids.roleApprover);
  await ensureUserRole(ids.userExecutiveApprover, ids.roleAdmin);

  await prisma.vendor.upsert({
    where: { businessNumber: "110-81-00001" },
    update: {
      name: "이노베이션(주)",
      managerName: "박서준 팀장",
      bankName: "국민은행",
      bankAccountEncrypted: "seed:encrypted:innovation",
      bankAccountMasked: "123-****-8901",
      taxInvoiceEmail: "tax@innovation.example",
      taxInvoiceIssueType: "전자세금계산서 연동",
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      status: VendorStatus.ACTIVE,
      isActive: true,
    },
    create: {
      id: ids.vendorInnovation,
      name: "이노베이션(주)",
      businessNumber: "110-81-00001",
      managerName: "박서준 팀장",
      bankName: "국민은행",
      bankAccountEncrypted: "seed:encrypted:innovation",
      bankAccountMasked: "123-****-8901",
      taxInvoiceEmail: "tax@innovation.example",
      taxInvoiceIssueType: "전자세금계산서 연동",
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      status: VendorStatus.ACTIVE,
    },
  });
  await prisma.vendor.upsert({
    where: { businessNumber: "220-86-00002" },
    update: {
      name: "클라우드존(주)",
      managerName: "오지훈 매니저",
      bankName: "신한은행",
      bankAccountEncrypted: "seed:encrypted:cloudzone",
      bankAccountMasked: "088-****-1204",
      taxInvoiceEmail: "invoice@cloudzone.example",
      taxInvoiceIssueType: "이메일 발행",
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      status: VendorStatus.ACTIVE,
      isActive: true,
    },
    create: {
      id: ids.vendorCloud,
      name: "클라우드존(주)",
      businessNumber: "220-86-00002",
      managerName: "오지훈 매니저",
      bankName: "신한은행",
      bankAccountEncrypted: "seed:encrypted:cloudzone",
      bankAccountMasked: "088-****-1204",
      taxInvoiceEmail: "invoice@cloudzone.example",
      taxInvoiceIssueType: "이메일 발행",
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      status: VendorStatus.ACTIVE,
    },
  });

  await prisma.budget.upsert({
    where: { departmentId_fiscalYear: { departmentId: ids.departmentMarketing, fiscalYear: "2026" } },
    update: { allocatedAmount: "120000000", usedAmount: "38400000", status: BudgetStatus.NORMAL },
    create: {
      id: ids.budgetMarketing,
      departmentId: ids.departmentMarketing,
      fiscalYear: "2026",
      allocatedAmount: "120000000",
      usedAmount: "38400000",
      status: BudgetStatus.NORMAL,
    },
  });
  await prisma.budget.upsert({
    where: { departmentId_fiscalYear: { departmentId: ids.departmentIt, fiscalYear: "2026" } },
    update: { allocatedAmount: "180000000", usedAmount: "86200000", status: BudgetStatus.NORMAL },
    create: {
      id: ids.budgetIt,
      departmentId: ids.departmentIt,
      fiscalYear: "2026",
      allocatedAmount: "180000000",
      usedAmount: "86200000",
      status: BudgetStatus.NORMAL,
    },
  });

  await prisma.budgetItem.upsert({
    where: { id: ids.budgetItemMarketingSaas },
    update: { name: "광고/마케팅비", allocatedAmount: "48000000", usedAmount: "17200000", status: BudgetStatus.NORMAL },
    create: {
      id: ids.budgetItemMarketingSaas,
      budgetId: ids.budgetMarketing,
      name: "광고/마케팅비",
      allocatedAmount: "48000000",
      usedAmount: "17200000",
      status: BudgetStatus.NORMAL,
    },
  });
  await prisma.budgetItem.upsert({
    where: { id: ids.budgetItemItLicense },
    update: { name: "SW/IT 비용", allocatedAmount: "90000000", usedAmount: "48600000", status: BudgetStatus.NORMAL },
    create: {
      id: ids.budgetItemItLicense,
      budgetId: ids.budgetIt,
      name: "SW/IT 비용",
      allocatedAmount: "90000000",
      usedAmount: "48600000",
      status: BudgetStatus.NORMAL,
    },
  });

  await prisma.budgetAdjustment.upsert({
    where: { id: ids.budgetAdjustmentMarketing },
    update: {
      budgetId: ids.budgetMarketing,
      requestedBy: ids.userExecutiveApprover,
      amount: "5000000",
      reason: "마케팅 SaaS 예산 증액 운영 점검",
      requiresApproval: false,
      status: BudgetAdjustmentStatus.APPLIED,
      appliedAt: new Date("2026-07-03T10:00:00+09:00"),
    },
    create: {
      id: ids.budgetAdjustmentMarketing,
      budgetId: ids.budgetMarketing,
      requestedBy: ids.userExecutiveApprover,
      amount: "5000000",
      reason: "마케팅 SaaS 예산 증액 운영 점검",
      requiresApproval: false,
      status: BudgetAdjustmentStatus.APPLIED,
      appliedAt: new Date("2026-07-03T10:00:00+09:00"),
    },
  });

  const cloudInfraRequest = await prisma.paymentRequest.upsert({
    where: { requestCode: "PR-2026-0058" },
    update: {
      requesterId: ids.userMarketing,
      departmentId: ids.departmentMarketing,
      vendorId: ids.vendorCloud,
      budgetItemId: ids.budgetItemMarketingSaas,
      amount: "2450000",
      status: PaymentRequestStatus.APPROVAL_IN_PROGRESS,
      reason: "클라우드 인프라 월 사용료 정산",
      requestedAt: new Date("2026-07-02T09:30:00+09:00"),
    },
    create: {
      id: ids.paymentCloudInfra,
      requestCode: "PR-2026-0058",
      requesterId: ids.userMarketing,
      departmentId: ids.departmentMarketing,
      vendorId: ids.vendorCloud,
      budgetItemId: ids.budgetItemMarketingSaas,
      amount: "2450000",
      status: PaymentRequestStatus.APPROVAL_IN_PROGRESS,
      reason: "클라우드 인프라 월 사용료 정산",
      requestedAt: new Date("2026-07-02T09:30:00+09:00"),
    },
  });

  const erpLicenseRequest = await prisma.paymentRequest.upsert({
    where: { requestCode: "PR-2026-0057" },
    update: {
      requesterId: ids.userIt,
      departmentId: ids.departmentIt,
      vendorId: ids.vendorInnovation,
      budgetItemId: ids.budgetItemItLicense,
      amount: "7800000",
      status: PaymentRequestStatus.APPROVED,
      reason: "ERP 라이선스 연장 계약",
      requestedAt: new Date("2026-07-01T14:20:00+09:00"),
    },
    create: {
      id: ids.paymentErpLicense,
      requestCode: "PR-2026-0057",
      requesterId: ids.userIt,
      departmentId: ids.departmentIt,
      vendorId: ids.vendorInnovation,
      budgetItemId: ids.budgetItemItLicense,
      amount: "7800000",
      status: PaymentRequestStatus.APPROVED,
      reason: "ERP 라이선스 연장 계약",
      requestedAt: new Date("2026-07-01T14:20:00+09:00"),
    },
  });

  const campaignToolRequest = await prisma.paymentRequest.upsert({
    where: { requestCode: "PR-2026-0056" },
    update: {
      requesterId: ids.userMarketing,
      departmentId: ids.departmentMarketing,
      vendorId: ids.vendorCloud,
      budgetItemId: ids.budgetItemMarketingSaas,
      amount: "980000",
      status: PaymentRequestStatus.REJECTED,
      reason: "마케팅 캠페인 분석 도구 결제",
      requestedAt: new Date("2026-06-29T16:05:00+09:00"),
    },
    create: {
      id: ids.paymentCampaignTool,
      requestCode: "PR-2026-0056",
      requesterId: ids.userMarketing,
      departmentId: ids.departmentMarketing,
      vendorId: ids.vendorCloud,
      budgetItemId: ids.budgetItemMarketingSaas,
      amount: "980000",
      status: PaymentRequestStatus.REJECTED,
      reason: "마케팅 캠페인 분석 도구 결제",
      requestedAt: new Date("2026-06-29T16:05:00+09:00"),
    },
  });

  await prisma.approvalStep.upsert({
    where: { paymentRequestId_stepOrder: { paymentRequestId: cloudInfraRequest.id, stepOrder: 1 } },
    update: {
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-02T11:05:00+09:00"),
      reason: "예산 범위 내 사용 확인",
    },
    create: {
      paymentRequestId: cloudInfraRequest.id,
      stepOrder: 1,
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-02T11:05:00+09:00"),
      reason: "예산 범위 내 사용 확인",
    },
  });
  await prisma.approvalStep.upsert({
    where: { paymentRequestId_stepOrder: { paymentRequestId: cloudInfraRequest.id, stepOrder: 2 } },
    update: { approverId: ids.userExecutiveApprover, status: ApprovalStatus.PENDING, actedAt: null, reason: null },
    create: {
      paymentRequestId: cloudInfraRequest.id,
      stepOrder: 2,
      approverId: ids.userExecutiveApprover,
      status: ApprovalStatus.PENDING,
    },
  });

  await prisma.approvalStep.upsert({
    where: { paymentRequestId_stepOrder: { paymentRequestId: erpLicenseRequest.id, stepOrder: 1 } },
    update: {
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-01T15:10:00+09:00"),
      reason: "계약 갱신 적정",
    },
    create: {
      paymentRequestId: erpLicenseRequest.id,
      stepOrder: 1,
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-01T15:10:00+09:00"),
      reason: "계약 갱신 적정",
    },
  });
  await prisma.approvalStep.upsert({
    where: { paymentRequestId_stepOrder: { paymentRequestId: erpLicenseRequest.id, stepOrder: 2 } },
    update: {
      approverId: ids.userExecutiveApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-01T17:45:00+09:00"),
      reason: "최종 승인",
    },
    create: {
      paymentRequestId: erpLicenseRequest.id,
      stepOrder: 2,
      approverId: ids.userExecutiveApprover,
      status: ApprovalStatus.APPROVED,
      actedAt: new Date("2026-07-01T17:45:00+09:00"),
      reason: "최종 승인",
    },
  });

  await prisma.approvalStep.upsert({
    where: { paymentRequestId_stepOrder: { paymentRequestId: campaignToolRequest.id, stepOrder: 1 } },
    update: {
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.REJECTED,
      actedAt: new Date("2026-06-30T10:15:00+09:00"),
      reason: "동일 목적의 기존 계약과 중복",
    },
    create: {
      paymentRequestId: campaignToolRequest.id,
      stepOrder: 1,
      approverId: ids.userFinanceApprover,
      status: ApprovalStatus.REJECTED,
      actedAt: new Date("2026-06-30T10:15:00+09:00"),
      reason: "동일 목적의 기존 계약과 중복",
    },
  });

  await prisma.disbursement.upsert({
    where: { disbursementCode: "PMT-2026-0086" },
    update: {
      paymentRequestId: erpLicenseRequest.id,
      vendorId: ids.vendorInnovation,
      amount: "7800000",
      status: DisbursementStatus.SCHEDULED,
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      scheduledDate: new Date("2026-07-06T00:00:00+09:00"),
    },
    create: {
      id: ids.disbursementErpLicense,
      disbursementCode: "PMT-2026-0086",
      paymentRequestId: erpLicenseRequest.id,
      vendorId: ids.vendorInnovation,
      amount: "7800000",
      status: DisbursementStatus.SCHEDULED,
      accountVerificationStatus: AccountVerificationStatus.VERIFIED,
      scheduledDate: new Date("2026-07-06T00:00:00+09:00"),
    },
  });

  await prisma.attachment.upsert({
    where: { storageKey: "payment-requests/PR-2026-0058/cloud-invoice-202607.pdf" },
    update: {
      ownerType: "PAYMENT_REQUEST",
      ownerId: cloudInfraRequest.id,
      fileName: "cloud-invoice-202607.pdf",
      contentType: "application/pdf",
      byteSize: 245760n,
      checksum: "seed-checksum-cloud-invoice-202607",
      uploadedBy: ids.userMarketing,
    },
    create: {
      id: ids.attachmentCloudInvoice,
      ownerType: "PAYMENT_REQUEST",
      ownerId: cloudInfraRequest.id,
      fileName: "cloud-invoice-202607.pdf",
      contentType: "application/pdf",
      byteSize: 245760n,
      storageKey: "payment-requests/PR-2026-0058/cloud-invoice-202607.pdf",
      checksum: "seed-checksum-cloud-invoice-202607",
      uploadedBy: ids.userMarketing,
    },
  });

  await prisma.auditLog.upsert({
    where: { idempotencyKey: "seed:PR-2026-0058:submitted" },
    update: {
      entityType: "PAYMENT_REQUEST",
      entityId: cloudInfraRequest.id,
      actorId: ids.userMarketing,
      action: "SUBMIT",
      beforeValue: { status: "DRAFT" },
      afterValue: { status: "APPROVAL_IN_PROGRESS", requestCode: "PR-2026-0058" },
      reason: "초기 seed 제출 이력",
      requestId: "seed-request-cloud-submit",
    },
    create: {
      id: ids.auditCloudSubmit,
      entityType: "PAYMENT_REQUEST",
      entityId: cloudInfraRequest.id,
      actorId: ids.userMarketing,
      action: "SUBMIT",
      beforeValue: { status: "DRAFT" },
      afterValue: { status: "APPROVAL_IN_PROGRESS", requestCode: "PR-2026-0058" },
      reason: "초기 seed 제출 이력",
      idempotencyKey: "seed:PR-2026-0058:submitted",
      requestId: "seed-request-cloud-submit",
    },
  });

  await prisma.auditLog.upsert({
    where: { idempotencyKey: "seed:PR-2026-0057:approved" },
    update: {
      entityType: "PAYMENT_REQUEST",
      entityId: erpLicenseRequest.id,
      actorId: ids.userExecutiveApprover,
      action: "APPROVE",
      beforeValue: { status: "APPROVAL_IN_PROGRESS" },
      afterValue: { status: "APPROVED", requestCode: "PR-2026-0057" },
      reason: "초기 seed 승인 완료 이력",
      requestId: "seed-request-erp-approved",
    },
    create: {
      id: ids.auditErpApproved,
      entityType: "PAYMENT_REQUEST",
      entityId: erpLicenseRequest.id,
      actorId: ids.userExecutiveApprover,
      action: "APPROVE",
      beforeValue: { status: "APPROVAL_IN_PROGRESS" },
      afterValue: { status: "APPROVED", requestCode: "PR-2026-0057" },
      reason: "초기 seed 승인 완료 이력",
      idempotencyKey: "seed:PR-2026-0057:approved",
      requestId: "seed-request-erp-approved",
    },
  });

  const notificationExpiresAt = new Date("2026-10-02T00:00:00+09:00");
  const notifications = [
    {
      id: ids.notificationApprovalRequested,
      userId: ids.userExecutiveApprover,
      type: NotificationType.APPROVAL_REQUESTED,
      title: "승인 요청",
      message: "PR-2026-0058 클라우드 인프라 사용료 결재가 배정되었습니다.",
      entityType: "PAYMENT_REQUEST",
      entityId: "PR-2026-0058",
      linkPath: "#approval",
      createdAt: new Date("2026-07-04T09:10:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationRejected,
      userId: ids.userMarketing,
      type: NotificationType.APPROVAL_REJECTED,
      title: "반려 알림",
      message: "PR-2026-0056 마케팅 캠페인 분석 도구 요청이 반려되었습니다.",
      entityType: "PAYMENT_REQUEST",
      entityId: "PR-2026-0056",
      linkPath: "#payment-request",
      createdAt: new Date("2026-07-04T08:25:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationHeld,
      userId: ids.userExecutiveApprover,
      type: NotificationType.APPROVAL_HELD,
      title: "보류 알림",
      message: "PR-2026-0055 장비 유지보수 비용 결재가 보류되었습니다.",
      entityType: "PAYMENT_REQUEST",
      entityId: "PR-2026-0055",
      linkPath: "#approval",
      createdAt: new Date("2026-07-03T17:40:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationApproved,
      userId: ids.userExecutiveApprover,
      type: NotificationType.APPROVAL_COMPLETED,
      title: "승인 완료",
      message: "PR-2026-0057 ERP 라이선스 연장 계약이 최종 승인되었습니다.",
      entityType: "PAYMENT_REQUEST",
      entityId: "PR-2026-0057",
      linkPath: "#approval",
      readAt: new Date("2026-07-03T17:05:00+09:00"),
      createdAt: new Date("2026-07-03T16:30:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationDisbursementScheduled,
      userId: ids.userExecutiveApprover,
      type: NotificationType.DISBURSEMENT_SCHEDULED,
      title: "지급 예정",
      message: "PMT-2026-0086 이노베이션(주) 지급이 2026-07-06로 예정되었습니다.",
      entityType: "DISBURSEMENT",
      entityId: "PMT-2026-0086",
      linkPath: "#disbursement",
      createdAt: new Date("2026-07-03T15:20:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationDisbursementCompleted,
      userId: ids.userExecutiveApprover,
      type: NotificationType.DISBURSEMENT_COMPLETED,
      title: "지급 완료",
      message: "PMT-2026-0083 베스트오피스 지급이 완료되었습니다.",
      entityType: "DISBURSEMENT",
      entityId: "PMT-2026-0083",
      linkPath: "#disbursement",
      readAt: new Date("2026-07-03T14:20:00+09:00"),
      createdAt: new Date("2026-07-03T14:00:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationBudgetExceeded,
      userId: ids.userExecutiveApprover,
      type: NotificationType.BUDGET_EXCEEDED,
      title: "예산 초과 위험",
      message: "마케팅팀 SaaS 구독료 예산 사용률이 92%에 도달했습니다.",
      entityType: "BUDGET",
      entityId: "BUDGET-MKT-2026",
      linkPath: "#budget",
      createdAt: new Date("2026-07-03T11:50:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationApprovalDelayed,
      userId: ids.userExecutiveApprover,
      type: NotificationType.APPROVAL_DELAYED,
      title: "결재 지연",
      message: "PR-2026-0058 최종 결재 단계가 처리기한에 근접했습니다.",
      entityType: "PAYMENT_REQUEST",
      entityId: "PR-2026-0058",
      linkPath: "#approval",
      createdAt: new Date("2026-07-03T10:15:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
    {
      id: ids.notificationSystemChanged,
      userId: ids.userExecutiveApprover,
      type: NotificationType.SYSTEM_SETTING_CHANGED,
      title: "시스템 설정 변경",
      message: "승인 한도 정책이 김민수 과장에 의해 변경되었습니다.",
      entityType: "SYSTEM_SETTING",
      entityId: "APPROVAL_POLICY",
      linkPath: "#settings",
      readAt: new Date("2026-07-02T18:30:00+09:00"),
      createdAt: new Date("2026-07-02T18:10:00+09:00"),
      expiresAt: notificationExpiresAt,
    },
  ];

  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      update: notification,
      create: notification,
    });
  }

  const monthlyReportDefinition = await prisma.reportDefinition.upsert({
    where: { id: ids.reportDefinitionMonthly },
    update: {
      ownerId: ids.userExecutiveApprover,
      name: "월간 종합 보고서",
      type: ReportType.COMPREHENSIVE,
      description: "월별 지급, 승인, 예산 현황을 함께 조회하는 기본 보고서",
      filters: {
        period: "monthly",
        departments: ["재무팀", "마케팅팀", "IT운영팀"],
        includeCharts: true,
      },
      isActive: true,
    },
    create: {
      id: ids.reportDefinitionMonthly,
      ownerId: ids.userExecutiveApprover,
      name: "월간 종합 보고서",
      type: ReportType.COMPREHENSIVE,
      description: "월별 지급, 승인, 예산 현황을 함께 조회하는 기본 보고서",
      filters: {
        period: "monthly",
        departments: ["재무팀", "마케팅팀", "IT운영팀"],
        includeCharts: true,
      },
    },
  });

  await prisma.reportRun.upsert({
    where: { id: ids.reportRunMonthly },
    update: {
      definitionId: monthlyReportDefinition.id,
      createdBy: ids.userExecutiveApprover,
      name: "2026년 7월 월간 종합 보고서",
      type: ReportType.COMPREHENSIVE,
      periodStart: new Date("2026-07-01T00:00:00+09:00"),
      periodEnd: new Date("2026-07-31T00:00:00+09:00"),
      status: ReportRunStatus.READY,
      summary: "지급 예정, 승인 대기, 예산 사용률을 포함한 월간 요약",
      artifactKey: "reports/2026/07/monthly-comprehensive.pdf",
      rowCount: 15,
    },
    create: {
      id: ids.reportRunMonthly,
      definitionId: monthlyReportDefinition.id,
      createdBy: ids.userExecutiveApprover,
      name: "2026년 7월 월간 종합 보고서",
      type: ReportType.COMPREHENSIVE,
      periodStart: new Date("2026-07-01T00:00:00+09:00"),
      periodEnd: new Date("2026-07-31T00:00:00+09:00"),
      status: ReportRunStatus.READY,
      summary: "지급 예정, 승인 대기, 예산 사용률을 포함한 월간 요약",
      artifactKey: "reports/2026/07/monthly-comprehensive.pdf",
      rowCount: 15,
    },
  });

  await prisma.reportSchedule.upsert({
    where: { id: ids.reportScheduleMonthly },
    update: {
      definitionId: monthlyReportDefinition.id,
      userId: ids.userExecutiveApprover,
      frequency: ReportScheduleFrequency.MONTHLY,
      recipients: ["finance@example.local", "executive@example.local"],
      isActive: true,
      nextRunAt: new Date("2026-08-01T09:00:00+09:00"),
    },
    create: {
      id: ids.reportScheduleMonthly,
      definitionId: monthlyReportDefinition.id,
      userId: ids.userExecutiveApprover,
      frequency: ReportScheduleFrequency.MONTHLY,
      recipients: ["finance@example.local", "executive@example.local"],
      nextRunAt: new Date("2026-08-01T09:00:00+09:00"),
    },
  });

  await prisma.favoriteItem.upsert({
    where: { id: ids.favoriteDashboard },
    update: {
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.MENU,
      pageKey: "dashboard",
      label: "대시보드",
      targetPath: "#dashboard",
      sortOrder: 1,
      isActive: true,
    },
    create: {
      id: ids.favoriteDashboard,
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.MENU,
      pageKey: "dashboard",
      label: "대시보드",
      targetPath: "#dashboard",
      sortOrder: 1,
    },
  });

  await prisma.favoriteItem.upsert({
    where: { id: ids.favoriteApprovalFilter },
    update: {
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.FILTER,
      pageKey: "approval",
      label: "승인 대기 긴급 건",
      targetPath: "#approval",
      filters: {
        tags: ["상태: 승인 대기", "긴급여부: 긴급"],
        shared: "개인",
        filters: { status: "승인 대기", urgency: "긴급" },
        sort: { field: "요청일", direction: "desc" },
      },
      sortOrder: 2,
      isActive: true,
    },
    create: {
      id: ids.favoriteApprovalFilter,
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.FILTER,
      pageKey: "approval",
      label: "승인 대기 긴급 건",
      targetPath: "#approval",
      filters: {
        tags: ["상태: 승인 대기", "긴급여부: 긴급"],
        shared: "개인",
        filters: { status: "승인 대기", urgency: "긴급" },
        sort: { field: "요청일", direction: "desc" },
      },
      sortOrder: 2,
    },
  });

  await prisma.favoriteItem.upsert({
    where: { id: ids.favoriteMonthlyReport },
    update: {
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.REPORT,
      pageKey: "reports",
      label: "월간 종합 보고서",
      targetPath: "#reports",
      filters: { reportDefinitionId: monthlyReportDefinition.id },
      sortOrder: 3,
      isActive: true,
    },
    create: {
      id: ids.favoriteMonthlyReport,
      userId: ids.userExecutiveApprover,
      kind: FavoriteKind.REPORT,
      pageKey: "reports",
      label: "월간 종합 보고서",
      targetPath: "#reports",
      filters: { reportDefinitionId: monthlyReportDefinition.id },
      sortOrder: 3,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
