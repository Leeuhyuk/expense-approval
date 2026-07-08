import assert from "node:assert/strict";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { chromium } from "playwright";

const scrypt = promisify(scryptCallback);
const testDatabaseUrl = process.env.ERP_TEST_DATABASE_URL ?? "";
const testPassword = "RemoteE2E#2026";
const uiPort = Number(process.env.REMOTE_E2E_UI_PORT ?? 5174);
const apiPort = Number(process.env.REMOTE_E2E_API_PORT ?? 4101);
const uiBaseUrl = `http://127.0.0.1:${uiPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}/api`;

function guardTestDatabaseUrl(url) {
  const lower = url.toLowerCase();
  if (/(^|[/:@._-])prod(uction)?([/:@._-]|$)/.test(lower)) {
    throw new Error("ERP_TEST_DATABASE_URL must not point to a production database.");
  }
  if (!lower.includes("test") && process.env.ERP_ALLOW_NON_TEST_DATABASE_URL !== "true") {
    throw new Error("ERP_TEST_DATABASE_URL must look like a disposable test database, or set ERP_ALLOW_NON_TEST_DATABASE_URL=true explicitly.");
  }
}

async function hashPassword(password, salt = randomBytes(16)) {
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64url"), Buffer.from(key).toString("base64url")].join("$");
}

async function waitForUrl(url, timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function commandForNpm(args) {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", ["npm", ...args].join(" ")] };
  }
  return { command: "npm", args };
}

function startProcess(args, env) {
  const command = commandForNpm(args);
  const child = spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  child.unref();

  return {
    child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
          killer.on("exit", resolve);
          killer.on("error", resolve);
          return;
        }
        child.once("exit", resolve);
        child.kill("SIGTERM");
      }),
  };
}

async function seedRemoteUser() {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { PrismaClient } = await import("../../backend/generated/prisma/index.js");
  const prisma = new PrismaClient();
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const departmentName = `Remote E2E Department ${runId}`;
  const roleCode = `REMOTE_E2E_ADMIN_${runId}`;
  const email = `remote-e2e-${runId}@example.test`;

  const department = await prisma.department.create({ data: { name: departmentName } });
  const role = await prisma.role.create({
    data: {
      code: roleCode,
      name: `Remote E2E Admin ${runId}`,
      permissions: ["*"],
      isActive: true,
    },
  });
  const user = await prisma.user.create({
    data: {
      departmentId: department.id,
      name: `Remote E2E User ${runId}`,
      email,
      passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
      isActive: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  return {
    email,
    name: user.name,
    cleanup: async () => {
      await prisma.authSession.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.userRole.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      await prisma.role.delete({ where: { id: role.id } }).catch(() => undefined);
      await prisma.department.delete({ where: { id: department.id } }).catch(() => undefined);
      await prisma.$disconnect();
    },
  };
}

test("remote mode browser login persists session and logs out against backend/test DB", { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run remote browser auth E2E." }, async (t) => {
  guardTestDatabaseUrl(testDatabaseUrl);
  const seeded = await seedRemoteUser();
  let backend;
  let frontend;
  let browser;

  try {
    backend = startProcess(["--prefix", "backend", "run", "dev"], {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      FRONTEND_ORIGIN: uiBaseUrl,
      RATE_LIMIT_DISABLED: "true",
      CSRF_SECRET: "remote-e2e-csrf-secret-000000000000",
      FILE_URL_SECRET: "remote-e2e-file-url-secret-0000000000",
      BANK_ACCOUNT_SECRET: "remote-e2e-bank-account-secret-0000",
    });
    await waitForUrl(`${apiBaseUrl}/health`);

    frontend = startProcess(["run", "dev", "--", "--port", String(uiPort), "--strictPort"], {
      BROWSER: "none",
      VITE_ERP_API_MODE: "remote",
      VITE_ERP_API_BASE_URL: apiBaseUrl,
    });
    await waitForUrl(uiBaseUrl);

    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`${uiBaseUrl}/#dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("input[aria-label='로그인 이메일']", { timeout: 15_000 });
    await page.locator("input[aria-label='로그인 이메일']").fill(seeded.email);
    await page.locator("input[aria-label='로그인 비밀번호']").fill(testPassword);
    await page.locator(".auth-submit").click();
    await page.waitForSelector(".erp-shell", { timeout: 20_000 });
    await page.waitForSelector(`text=${seeded.name}`, { timeout: 10_000 });

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".erp-shell", { timeout: 20_000 });
    await page.goto(`${uiBaseUrl}/#settings`, { waitUntil: "networkidle" });
    await page.waitForSelector(".settings-management-page", { timeout: 20_000 });

    await page.locator("button[aria-label='로그아웃']").click();
    await page.waitForSelector("input[aria-label='로그인 이메일']", { timeout: 15_000 });
    assert.deepEqual(consoleErrors, []);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (frontend) await frontend.stop();
    if (backend) await backend.stop();
    await seeded.cleanup();
  }
});
