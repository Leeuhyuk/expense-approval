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

describe("backend notification and operations exception integration", () => {
  it("keeps notification reads idempotent and business failure owner notifications de-duplicated", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." }, async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    setIntegrationEnvironment(testDatabaseUrl);

    const [{ prisma }, { hashPassword }, { buildApp }, { NotificationType }] = await Promise.all([
      import("../../backend/src/db/prisma"),
      import("../../backend/src/auth/password"),
      import("../../backend/src/app"),
      import("../../backend/generated/prisma/index"),
    ]);
    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const adminEmail = `integration-ops-admin-${runId}@example.test`;
    const departmentName = `통합테스트운영부서-${runId}`;
    const roleCode = `INTEGRATION_OPS_ADMIN_${runId.toUpperCase()}`;
    const requestId = `integration-ops-${runId}`;
    let adminUserId = "";
    let roleId = "";
    let departmentId = "";

    const app = await buildApp({ logger: process.env.ERP_TEST_DEBUG === "1" ? true : false });
    try {
      const department = await prisma.department.create({ data: { name: departmentName } });
      departmentId = department.id;
      const role = await prisma.role.create({
        data: {
          code: roleCode,
          name: "통합 운영 테스트 관리자",
          permissions: ["system:manage", "dashboard:read"],
          isActive: true,
        },
      });
      roleId = role.id;
      const adminUser = await prisma.user.create({
        data: {
          departmentId: department.id,
          name: "통합 운영 테스트 관리자",
          email: adminEmail,
          passwordHash: await hashPassword(testPassword, Buffer.from(`ops-${runId}`)),
          isActive: true,
        },
      });
      adminUserId = adminUser.id;
      await prisma.userRole.create({ data: { userId: adminUser.id, roleId: role.id } });

      const jar = await login(app, adminEmail);
      const notification = await prisma.notification.create({
        data: {
          userId: adminUser.id,
          type: NotificationType.APPROVAL_REQUESTED,
          title: "통합 테스트 알림",
          message: "readAt idempotency 검증",
          entityType: "INTEGRATION_TEST",
          entityId: runId,
          linkPath: "#approval",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const firstRead = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${notification.id}/read`,
        headers: mutationHeaders(jar),
        payload: {},
      });
      const firstReadPayload = firstRead.json();
      assert.equal(firstRead.statusCode, 200);
      assert.equal(firstReadPayload.status, "success");
      assert.equal(firstReadPayload.data.id, notification.id);
      assert.equal(typeof firstReadPayload.data.readAt, "string");

      const secondRead = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${notification.id}/read`,
        headers: mutationHeaders(jar),
        payload: {},
      });
      const secondReadPayload = secondRead.json();
      assert.equal(secondRead.statusCode, 200);
      assert.equal(secondReadPayload.data.readAt, firstReadPayload.data.readAt);

      await prisma.securityEvent.create({
        data: {
          eventType: "server_failure",
          severity: "high",
          actorId: adminUser.id,
          requestId,
          method: "GET",
          path: "/api/reports/integration-failure/download",
          statusCode: 500,
          errorCode: "SERVER_ERROR",
          message: "통합 테스트 보고서 실패",
        },
      });

      const firstNotify = await app.inject({
        method: "POST",
        url: "/api/operations/business-failure-alerts/notify",
        headers: mutationHeaders(jar),
        payload: {},
      });
      const firstNotifyPayload = firstNotify.json();
      assert.equal(firstNotify.statusCode, 202);
      assert.equal(firstNotifyPayload.status, "success");
      assert.ok(firstNotifyPayload.data.summary.triggered.some((rule: { id: string }) => rule.id === "report_processing_failure"));

      const adminOperationalAlerts = await prisma.notification.findMany({
        where: {
          userId: adminUser.id,
          type: NotificationType.OPERATIONAL_ALERT,
          entityType: "BUSINESS_FAILURE_ALERT",
          entityId: "report_processing_failure",
        },
      });
      assert.equal(adminOperationalAlerts.length, 1);

      const secondNotify = await app.inject({
        method: "POST",
        url: "/api/operations/business-failure-alerts/notify",
        headers: mutationHeaders(jar),
        payload: {},
      });
      const secondNotifyPayload = secondNotify.json();
      assert.equal(secondNotify.statusCode, 202);
      assert.equal(secondNotifyPayload.status, "success");

      const adminOperationalAlertsAfterReplay = await prisma.notification.findMany({
        where: {
          userId: adminUser.id,
          type: NotificationType.OPERATIONAL_ALERT,
          entityType: "BUSINESS_FAILURE_ALERT",
          entityId: "report_processing_failure",
        },
      });
      assert.equal(adminOperationalAlertsAfterReplay.length, 1);
    } finally {
      if (adminUserId) await prisma.notification.deleteMany({ where: { userId: adminUserId } }).catch(() => undefined);
      await prisma.securityEvent.deleteMany({ where: { requestId } }).catch(() => undefined);
      if (adminUserId) await prisma.userRole.deleteMany({ where: { userId: adminUserId } }).catch(() => undefined);
      if (adminUserId) await prisma.user.delete({ where: { id: adminUserId } }).catch(() => undefined);
      if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => undefined);
      if (departmentId) await prisma.department.delete({ where: { id: departmentId } }).catch(() => undefined);
      await app.close();
      await prisma.$disconnect();
    }
  });
});
