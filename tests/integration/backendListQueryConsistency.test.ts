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

async function login(app: { inject: Function }, email: string) {
  const jar: Record<string, string> = {};
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": "erp-list-query-integration-test" },
    payload: { email, password: testPassword },
  });

  assert.equal(response.statusCode, 200);
  captureCookies(response, jar);
  assert.ok(jar.erp_session, "login must issue an auth session cookie");
  return jar;
}

describe("backend list query consistency", () => {
  it("keeps server search filters sorting and pagination consistent with DB results", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." }, async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    setIntegrationEnvironment(testDatabaseUrl);

    const [{ prisma }, { hashPassword }, { buildApp }] = await Promise.all([
      import("../../backend/src/db/prisma"),
      import("../../backend/src/auth/password"),
      import("../../backend/src/app"),
    ]);
    const runId = randomUUID().replace(/-/g, "").slice(0, 10);
    const email = `list-query-${runId}@example.test`;
    const vendorPrefix = `목록일치-${runId}`;
    const roleCode = `LIST_QUERY_${runId.toUpperCase()}`;
    const departmentName = `목록검증-${runId}`;
    const vendorNames = Array.from({ length: 12 }, (_, index) => `${vendorPrefix}-${String(index + 1).padStart(2, "0")}`);
    const createdVendorIds: string[] = [];

    const app = await buildApp({ logger: false });
    try {
      const department = await prisma.department.create({ data: { name: departmentName } });
      const role = await prisma.role.create({
        data: { code: roleCode, name: `목록 검증 ${runId}`, permissions: ["vendor:read"], isActive: true },
      });
      const user = await prisma.user.create({
        data: {
          departmentId: department.id,
          name: `목록 검증 사용자 ${runId}`,
          email,
          passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
          isActive: true,
          roles: { create: { roleId: role.id } },
        },
      });

      const created = await prisma.$transaction(vendorNames.map((name, index) => prisma.vendor.create({
        data: {
          name,
          businessNumber: `7${runId.slice(0, 2)}-${String(index + 1).padStart(2, "0")}-${runId.slice(2, 7)}`,
          managerName: `담당자-${index + 1}`,
          bankName: "검증은행",
          bankAccountEncrypted: `v1:test-${runId}-${index + 1}`,
          bankAccountMasked: `***-${String(index + 1).padStart(4, "0")}`,
          taxInvoiceEmail: `vendor-${index + 1}-${runId}@example.test`,
          accountVerificationStatus: index % 3 === 0 ? "PENDING" : "VERIFIED",
          status: index % 4 === 0 ? "INACTIVE" : "ACTIVE",
          isActive: index % 4 !== 0,
        },
      })));
      createdVendorIds.push(...created.map((vendor) => vendor.id));

      const jar = await login(app, email);
      const query = new URLSearchParams({
        search: vendorPrefix,
        "filter.상태__in": "활성",
        sort: "거래처명:desc",
        page: "2",
        pageSize: "3",
      });
      const response = await app.inject({
        method: "GET",
        url: `/api/vendors?${query}`,
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-list-query-integration-test" },
      });
      const payload = response.json();

      assert.equal(response.statusCode, 200);
      assert.equal(payload.status, "success");

      const dbRows = await prisma.vendor.findMany({
        where: { id: { in: createdVendorIds }, status: "ACTIVE", isActive: true },
        select: { name: true },
      });
      const expectedNames = dbRows
        .map((vendor) => vendor.name)
        .filter((name) => name.toLowerCase().includes(vendorPrefix.toLowerCase()))
        .sort((a, b) => -a.localeCompare(b, "ko-KR"));
      const expectedPage = expectedNames.slice(3, 6);

      assert.equal(payload.data.total, expectedNames.length);
      assert.equal(payload.data.page, 2);
      assert.equal(payload.data.pageSize, 3);
      assert.deepEqual(payload.data.rows.map((row: Record<string, string>) => row.거래처명), expectedPage);

      const firstPageQuery = new URLSearchParams(query);
      firstPageQuery.set("page", "1");
      const firstPage = await app.inject({
        method: "GET",
        url: `/api/vendors?${firstPageQuery}`,
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-list-query-integration-test" },
      });
      const firstPageNames = firstPage.json().data.rows.map((row: Record<string, string>) => row.거래처명);
      assert.deepEqual(firstPageNames, expectedNames.slice(0, 3));
      assert.equal(firstPageNames.some((name: string) => expectedPage.includes(name)), false, "adjacent pages must not overlap");

      await prisma.authSession.deleteMany({ where: { userId: user.id } });
    } finally {
      await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } }).catch(() => undefined);
      await app.close();
      await prisma.$disconnect();
    }
  });
});
