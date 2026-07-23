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

describe("backend data persistence integration", () => {
  it("persists vendor creation across refresh and a second login, with DB and audit evidence", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." }, async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    setIntegrationEnvironment(testDatabaseUrl);

    const [{ prisma }, { hashPassword }, { buildApp }] = await Promise.all([
      import("../../backend/src/db/prisma"),
      import("../../backend/src/auth/password"),
      import("../../backend/src/app"),
    ]);
    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const numericRunId = [...runId].map((char) => String(parseInt(char, 16) % 10)).join("");
    const email = `integration-admin-${runId}@example.test`;
    const vendorName = `통합테스트거래처-${runId}`;
    const businessNumber = `9${numericRunId.slice(0, 2)}-${numericRunId.slice(2, 4)}-${numericRunId.slice(4, 9)}`;
    const taxEmail = `tax-${runId}@example.test`;
    const departmentName = "통합테스트부서";
    const roleCode = "INTEGRATION_TEST_ADMIN";
    let createdVendorId = "";

    const app = await buildApp({ logger: process.env.ERP_TEST_DEBUG === "1" ? true : false });
    try {
      let department = await prisma.department.findFirst({ where: { name: departmentName } });
      department ??= await prisma.department.create({ data: { name: departmentName } });
      const role = await prisma.role.upsert({
        where: { code: roleCode },
        update: { name: "통합 테스트 관리자", permissions: ["system:manage", "vendor:read", "dashboard:read", "favorite:read"], isActive: true },
        create: { code: roleCode, name: "통합 테스트 관리자", permissions: ["system:manage", "vendor:read", "dashboard:read", "favorite:read"], isActive: true },
      });
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          departmentId: department.id,
          name: "통합 테스트 관리자",
          passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
          isActive: true,
        },
        create: {
          departmentId: department.id,
          name: "통합 테스트 관리자",
          email,
          passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
          isActive: true,
        },
      });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });

      const jar = await login(app, email);
      const created = await app.inject({
        method: "POST",
        url: "/api/vendors",
        headers: mutationHeaders(jar),
        payload: {
          거래처명: vendorName,
          사업자번호: businessNumber,
          담당자: "통합테스트 담당자",
          은행: "신한은행 110-555-777777",
          "세금계산서 이메일": taxEmail,
          "세금계산서 발행": "이메일 발행",
          계좌확인: "검증 대기",
          상태: "활성",
        },
      });
      const createdPayload = created.json();

      assert.equal(created.statusCode, 200);
      assert.equal(createdPayload.status, "success");
      assert.equal(createdPayload.meta.created, true);
      assert.equal(createdPayload.data.거래처명, vendorName);
      assert.equal(createdPayload.data.사업자번호, businessNumber);
      assert.doesNotMatch(createdPayload.data.은행, /110-555-777777/, "raw bank account must not be returned");
      assert.match(createdPayload.data.은행, /\*\*\*\*[-\d]*7777/, "masked bank account must be returned");

      const list = await app.inject({
        method: "GET",
        url: `/api/vendors?search=${encodeURIComponent(vendorName)}&page=1&pageSize=10`,
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-integration-test" },
      });
      const listPayload = list.json();
      assert.equal(list.statusCode, 200);
      assert.equal(listPayload.data.total, 1);
      assert.equal(listPayload.data.rows[0].거래처명, vendorName);

      const refreshed = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: mutationHeaders(jar),
        payload: {},
      });
      assert.equal(refreshed.statusCode, 200);
      captureCookies(refreshed, jar);

      const detailAfterRefresh = await app.inject({
        method: "GET",
        url: `/api/vendors/${encodeURIComponent(vendorName)}`,
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-integration-test" },
      });
      assert.equal(detailAfterRefresh.statusCode, 200);
      assert.equal(detailAfterRefresh.json().data.거래처명, vendorName);

      const secondBrowserJar = await login(app, email);
      const detailAfterSecondLogin = await app.inject({
        method: "GET",
        url: `/api/vendors/${encodeURIComponent(vendorName)}`,
        headers: { cookie: cookieHeader(secondBrowserJar), "user-agent": "erp-integration-test-second-browser" },
      });
      assert.equal(detailAfterSecondLogin.statusCode, 200);
      assert.equal(detailAfterSecondLogin.json().data.거래처명, vendorName);

      const dbVendor = await prisma.vendor.findUniqueOrThrow({ where: { businessNumber } });
      createdVendorId = dbVendor.id;
      assert.equal(dbVendor.name, vendorName);
      assert.equal(dbVendor.taxInvoiceEmail, taxEmail);
      assert.equal(dbVendor.bankAccountMasked.includes("110-555-777777"), false);
      assert.match(dbVendor.bankAccountEncrypted, /^v1:/);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "vendor",
          entityId: dbVendor.id,
          actorId: user.id,
          action: "create",
        },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(auditLog, "vendor create must write an audit log");
      assert.ok(auditLog.requestId, "audit log must carry the backend request id");
      assert.equal(auditLog.reason, vendorName);
    } finally {
      if (createdVendorId) {
        await prisma.vendor.delete({ where: { id: createdVendorId } }).catch(() => undefined);
      }
      await app.close();
      await prisma.$disconnect();
    }
  });
});
