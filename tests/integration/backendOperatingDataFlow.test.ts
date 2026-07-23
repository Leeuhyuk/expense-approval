import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

const testDatabaseUrl = process.env.ERP_TEST_DATABASE_URL ?? "";
const testPassword = "IntegrationTest#2026";

function guardTestDatabaseUrl(url: string) {
  const lower = url.toLowerCase();
  if (/(^|[/:@._-])prod(uction)?([/:@._-]|$)/.test(lower)) {
    throw new Error("ERP_TEST_DATABASE_URL must not point to a production database.");
  }
  if (!lower.includes("test") && process.env.ERP_ALLOW_NON_TEST_DATABASE_URL !== "true") {
    throw new Error("ERP_TEST_DATABASE_URL must look like a disposable test database, or set ERP_ALLOW_NON_TEST_DATABASE_URL=true explicitly.");
  }
}

function setIntegrationEnvironment(url: string) {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = url;
  process.env.FRONTEND_ORIGIN = "http://127.0.0.1:5173";
  process.env.RATE_LIMIT_DISABLED = "true";
  process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? "integration-csrf-secret-000000000000";
  process.env.FILE_URL_SECRET = process.env.FILE_URL_SECRET ?? "integration-file-url-secret-0000000000";
  process.env.BANK_ACCOUNT_SECRET = process.env.BANK_ACCOUNT_SECRET ?? "integration-bank-account-secret-0000";
}

function captureCookies(response: { headers: Record<string, string | string[] | undefined> }, jar: Record<string, string>) {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
}

function cookieHeader(jar: Record<string, string>) {
  return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join("; ");
}

function mutationHeaders(jar: Record<string, string>) {
  return {
    cookie: cookieHeader(jar),
    "x-csrf-token": jar.erp_csrf,
    "user-agent": "erp-integration-test",
  };
}

async function login(app: { inject: Function }, email: string) {
  const jar: Record<string, string> = {};
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": "erp-integration-test" },
    payload: { email, password: testPassword },
  });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.status, "success");
  captureCookies(response, jar);
  assert.ok(jar.erp_session, "login must issue an auth session cookie");
  assert.ok(jar.erp_csrf, "login must issue a CSRF cookie");
  return jar;
}

describe("backend operating data flow integration", () => {
  it(
    "persists budget adjustments, reports, schedules, and favorites with DB/audit evidence",
    { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." },
    async () => {
      guardTestDatabaseUrl(testDatabaseUrl);
      setIntegrationEnvironment(testDatabaseUrl);

      const [{ prisma }, { hashPassword }, { encryptBankAccount, maskBankAccount }, { buildApp }] = await Promise.all([
        import("../../backend/src/db/prisma"),
        import("../../backend/src/auth/password"),
        import("../../backend/src/security/bankAccountCrypto"),
        import("../../backend/src/app"),
      ]);

      const runId = randomUUID().replace(/-/g, "").slice(0, 12);
      const numericRunId = [...runId].map((char) => String(parseInt(char, 16) % 10)).join("");
      const departmentName = `통합테스트운영부서-${runId}`;
      const vendorName = `통합테스트운영거래처-${runId}`;
      const roleCode = `INTEGRATION_OPERATING_ADMIN_${runId.toUpperCase()}`;
      const email = `integration-operating-admin-${runId}@example.test`;
      const requestCode = `PR-OPER-${runId.toUpperCase()}`;
      const disbursementCode = `PMT-OPER-${runId.toUpperCase()}`;
      const reportName = `통합테스트 예산 보고서 ${runId}`;
      const favoriteLabel = `통합테스트 보고서 바로가기 ${runId}`;
      const reportRecipient = `report-${runId}@example.test`;
      const budgetAdjustmentKey = `budget-adjustment-${runId}`;
      const disbursementHoldKey = `disbursement-hold-${runId}`;
      const reportRunKey = `report-run-${runId}`;
      const scheduleCreateKey = `report-schedule-create-${runId}`;
      const scheduleUpdateKey = `report-schedule-update-${runId}`;
      const scheduleDeleteKey = `report-schedule-delete-${runId}`;
      const favoriteCreateKey = `favorite-create-${runId}`;
      const favoriteOpenKey = `favorite-open-${runId}`;
      const favoriteDeleteKey = `favorite-delete-${runId}`;

      let departmentId = "";
      let roleId = "";
      let userId = "";
      let budgetId = "";
      let budgetAdjustmentId = "";
      let vendorId = "";
      let paymentRequestId = "";
      let disbursementId = "";
      let reportRunId = "";
      let reportDefinitionId = "";
      let reportScheduleId = "";
      let favoriteId = "";

      const app = await buildApp({ logger: process.env.ERP_TEST_DEBUG === "1" ? true : false });
      try {
        const department = await prisma.department.create({ data: { name: departmentName } });
        departmentId = department.id;
        const role = await prisma.role.create({
          data: {
            code: roleCode,
            name: "통합 운영 데이터 관리자",
            permissions: ["system:manage", "budget:read", "report:read", "favorite:read", "dashboard:read", "disbursement:read", "disbursement:hold"],
            isActive: true,
          },
        });
        roleId = role.id;
        const user = await prisma.user.create({
          data: {
            departmentId,
            name: `통합 운영 관리자 ${runId}`,
            email,
            passwordHash: await hashPassword(testPassword, Buffer.from(`operating-${runId}`)),
            isActive: true,
          },
        });
        userId = user.id;
        await prisma.userRole.create({ data: { userId, roleId } });
        const budget = await prisma.budget.create({
          data: {
            departmentId,
            fiscalYear: "2099",
            allocatedAmount: "1000000.00",
            usedAmount: "0.00",
            status: "NORMAL",
          },
        });
        budgetId = budget.id;
        const vendor = await prisma.vendor.create({
          data: {
            name: vendorName,
            businessNumber: `7${numericRunId.slice(0, 9)}`,
            managerName: "통합 운영 담당자",
            bankName: "신한은행",
            bankAccountEncrypted: encryptBankAccount("110-999-777777"),
            bankAccountMasked: maskBankAccount("110-999-777777"),
            taxInvoiceEmail: `tax-operating-${runId}@example.test`,
            taxInvoiceIssueType: "전자세금계산서 연동",
            accountVerificationStatus: "VERIFIED",
            status: "ACTIVE",
            isActive: true,
          },
        });
        vendorId = vendor.id;
        const paymentRequest = await prisma.paymentRequest.create({
          data: {
            requestCode,
            requesterId: userId,
            departmentId,
            vendorId,
            amount: "780000.00",
            status: "APPROVED",
            reason: `통합 운영 지급 요청 ${runId}`,
          },
        });
        paymentRequestId = paymentRequest.id;
        const disbursement = await prisma.disbursement.create({
          data: {
            disbursementCode,
            paymentRequestId,
            vendorId,
            amount: "780000.00",
            status: "SCHEDULED",
            accountVerificationStatus: "VERIFIED",
            scheduledDate: new Date("2099-02-05T00:00:00.000Z"),
          },
        });
        disbursementId = disbursement.id;

        const jar = await login(app, email);

        const adjustmentResponse = await app.inject({
          method: "POST",
          url: `/api/budgets/${encodeURIComponent(departmentName)}/adjustments`,
          headers: mutationHeaders(jar),
          payload: {
            amount: 250000,
            reason: `통합 테스트 예산 증액 ${runId}`,
            rowVersion: budget.rowVersion,
            idempotencyKey: budgetAdjustmentKey,
          },
        });
        const adjustmentPayload = adjustmentResponse.json();
        assert.equal(adjustmentResponse.statusCode, 200);
        assert.equal(adjustmentPayload.status, "success");
        assert.equal(adjustmentPayload.data.requiresApproval, false);
        budgetAdjustmentId = adjustmentPayload.data.adjustment.조정ID;

        const dbAdjustment = await prisma.budgetAdjustment.findUniqueOrThrow({ where: { id: budgetAdjustmentId } });
        assert.equal(dbAdjustment.requestedBy, userId);
        assert.equal(Number(dbAdjustment.amount), 250000);
        assert.equal(dbAdjustment.requiresApproval, false);
        assert.equal(dbAdjustment.status, "APPLIED");
        assert.ok(dbAdjustment.appliedAt, "non-approval budget adjustments must be applied immediately");
        const updatedBudget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
        assert.equal(Number(updatedBudget.allocatedAmount), 1250000);
        assert.equal(updatedBudget.rowVersion, 2);

        const adjustmentReplay = await app.inject({
          method: "POST",
          url: `/api/budgets/${encodeURIComponent(departmentName)}/adjustments`,
          headers: mutationHeaders(jar),
          payload: {
            amount: 250000,
            reason: `통합 테스트 예산 증액 ${runId}`,
            rowVersion: budget.rowVersion,
            idempotencyKey: budgetAdjustmentKey,
          },
        });
        assert.equal(adjustmentReplay.statusCode, 200);
        assert.equal(adjustmentReplay.json().meta.idempotencyReplay, true);
        assert.equal(await prisma.budgetAdjustment.count({ where: { budgetId, reason: `통합 테스트 예산 증액 ${runId}` } }), 1);

        const adjustmentAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: budgetAdjustmentKey } });
        assert.equal(adjustmentAudit?.entityType, "budget_adjustment");
        assert.equal(adjustmentAudit?.entityId, budgetAdjustmentId);
        assert.equal(adjustmentAudit?.action, "apply");

        const disbursementDetail = await app.inject({
          method: "GET",
          url: `/api/disbursements/${encodeURIComponent(disbursementCode)}`,
          headers: { cookie: cookieHeader(jar), "user-agent": "erp-integration-test" },
        });
        const disbursementDetailPayload = disbursementDetail.json();
        assert.equal(disbursementDetail.statusCode, 200);
        assert.equal(disbursementDetailPayload.data.지급번호, disbursementCode);
        assert.equal(disbursementDetailPayload.data.지급상태, "지급 예정");

        const holdDisbursement = await app.inject({
          method: "PATCH",
          url: `/api/disbursements/${encodeURIComponent(disbursementCode)}`,
          headers: mutationHeaders(jar),
          payload: {
            지급상태: "보류",
            "지급 보류 사유": `통합 테스트 지급 보류 ${runId}`,
            rowVersion: disbursement.rowVersion,
            idempotencyKey: disbursementHoldKey,
          },
        });
        const holdPayload = holdDisbursement.json();
        assert.equal(holdDisbursement.statusCode, 200, holdDisbursement.body);
        assert.equal(holdPayload.data.지급번호, disbursementCode);
        assert.equal(holdPayload.data.지급상태, "보류");
        assert.equal(holdPayload.meta.rowVersion, 2);
        const heldDisbursement = await prisma.disbursement.findUniqueOrThrow({ where: { id: disbursementId } });
        assert.equal(heldDisbursement.status, "HELD");
        assert.equal(heldDisbursement.rowVersion, 2);
        const disbursementAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: disbursementHoldKey } });
        assert.equal(disbursementAudit?.entityType, "disbursement");
        assert.equal(disbursementAudit?.entityId, disbursementId);
        assert.equal(disbursementAudit?.action, "hold");

        const reportResponse = await app.inject({
          method: "POST",
          url: "/api/reports",
          headers: mutationHeaders(jar),
          payload: {
            보고서명: reportName,
            유형: "예산",
            기간: "2099-01-01 ~ 2099-01-31",
            요약: `통합 테스트 보고서 ${runId}`,
            행수: "7",
            idempotencyKey: reportRunKey,
          },
        });
        const reportPayload = reportResponse.json();
        assert.equal(reportResponse.statusCode, 200);
        assert.equal(reportPayload.status, "success");
        assert.equal(reportPayload.data.보고서명, reportName);

        const dbReportRun = await prisma.reportRun.findFirstOrThrow({ where: { name: reportName } });
        reportRunId = dbReportRun.id;
        assert.equal(dbReportRun.createdBy, userId);
        assert.equal(dbReportRun.type, "BUDGET");
        assert.equal(dbReportRun.status, "READY");
        assert.equal(dbReportRun.rowCount, 7);
        const reportAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: reportRunKey } });
        assert.equal(reportAudit?.entityType, "report_run");
        assert.equal(reportAudit?.entityId, reportRunId);

        const scheduleResponse = await app.inject({
          method: "POST",
          url: "/api/reports/schedules",
          headers: mutationHeaders(jar),
          payload: {
            reportName,
            reportType: "예산",
            recipients: [reportRecipient],
            cycle: "매월 5일",
            time: "09:00",
            format: "PDF",
            idempotencyKey: scheduleCreateKey,
          },
        });
        const schedulePayload = scheduleResponse.json();
        assert.equal(scheduleResponse.statusCode, 200);
        assert.equal(schedulePayload.status, "success");
        reportScheduleId = schedulePayload.data.id;

        const dbSchedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: reportScheduleId }, include: { definition: true } });
        reportDefinitionId = dbSchedule.definitionId;
        assert.equal(dbSchedule.userId, userId);
        assert.equal(dbSchedule.definition.name, reportName);
        assert.equal(dbSchedule.definition.type, "BUDGET");
        assert.equal(dbSchedule.frequency, "MONTHLY");
        assert.equal(dbSchedule.isActive, true);
        assert.equal(dbSchedule.rowVersion, 1);
        assert.deepEqual((dbSchedule.recipients as { recipients: string[] }).recipients, [reportRecipient]);
        const scheduleAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: scheduleCreateKey } });
        assert.equal(scheduleAudit?.entityType, "report_schedule");
        assert.equal(scheduleAudit?.entityId, reportScheduleId);
        const scheduleNotification = await prisma.notification.findFirst({ where: { userId, entityType: "report_schedule", entityId: reportScheduleId } });
        assert.ok(scheduleNotification, "schedule create must emit an internal notification");

        const scheduleUpdate = await app.inject({
          method: "PATCH",
          url: `/api/reports/schedules/${reportScheduleId}`,
          headers: mutationHeaders(jar),
          payload: {
            reportName,
            reportType: "예산",
            recipients: [reportRecipient, `ops-${runId}@example.test`],
            cycle: "매주 월요일",
            time: "10:30",
            format: "CSV",
            isActive: true,
            rowVersion: schedulePayload.data.rowVersion,
            idempotencyKey: scheduleUpdateKey,
          },
        });
        const scheduleUpdatePayload = scheduleUpdate.json();
        assert.equal(scheduleUpdate.statusCode, 200);
        assert.equal(scheduleUpdatePayload.data.rowVersion, 2);
        const updatedSchedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: reportScheduleId } });
        assert.equal(updatedSchedule.frequency, "WEEKLY");
        assert.equal(updatedSchedule.rowVersion, 2);

        const scheduleDelete = await app.inject({
          method: "DELETE",
          url: `/api/reports/schedules/${reportScheduleId}`,
          headers: mutationHeaders(jar),
          payload: {
            rowVersion: scheduleUpdatePayload.data.rowVersion,
            idempotencyKey: scheduleDeleteKey,
          },
        });
        assert.equal(scheduleDelete.statusCode, 200);
        assert.equal(scheduleDelete.json().meta.deleted, true);
        const deletedSchedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: reportScheduleId } });
        assert.equal(deletedSchedule.isActive, false);
        assert.equal(deletedSchedule.rowVersion, 3);

        const favoriteResponse = await app.inject({
          method: "POST",
          url: "/api/favorites",
          headers: mutationHeaders(jar),
          payload: {
            항목명: favoriteLabel,
            유형: "보고서",
            설명: "#reports",
            대상화면: "reports",
            필터: "예산, 월간",
            필터JSON: JSON.stringify({ reportName }),
            정렬: "최근순",
            순서: "1",
            idempotencyKey: favoriteCreateKey,
          },
        });
        const favoritePayload = favoriteResponse.json();
        assert.equal(favoriteResponse.statusCode, 200);
        assert.equal(favoritePayload.status, "success");
        favoriteId = favoritePayload.data.ID;

        const dbFavorite = await prisma.favoriteItem.findUniqueOrThrow({ where: { id: favoriteId } });
        assert.equal(dbFavorite.userId, userId);
        assert.equal(dbFavorite.kind, "REPORT");
        assert.equal(dbFavorite.pageKey, "reports");
        assert.equal(dbFavorite.targetPath, "#reports");
        assert.equal(dbFavorite.sortOrder, 1);
        assert.equal(dbFavorite.rowVersion, 1);
        const favoriteAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: favoriteCreateKey } });
        assert.equal(favoriteAudit?.entityType, "favorite_item");
        assert.equal(favoriteAudit?.entityId, favoriteId);

        const openFavorite = await app.inject({
          method: "POST",
          url: `/api/favorites/${encodeURIComponent(favoriteLabel)}/open`,
          headers: mutationHeaders(jar),
          payload: {
            rowVersion: favoritePayload.data.rowVersion,
            idempotencyKey: favoriteOpenKey,
          },
        });
        const openPayload = openFavorite.json();
        assert.equal(openFavorite.statusCode, 200);
        assert.equal(openPayload.data.ID, favoriteId);
        assert.equal(openPayload.data.rowVersion, "2");
        const openedFavorite = await prisma.favoriteItem.findUniqueOrThrow({ where: { id: favoriteId } });
        assert.ok(openedFavorite.lastUsedAt, "favorite open action must persist lastUsedAt");
        assert.equal(openedFavorite.rowVersion, 2);

        const deleteFavorite = await app.inject({
          method: "DELETE",
          url: `/api/favorites/${encodeURIComponent(favoriteLabel)}`,
          headers: mutationHeaders(jar),
          payload: {
            rowVersion: openedFavorite.rowVersion,
            idempotencyKey: favoriteDeleteKey,
          },
        });
        assert.equal(deleteFavorite.statusCode, 200);
        assert.equal(deleteFavorite.json().meta.deleted, true);
        const deletedFavorite = await prisma.favoriteItem.findUniqueOrThrow({ where: { id: favoriteId } });
        assert.equal(deletedFavorite.isActive, false);
        assert.equal(deletedFavorite.rowVersion, 3);
      } finally {
        const userIds = userId ? [userId] : [];
        const entityIds = [
          budgetAdjustmentId,
          disbursementId,
          paymentRequestId,
          vendorId,
          reportRunId,
          reportScheduleId,
          favoriteId,
          budgetId,
          reportDefinitionId,
        ].filter(Boolean);

        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              ...(userIds.length ? [{ actorId: { in: userIds } }] : []),
              ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
            ],
          },
        }).catch(() => undefined);
        if (userIds.length) await prisma.securityEvent.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => undefined);
        if (userIds.length) await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
        if (entityIds.length) await prisma.notification.deleteMany({ where: { entityId: { in: entityIds } } }).catch(() => undefined);
        if (favoriteId) await prisma.favoriteItem.delete({ where: { id: favoriteId } }).catch(() => undefined);
        if (reportScheduleId) await prisma.reportSchedule.delete({ where: { id: reportScheduleId } }).catch(() => undefined);
        if (reportRunId) await prisma.reportRun.delete({ where: { id: reportRunId } }).catch(() => undefined);
        if (reportDefinitionId) await prisma.reportDefinition.delete({ where: { id: reportDefinitionId } }).catch(() => undefined);
        if (budgetAdjustmentId) await prisma.budgetAdjustment.delete({ where: { id: budgetAdjustmentId } }).catch(() => undefined);
        if (disbursementId) await prisma.disbursement.delete({ where: { id: disbursementId } }).catch(() => undefined);
        if (paymentRequestId) await prisma.paymentRequest.delete({ where: { id: paymentRequestId } }).catch(() => undefined);
        if (vendorId) await prisma.vendor.delete({ where: { id: vendorId } }).catch(() => undefined);
        if (budgetId) await prisma.budget.delete({ where: { id: budgetId } }).catch(() => undefined);
        if (userIds.length) await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
        if (userId) await prisma.userRole.deleteMany({ where: { userId } }).catch(() => undefined);
        if (roleId) await prisma.userRole.deleteMany({ where: { roleId } }).catch(() => undefined);
        if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
        if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => undefined);
        if (departmentId) await prisma.department.delete({ where: { id: departmentId } }).catch(() => undefined);
        await app.close();
        await prisma.$disconnect();
      }
    },
  );
});
