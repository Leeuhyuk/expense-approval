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

describe("backend settings persistence integration", () => {
  it("persists role and user permission changes across refresh and a second login", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run DB-backed integration tests." }, async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    setIntegrationEnvironment(testDatabaseUrl);

    const [{ prisma }, { hashPassword }, { buildApp }] = await Promise.all([
      import("../../backend/src/db/prisma"),
      import("../../backend/src/auth/password"),
      import("../../backend/src/app"),
    ]);
    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const adminEmail = `integration-settings-admin-${runId}@example.test`;
    const departmentName = `통합테스트설정부서-${runId}`;
    const roleName = `통합테스트권한-${runId}`;
    const userName = `통합테스트사용자-${runId}`;
    const adminRoleCode = "INTEGRATION_SETTINGS_ADMIN";
    let createdRoleId = "";
    let createdUserId = "";

    const app = await buildApp({ logger: false });
    try {
      const department = await prisma.department.create({ data: { name: departmentName } });
      const adminRole = await prisma.role.upsert({
        where: { code: adminRoleCode },
        update: { name: "통합 설정 테스트 관리자", permissions: ["system:manage", "dashboard:read"], isActive: true },
        create: { code: adminRoleCode, name: "통합 설정 테스트 관리자", permissions: ["system:manage", "dashboard:read"], isActive: true },
      });
      const adminUser = await prisma.user.create({
        data: {
          departmentId: department.id,
          name: "통합 설정 테스트 관리자",
          email: adminEmail,
          passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
          isActive: true,
        },
      });
      await prisma.userRole.create({ data: { userId: adminUser.id, roleId: adminRole.id } });

      const jar = await login(app, adminEmail);
      const createRoleKey = `settings-role-create-${runId}`;
      const roleCreated = await app.inject({
        method: "POST",
        url: "/api/settings/roles",
        headers: mutationHeaders(jar),
        payload: {
          name: roleName,
          tag: "그룹",
          permissions: ["report:read"],
          status: "활성",
          idempotencyKey: createRoleKey,
        },
      });
      const roleCreatedPayload = roleCreated.json();
      assert.equal(roleCreated.statusCode, 200);
      assert.equal(roleCreatedPayload.status, "success");
      assert.equal(roleCreatedPayload.data.name, roleName);
      assert.equal(roleCreatedPayload.data.rowVersion, 1);
      createdRoleId = roleCreatedPayload.data.id;

      const updateRoleKey = `settings-role-update-${runId}`;
      const roleUpdated = await app.inject({
        method: "PATCH",
        url: `/api/settings/roles/${encodeURIComponent(createdRoleId)}`,
        headers: mutationHeaders(jar),
        payload: {
          name: roleName,
          tag: "그룹",
          permissions: ["report:read", "system:manage"],
          status: "활성",
          rowVersion: roleCreatedPayload.data.rowVersion,
          idempotencyKey: updateRoleKey,
        },
      });
      const roleUpdatedPayload = roleUpdated.json();
      assert.equal(roleUpdated.statusCode, 200);
      assert.deepEqual(roleUpdatedPayload.data.permissions.sort(), ["report:read", "system:manage"].sort());
      assert.equal(roleUpdatedPayload.data.rowVersion, 2);

      const roleReplay = await app.inject({
        method: "PATCH",
        url: `/api/settings/roles/${encodeURIComponent(createdRoleId)}`,
        headers: mutationHeaders(jar),
        payload: {
          name: roleName,
          permissions: ["report:read", "system:manage"],
          status: "활성",
          rowVersion: roleCreatedPayload.data.rowVersion,
          idempotencyKey: updateRoleKey,
        },
      });
      assert.equal(roleReplay.statusCode, 200);
      assert.equal(roleReplay.json().meta.idempotencyReplay, true);

      const createUserKey = `settings-user-create-${runId}`;
      const userCreated = await app.inject({
        method: "POST",
        url: "/api/settings",
        headers: mutationHeaders(jar),
        payload: {
          사용자: userName,
          부서: departmentName,
          역할: "정산 담당자",
          권한그룹: roleName,
          상태: "활성",
          idempotencyKey: createUserKey,
        },
      });
      const userCreatedPayload = userCreated.json();
      assert.equal(userCreated.statusCode, 200);
      assert.equal(userCreatedPayload.status, "success");
      assert.equal(userCreatedPayload.data.사용자, userName);
      assert.equal(userCreatedPayload.data.권한그룹, roleName);
      assert.equal(userCreatedPayload.data.사용자RowVersion, "1");

      const updateUserKey = `settings-user-update-${runId}`;
      const userUpdated = await app.inject({
        method: "PATCH",
        url: `/api/settings/${encodeURIComponent(userName)}`,
        headers: mutationHeaders(jar),
        payload: {
          사용자: userName,
          부서: departmentName,
          역할: "정산 담당자",
          권한그룹: roleName,
          상태: "비활성",
          rowVersion: userCreatedPayload.data.사용자RowVersion,
          사용자RowVersion: userCreatedPayload.data.사용자RowVersion,
          idempotencyKey: updateUserKey,
        },
      });
      const userUpdatedPayload = userUpdated.json();
      assert.equal(userUpdated.statusCode, 200);
      assert.equal(userUpdatedPayload.data.상태, "비활성");
      assert.equal(userUpdatedPayload.data.사용자RowVersion, "2");

      const refreshed = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: mutationHeaders(jar),
        payload: {},
      });
      assert.equal(refreshed.statusCode, 200);
      captureCookies(refreshed, jar);

      const secondBrowserJar = await login(app, adminEmail);
      const listAfterSecondLogin = await app.inject({
        method: "GET",
        url: `/api/settings?search=${encodeURIComponent(userName)}&page=1&pageSize=10`,
        headers: { cookie: cookieHeader(secondBrowserJar), "user-agent": "erp-integration-test-second-browser" },
      });
      const listPayload = listAfterSecondLogin.json();
      assert.equal(listAfterSecondLogin.statusCode, 200);
      assert.equal(listPayload.data.total, 1);
      assert.equal(listPayload.data.rows[0].사용자, userName);
      assert.equal(listPayload.data.rows[0].권한그룹, roleName);
      assert.equal(listPayload.data.rows[0].상태, "비활성");
      assert.equal(listPayload.data.rows[0].사용자RowVersion, "2");

      const dbUser = await prisma.user.findFirstOrThrow({ where: { name: userName }, include: { roles: { include: { role: true } } } });
      createdUserId = dbUser.id;
      assert.equal(dbUser.isActive, false);
      assert.equal(dbUser.rowVersion, 2);
      assert.equal(dbUser.roles[0]?.role.id, createdRoleId);

      const dbRole = await prisma.role.findUniqueOrThrow({ where: { id: createdRoleId } });
      assert.equal(dbRole.rowVersion, 2);
      assert.deepEqual((dbRole.permissions as string[]).sort(), ["report:read", "system:manage"].sort());

      for (const idempotencyKey of [createRoleKey, updateRoleKey, createUserKey, updateUserKey]) {
        const auditLog = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
        assert.ok(auditLog, `${idempotencyKey} must be recorded in audit logs`);
        assert.equal(auditLog?.actorId, adminUser.id);
      }

      const configBefore = await app.inject({
        method: "GET",
        url: "/api/settings/config",
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-integration-test" },
      });
      const configBeforePayload = configBefore.json();
      assert.equal(configBefore.statusCode, 200);
      const expectedAuditLogId = configBeforePayload.data.__meta?.notifications?.auditLogId ?? null;
      const saveConfigKey = `settings-config-save-${runId}`;
      const notificationSnapshot = [{
        id: `integration-notification-${runId}`,
        label: "통합 테스트 알림",
        description: "설정 스냅샷 replay/conflict 검증",
        enabled: true,
      }];

      const configSaved = await app.inject({
        method: "PATCH",
        url: "/api/settings/config/notifications",
        headers: mutationHeaders(jar),
        payload: {
          value: notificationSnapshot,
          expectedAuditLogId,
          idempotencyKey: saveConfigKey,
          reason: "통합 설정 스냅샷 저장",
        },
      });
      const configSavedPayload = configSaved.json();
      assert.equal(configSaved.statusCode, 200);
      assert.equal(configSavedPayload.data[0].id, notificationSnapshot[0].id);
      assert.equal(configSavedPayload.meta.key, "notifications");
      assert.equal(typeof configSavedPayload.meta.auditLogId, "string");

      const configReplay = await app.inject({
        method: "PATCH",
        url: "/api/settings/config/notifications",
        headers: mutationHeaders(jar),
        payload: {
          value: notificationSnapshot,
          expectedAuditLogId,
          idempotencyKey: saveConfigKey,
          reason: "통합 설정 스냅샷 저장",
        },
      });
      const configReplayPayload = configReplay.json();
      assert.equal(configReplay.statusCode, 200);
      assert.equal(configReplayPayload.meta.idempotencyReplay, true);
      assert.equal(configReplayPayload.meta.auditLogId, configSavedPayload.meta.auditLogId);

      const staleConfigSave = await app.inject({
        method: "PATCH",
        url: "/api/settings/config/notifications",
        headers: mutationHeaders(jar),
        payload: {
          value: notificationSnapshot.map((item) => ({ ...item, enabled: false })),
          expectedAuditLogId,
          idempotencyKey: `settings-config-stale-${runId}`,
          reason: "오래된 설정 스냅샷 저장",
        },
      });
      assert.equal(staleConfigSave.statusCode, 409);
      assert.equal(staleConfigSave.json().error.code, "CONFLICT");

      const configAfter = await app.inject({
        method: "GET",
        url: "/api/settings/config",
        headers: { cookie: cookieHeader(jar), "user-agent": "erp-integration-test" },
      });
      const configAfterPayload = configAfter.json();
      assert.equal(configAfter.statusCode, 200);
      assert.equal(configAfterPayload.data.__meta.notifications.auditLogId, configSavedPayload.meta.auditLogId);
      assert.equal(configAfterPayload.data.notifications[0].id, notificationSnapshot[0].id);

      const configAuditLog = await prisma.auditLog.findUnique({ where: { idempotencyKey: saveConfigKey } });
      assert.equal(configAuditLog?.entityType, "system_setting");
      assert.equal(configAuditLog?.action, "settings_notifications_save");
      assert.equal(configAuditLog?.actorId, adminUser.id);
    } finally {
      if (createdUserId) await prisma.userRole.deleteMany({ where: { userId: createdUserId } }).catch(() => undefined);
      if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
      if (createdRoleId) await prisma.userRole.deleteMany({ where: { roleId: createdRoleId } }).catch(() => undefined);
      if (createdRoleId) await prisma.role.delete({ where: { id: createdRoleId } }).catch(() => undefined);
      await app.close();
      await prisma.$disconnect();
    }
  });
});
