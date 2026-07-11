import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
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

function setIntegrationEnvironment(url: string, storageDir: string) {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = url;
  process.env.FRONTEND_ORIGIN = "http://127.0.0.1:5173";
  process.env.RATE_LIMIT_DISABLED = "true";
  process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? "integration-csrf-secret-000000000000";
  process.env.FILE_URL_SECRET = process.env.FILE_URL_SECRET ?? "integration-file-url-secret-0000000000";
  process.env.BANK_ACCOUNT_SECRET = process.env.BANK_ACCOUNT_SECRET ?? "integration-bank-account-secret-0000";
  process.env.FILE_STORAGE_DRIVER = "local";
  process.env.FILE_STORAGE_DIR = storageDir;
  process.env.FILE_SCAN_MODE = "local";
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

function mutationHeaders(jar: Record<string, string>, userAgent = "erp-integration-test") {
  return {
    cookie: cookieHeader(jar),
    "x-csrf-token": jar.erp_csrf,
    "user-agent": userAgent,
  };
}

async function login(app: { inject: Function }, email: string, userAgent = "erp-integration-test") {
  const jar: Record<string, string> = {};
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": userAgent },
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

describe("backend payment request flow integration", () => {
  it("persists master data, draft creation, file upload, submit, and approval steps in the DB", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." }, async () => {
    guardTestDatabaseUrl(testDatabaseUrl);

    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const storageDir = resolve(".local-test-file-storage", runId);
    setIntegrationEnvironment(testDatabaseUrl, storageDir);

    const [{ prisma }, { hashPassword }, { encryptBankAccount, maskBankAccount }, { buildApp }] = await Promise.all([
      import("../../backend/src/db/prisma"),
      import("../../backend/src/auth/password"),
      import("../../backend/src/security/bankAccountCrypto"),
      import("../../backend/src/app"),
    ]);

    const departmentName = `통합테스트결제부서-${runId}`;
    const vendorName = `통합테스트결제거래처-${runId}`;
    const businessNumber = `8${[...runId].map((char) => String(parseInt(char, 16) % 10)).join("").slice(0, 9)}`;
    const requesterEmail = `integration-payment-requester-${runId}@example.test`;
    const approverOneEmail = `integration-payment-approver1-${runId}@example.test`;
    const approverTwoEmail = `integration-payment-approver2-${runId}@example.test`;
    const requesterRoleCode = `INTEGRATION_PAYMENT_REQUESTER_${runId.toUpperCase()}`;
    const approverRoleCode = `INTEGRATION_PAYMENT_APPROVER_${runId.toUpperCase()}`;
    const reason = `통합 테스트 결제 요청 ${runId}`;

    let departmentId = "";
    let budgetId = "";
    let budgetItemId = "";
    let vendorId = "";
    let requesterId = "";
    let approverOneId = "";
    let approverTwoId = "";
    let requesterRoleId = "";
    let approverRoleId = "";
    let paymentRequestId = "";
    let attachmentId = "";
    let requestCode = "";

    const app = await buildApp({ logger: false });
    try {
      const department = await prisma.department.create({ data: { name: departmentName } });
      departmentId = department.id;
      const budget = await prisma.budget.create({
        data: {
          departmentId,
          fiscalYear: "2099",
          allocatedAmount: "5000000.00",
          usedAmount: "0.00",
          status: "NORMAL",
        },
      });
      budgetId = budget.id;
      const budgetItem = await prisma.budgetItem.create({
        data: {
          budgetId,
          name: "통합 테스트 운영비",
          allocatedAmount: "5000000.00",
          usedAmount: "0.00",
          status: "NORMAL",
        },
      });
      budgetItemId = budgetItem.id;
      const vendor = await prisma.vendor.create({
        data: {
          name: vendorName,
          businessNumber,
          managerName: "통합 테스트 담당자",
          bankName: "신한은행",
          bankAccountEncrypted: encryptBankAccount("110-555-777777"),
          bankAccountMasked: maskBankAccount("110-555-777777"),
          taxInvoiceEmail: `tax-${runId}@example.test`,
          taxInvoiceIssueType: "전자세금계산서 연동",
          accountVerificationStatus: "VERIFIED",
          status: "ACTIVE",
          isActive: true,
        },
      });
      vendorId = vendor.id;
      const requesterRole = await prisma.role.create({
        data: {
          code: requesterRoleCode,
          name: "통합 결제 요청자",
          permissions: ["payment_request:create", "payment_request:read_own", "payment_request:update_own", "dashboard:read"],
          isActive: true,
        },
      });
      requesterRoleId = requesterRole.id;
      const approverRole = await prisma.role.create({
        data: {
          code: approverRoleCode,
          name: "통합 결재 승인자",
          permissions: ["approval:act", "approval:read_assigned", "payment_request:read_all"],
          isActive: true,
        },
      });
      approverRoleId = approverRole.id;
      const [requester, approverOne, approverTwo] = await Promise.all([
        prisma.user.create({
          data: {
            departmentId,
            name: `900 통합 요청자 ${runId}`,
            email: requesterEmail,
            passwordHash: await hashPassword(testPassword, Buffer.from(`requester-${runId}`)),
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            departmentId,
            name: `001 통합 승인자1 ${runId}`,
            email: approverOneEmail,
            passwordHash: await hashPassword(testPassword, Buffer.from(`approver1-${runId}`)),
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            departmentId,
            name: `002 통합 승인자2 ${runId}`,
            email: approverTwoEmail,
            passwordHash: await hashPassword(testPassword, Buffer.from(`approver2-${runId}`)),
            isActive: true,
          },
        }),
      ]);
      requesterId = requester.id;
      approverOneId = approverOne.id;
      approverTwoId = approverTwo.id;
      await prisma.userRole.createMany({
        data: [
          { userId: requesterId, roleId: requesterRoleId },
          { userId: approverOneId, roleId: approverRoleId },
          { userId: approverTwoId, roleId: approverRoleId },
        ],
      });

      const requesterJar = await login(app, requesterEmail);
      const masterData = await app.inject({
        method: "GET",
        url: "/api/payment-requests/master-data",
        headers: { cookie: cookieHeader(requesterJar), "user-agent": "erp-integration-test" },
      });
      const masterPayload = masterData.json();
      assert.equal(masterData.statusCode, 200);
      assert.equal(masterPayload.status, "success");
      assert.ok(masterPayload.data.vendors.some((item: { name: string }) => item.name === vendorName), "master data must include the active vendor");
      assert.ok(masterPayload.data.departments.some((item: { name: string; budgetStatus: string }) => item.name === departmentName && item.budgetStatus === "정상"), "master data must include the department budget status");
      assert.ok(masterPayload.data.budgetItems.some((item: { id: string }) => item.id === budgetItemId), "master data must include the budget item id");
      assert.equal(masterPayload.data.approvalCandidates.filter((item: { id: string }) => [approverOneId, approverTwoId].includes(item.id)).length, 2);
      assert.equal(masterPayload.data.approvalCandidates.some((item: { id: string }) => item.id === requesterId), false, "requester must be excluded from approver candidates");

      const draft = await app.inject({
        method: "POST",
        url: "/api/payment-requests",
        headers: mutationHeaders(requesterJar),
        payload: {
          거래처: vendorName,
          부서: departmentName,
          금액: "450,000 원",
          상태: "임시 저장",
          "요청 사유": reason,
          예산항목ID: budgetItemId,
        },
      });
      const draftPayload = draft.json();
      assert.equal(draft.statusCode, 201);
      assert.equal(draftPayload.status, "success");
      assert.equal(draftPayload.data.거래처, vendorName);
      assert.equal(draftPayload.data.상태, "임시 저장");
      requestCode = draftPayload.data.요청번호;
      const dbDraft = await prisma.paymentRequest.findUniqueOrThrow({ where: { requestCode } });
      paymentRequestId = dbDraft.id;
      assert.equal(dbDraft.requesterId, requesterId);
      assert.equal(dbDraft.budgetItemId, budgetItemId);

      const pdfBody = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "utf8");
      const presign = await app.inject({
        method: "POST",
        url: "/api/files/presign-upload",
        headers: mutationHeaders(requesterJar),
        payload: {
          ownerType: "PAYMENT_REQUEST",
          ownerId: requestCode,
          fileName: `통합테스트증빙-${runId}.pdf`,
          contentType: "application/pdf",
          byteSize: pdfBody.length,
        },
      });
      const presignPayload = presign.json();
      assert.equal(presign.statusCode, 200);
      assert.equal(presignPayload.status, "success");
      attachmentId = presignPayload.data.file.id;

      const upload = await app.inject({
        method: "PUT",
        url: presignPayload.data.upload.url,
        headers: { "content-type": "application/pdf", "user-agent": "erp-integration-test-upload" },
        payload: pdfBody,
      });
      assert.equal(upload.statusCode, 200);
      assert.equal(upload.json().data.scanStatus, "clean");

      const complete = await app.inject({
        method: "POST",
        url: "/api/files/complete",
        headers: mutationHeaders(requesterJar),
        payload: { fileId: attachmentId },
      });
      assert.equal(complete.statusCode, 200);
      assert.equal(complete.json().data.scanStatus, "clean");

      const submitKey = `payment-submit-${runId}`;
      const submit = await app.inject({
        method: "POST",
        url: `/api/payment-requests/${encodeURIComponent(requestCode)}/submit`,
        headers: mutationHeaders(requesterJar),
        payload: {
          patch: {
            첨부파일ID: attachmentId,
          },
          idempotencyKey: submitKey,
        },
      });
      const submitPayload = submit.json();
      assert.equal(submit.statusCode, 200, JSON.stringify(submitPayload));
      assert.equal(submitPayload.status, "success");
      assert.equal(submitPayload.data.상태, "제출");
      assert.equal(submitPayload.meta.rowVersion, 2);

      const refreshed = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: mutationHeaders(requesterJar),
        payload: {},
      });
      assert.equal(refreshed.statusCode, 200);
      captureCookies(refreshed, requesterJar);

      const detailAfterRefresh = await app.inject({
        method: "GET",
        url: `/api/payment-requests/${encodeURIComponent(requestCode)}`,
        headers: { cookie: cookieHeader(requesterJar), "user-agent": "erp-integration-test" },
      });
      assert.equal(detailAfterRefresh.statusCode, 200);
      assert.equal(detailAfterRefresh.json().data.요청번호, requestCode);

      const approverJar = await login(app, approverOneEmail, "erp-integration-test-approver");
      const approvalList = await app.inject({
        method: "GET",
        url: `/api/approvals?search=${encodeURIComponent(requestCode)}&page=1&pageSize=10`,
        headers: { cookie: cookieHeader(approverJar), "user-agent": "erp-integration-test-approver" },
      });
      const approvalPayload = approvalList.json();
      assert.equal(approvalList.statusCode, 200);
      assert.equal(approvalPayload.data.total, 1);
      assert.equal(approvalPayload.data.rows[0].요청번호, requestCode);
      assert.equal(approvalPayload.data.rows[0].결재상태, "승인 대기");

      const persisted = await prisma.paymentRequest.findUniqueOrThrow({
        where: { requestCode },
        include: { approvalSteps: { orderBy: { stepOrder: "asc" } } },
      });
      assert.equal(persisted.status, "SUBMITTED");
      assert.equal(persisted.rowVersion, 2);
      assert.equal(persisted.approvalSteps.length, 2);
      assert.deepEqual(persisted.approvalSteps.map((step) => step.status), ["PENDING", "PENDING"]);
      assert.equal(persisted.approvalSteps.some((step) => step.approverId === requesterId), false);
      assert.deepEqual(new Set(persisted.approvalSteps.map((step) => step.approverId)), new Set([approverOneId, approverTwoId]));

      const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      assert.equal(attachment.ownerType, "PAYMENT_REQUEST");
      assert.equal(attachment.ownerId, persisted.id);
      assert.equal(attachment.uploadedBy, requesterId);
      assert.notEqual(attachment.checksum, "pending");

      const approvalNotifications = await prisma.notification.findMany({
        where: { entityType: "PAYMENT_REQUEST", entityId: requestCode, type: "APPROVAL_REQUESTED" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(approvalNotifications.length, 2);
      assert.deepEqual(new Set(approvalNotifications.map((item) => item.userId)), new Set([approverOneId, approverTwoId]));

      const submitAudit = await prisma.auditLog.findUnique({ where: { idempotencyKey: submitKey } });
      assert.ok(submitAudit, "submit must write an idempotent payment request audit log");
      assert.equal(submitAudit?.entityType, "payment_request");
      assert.equal(submitAudit?.entityId, persisted.id);
      assert.equal(submitAudit?.actorId, requesterId);
      assert.ok(submitAudit?.requestId, "submit audit must carry the backend request id");
    } finally {
      const userIds = [requesterId, approverOneId, approverTwoId].filter(Boolean);
      const roleIds = [requesterRoleId, approverRoleId].filter(Boolean);
      const entityIds = [paymentRequestId, attachmentId, budgetItemId, budgetId, vendorId].filter(Boolean);
      if (userIds.length || entityIds.length) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              ...(userIds.length ? [{ actorId: { in: userIds } }] : []),
              ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
            ],
          },
        }).catch(() => undefined);
      }
      if (userIds.length) await prisma.securityEvent.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => undefined);
      if (userIds.length) await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      if (requestCode) await prisma.notification.deleteMany({ where: { entityId: requestCode } }).catch(() => undefined);
      if (attachmentId) await prisma.attachment.delete({ where: { id: attachmentId } }).catch(() => undefined);
      if (paymentRequestId) await prisma.approvalStep.deleteMany({ where: { paymentRequestId } }).catch(() => undefined);
      if (paymentRequestId) await prisma.paymentRequest.delete({ where: { id: paymentRequestId } }).catch(() => undefined);
      if (userIds.length) await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      if (userIds.length) await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      if (roleIds.length) await prisma.userRole.deleteMany({ where: { roleId: { in: roleIds } } }).catch(() => undefined);
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
      if (roleIds.length) await prisma.role.deleteMany({ where: { id: { in: roleIds } } }).catch(() => undefined);
      if (budgetItemId) await prisma.budgetItem.delete({ where: { id: budgetItemId } }).catch(() => undefined);
      if (budgetId) await prisma.budget.delete({ where: { id: budgetId } }).catch(() => undefined);
      if (vendorId) await prisma.vendor.delete({ where: { id: vendorId } }).catch(() => undefined);
      if (departmentId) await prisma.department.delete({ where: { id: departmentId } }).catch(() => undefined);
      await app.close();
      await prisma.$disconnect();
      rmSync(storageDir, { recursive: true, force: true });
    }
  });
});
