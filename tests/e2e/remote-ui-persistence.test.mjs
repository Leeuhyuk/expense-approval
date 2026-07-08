import assert from "node:assert/strict";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { chromium } from "playwright";

const scrypt = promisify(scryptCallback);
const testDatabaseUrl = process.env.ERP_TEST_DATABASE_URL ?? "";
const testPassword = "RemoteE2E#2026";
const uiPort = Number(process.env.REMOTE_UI_PERSISTENCE_UI_PORT ?? 5175);
const apiPort = Number(process.env.REMOTE_UI_PERSISTENCE_API_PORT ?? 4102);
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

async function seedRemoteAdmin() {
  process.env.DATABASE_URL = testDatabaseUrl;
  const { PrismaClient } = await import("../../backend/generated/prisma/index.js");
  const prisma = new PrismaClient();
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const department = await prisma.department.create({ data: { name: `Remote UI Department ${runId}` } });
  const role = await prisma.role.create({
    data: {
      code: `REMOTE_UI_ADMIN_${runId.toUpperCase()}`,
      name: `Remote UI Admin ${runId}`,
      permissions: ["*"],
      isActive: true,
    },
  });
  const user = await prisma.user.create({
    data: {
      departmentId: department.id,
      name: `Remote UI User ${runId}`,
      email: `remote-ui-${runId}@example.test`,
      passwordHash: await hashPassword(testPassword, Buffer.from(`salt-${runId}`)),
      isActive: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  return {
    runId,
    departmentId: department.id,
    departmentName: department.name,
    email: user.email,
    userId: user.id,
    prisma,
    cleanup: async ({ businessNumber, storageDir, roleNames = [] }) => {
      const vendor = businessNumber ? await prisma.vendor.findUnique({ where: { businessNumber } }).catch(() => null) : null;
      if (vendor) {
        const attachments = await prisma.attachment.findMany({ where: { ownerType: "VENDOR", ownerId: vendor.id } }).catch(() => []);
        await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((item) => item.id) } } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { entityId: vendor.id },
              { entityId: { in: attachments.map((item) => item.id) } },
            ],
          },
        }).catch(() => undefined);
        await prisma.vendor.delete({ where: { id: vendor.id } }).catch(() => undefined);
      }
      await prisma.reportSchedule.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      const ownedDefinitions = await prisma.reportDefinition.findMany({ where: { ownerId: user.id }, select: { id: true } }).catch(() => []);
      await prisma.reportSchedule.deleteMany({ where: { definitionId: { in: ownedDefinitions.map((item) => item.id) } } }).catch(() => undefined);
      await prisma.reportRun.deleteMany({ where: { createdBy: user.id } }).catch(() => undefined);
      await prisma.reportDefinition.deleteMany({ where: { ownerId: user.id } }).catch(() => undefined);
      await prisma.favoriteItem.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      if (roleNames.length > 0) {
        const extraRoles = await prisma.role.findMany({ where: { name: { in: roleNames } }, select: { id: true } }).catch(() => []);
        await prisma.userRole.deleteMany({ where: { roleId: { in: extraRoles.map((item) => item.id) } } }).catch(() => undefined);
        await prisma.role.deleteMany({ where: { id: { in: extraRoles.map((item) => item.id) } } }).catch(() => undefined);
      }
      await prisma.authSession.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.userRole.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: user.id } }).catch(() => undefined);
      await prisma.securityEvent.deleteMany({ where: { actorId: user.id } }).catch(() => undefined);
      await prisma.notification.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      await prisma.role.delete({ where: { id: role.id } }).catch(() => undefined);
      await prisma.department.delete({ where: { id: department.id } }).catch(() => undefined);
      await prisma.$disconnect();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

async function loginRemotePage(page, email) {
  await page.waitForSelector("input[aria-label='로그인 이메일']", { timeout: 15_000 });
  await page.locator("input[aria-label='로그인 이메일']").fill(email);
  await page.locator("input[aria-label='로그인 비밀번호']").fill(testPassword);
  await page.locator(".auth-submit").click();
}

async function seedRemotePaymentWorkflow(seeded) {
  const prisma = seeded.prisma;
  const runDigits = [...seeded.runId].map((char) => String(parseInt(char, 16) % 10)).join("");
  const businessNumber = `6${runDigits.slice(0, 2)}-${runDigits.slice(2, 4)}-${runDigits.slice(4, 9)}`;
  const vendor = await prisma.vendor.create({
    data: {
      name: `원격결제거래처-${seeded.runId}`,
      businessNumber,
      managerName: "원격 결제 담당자",
      bankName: "신한은행",
      bankAccountEncrypted: `remote-test-encrypted-${seeded.runId}`,
      bankAccountMasked: "110-****-7777",
      taxInvoiceEmail: `remote-pay-${seeded.runId}@example.test`,
      taxInvoiceIssueType: "전자세금계산서 연동",
      accountVerificationStatus: "VERIFIED",
      status: "ACTIVE",
      isActive: true,
    },
  });
  const budget = await prisma.budget.create({
    data: {
      departmentId: seeded.departmentId,
      fiscalYear: "2099",
      allocatedAmount: "90000000.00",
      usedAmount: "0.00",
      status: "NORMAL",
    },
  });
  const budgetItem = await prisma.budgetItem.create({
    data: {
      budgetId: budget.id,
      name: `원격 UI 운영비 ${seeded.runId}`,
      allocatedAmount: "90000000.00",
      usedAmount: "0.00",
      status: "NORMAL",
    },
  });
  const approvalRole = await prisma.role.create({
    data: {
      code: `REMOTE_UI_APPROVER_${seeded.runId.toUpperCase()}`,
      name: `Remote UI Approver ${seeded.runId}`,
      permissions: ["approval:act", "approval:read_assigned", "payment_request:read_all"],
      isActive: true,
    },
  });
  const [approverOne, approverTwo] = await Promise.all([
    prisma.user.create({
      data: {
        departmentId: seeded.departmentId,
        name: `001 원격 승인자 ${seeded.runId}`,
        email: `remote-approver-1-${seeded.runId}@example.test`,
        passwordHash: await hashPassword(testPassword, Buffer.from(`approver-one-${seeded.runId}`)),
        isActive: true,
      },
    }),
    prisma.user.create({
      data: {
        departmentId: seeded.departmentId,
        name: `002 원격 승인자 ${seeded.runId}`,
        email: `remote-approver-2-${seeded.runId}@example.test`,
        passwordHash: await hashPassword(testPassword, Buffer.from(`approver-two-${seeded.runId}`)),
        isActive: true,
      },
    }),
  ]);
  await prisma.userRole.createMany({
    data: [
      { userId: approverOne.id, roleId: approvalRole.id },
      { userId: approverTwo.id, roleId: approvalRole.id },
    ],
  });

  const approvedRequest = await prisma.paymentRequest.create({
    data: {
      requestCode: `PR-REMOTE-DISB-${seeded.runId.toUpperCase()}`,
      requesterId: seeded.userId,
      departmentId: seeded.departmentId,
      vendorId: vendor.id,
      budgetItemId: budgetItem.id,
      amount: "120000.00",
      status: "APPROVED",
      reason: `원격 지급 보류 검증 ${seeded.runId}`,
      requestedAt: new Date("2026-07-06T00:00:00.000Z"),
    },
  });
  await prisma.approvalStep.createMany({
    data: [
      {
        paymentRequestId: approvedRequest.id,
        stepOrder: 1,
        approverId: approverOne.id,
        status: "APPROVED",
        actedAt: new Date("2026-07-06T01:00:00.000Z"),
      },
      {
        paymentRequestId: approvedRequest.id,
        stepOrder: 2,
        approverId: approverTwo.id,
        status: "APPROVED",
        actedAt: new Date("2026-07-06T01:10:00.000Z"),
      },
    ],
  });
  const disbursement = await prisma.disbursement.create({
    data: {
      disbursementCode: `PMT-REMOTE-${seeded.runId.toUpperCase()}`,
      paymentRequestId: approvedRequest.id,
      vendorId: vendor.id,
      amount: "120000.00",
      scheduledDate: new Date("2026-07-06T00:00:00.000Z"),
      status: "SCHEDULED",
      accountVerificationStatus: "VERIFIED",
    },
  });

  return {
    businessNumber,
    vendorId: vendor.id,
    vendorName: vendor.name,
    budgetId: budget.id,
    budgetItemId: budgetItem.id,
    budgetItemName: budgetItem.name,
    approvalRoleId: approvalRole.id,
    approverOneId: approverOne.id,
    approverOneEmail: approverOne.email,
    approverOneName: approverOne.name,
    approverTwoId: approverTwo.id,
    approverTwoEmail: approverTwo.email,
    approverTwoName: approverTwo.name,
    approvedRequestId: approvedRequest.id,
    approvedRequestCode: approvedRequest.requestCode,
    disbursementId: disbursement.id,
    disbursementCode: disbursement.disbursementCode,
  };
}

async function cleanupRemotePaymentWorkflow(seeded, workflow) {
  if (!workflow) return;
  const prisma = seeded.prisma;
  const paymentRequests = await prisma.paymentRequest.findMany({
    where: { vendorId: workflow.vendorId },
    select: { id: true, requestCode: true },
  }).catch(() => []);
  const paymentRequestIds = paymentRequests.map((item) => item.id);
  const requestCodes = paymentRequests.map((item) => item.requestCode);
  const actorIds = [seeded.userId, workflow.approverOneId, workflow.approverTwoId].filter(Boolean);
  const roleIds = [workflow.approvalRoleId].filter(Boolean);
  const attachmentIds = (await prisma.attachment.findMany({
    where: {
      OR: [
        { ownerId: { in: paymentRequestIds } },
        { uploadedBy: { in: actorIds } },
      ],
    },
    select: { id: true },
  }).catch(() => [])).map((item) => item.id);
  const entityIds = [
    ...paymentRequestIds,
    ...attachmentIds,
    workflow.vendorId,
    workflow.budgetItemId,
    workflow.budgetId,
    workflow.disbursementId,
    workflow.disbursementCode,
    workflow.approvalRoleId,
  ].filter(Boolean);

  await prisma.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: actorIds } },
        { entityId: { in: [...requestCodes, workflow.disbursementCode].filter(Boolean) } },
      ],
    },
  }).catch(() => undefined);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: actorIds } },
        { entityId: { in: entityIds } },
      ],
    },
  }).catch(() => undefined);
  await prisma.securityEvent.deleteMany({ where: { actorId: { in: actorIds } } }).catch(() => undefined);
  await prisma.disbursement.deleteMany({ where: { OR: [{ id: workflow.disbursementId }, { paymentRequestId: { in: paymentRequestIds } }] } }).catch(() => undefined);
  await prisma.approvalStep.deleteMany({ where: { paymentRequestId: { in: paymentRequestIds } } }).catch(() => undefined);
  await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } }).catch(() => undefined);
  await prisma.paymentRequest.deleteMany({ where: { id: { in: paymentRequestIds } } }).catch(() => undefined);
  await prisma.authSession.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => undefined);
  await prisma.userRole.deleteMany({
    where: {
      OR: [
        { userId: { in: [workflow.approverOneId, workflow.approverTwoId].filter(Boolean) } },
        { roleId: { in: roleIds } },
      ],
    },
  }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [workflow.approverOneId, workflow.approverTwoId].filter(Boolean) } } }).catch(() => undefined);
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } }).catch(() => undefined);
  await prisma.budgetItem.deleteMany({ where: { id: workflow.budgetItemId } }).catch(() => undefined);
  await prisma.budget.deleteMany({ where: { id: workflow.budgetId } }).catch(() => undefined);
  await prisma.vendor.deleteMany({ where: { id: workflow.vendorId } }).catch(() => undefined);
}

test(
  "remote mode browser vendor registration uploads evidence and persists after reload and second browser login",
  { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run remote UI persistence E2E." },
  async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    const seeded = await seedRemoteAdmin();
    const storageDir = resolve(".local-test-file-storage", `remote-ui-${seeded.runId}`);
    const vendorName = `브라우저검증거래처-${seeded.runId}`;
    const numericRunId = [...seeded.runId].map((char) => String(parseInt(char, 16) % 10)).join("");
    const businessNumber = `7${numericRunId.slice(0, 2)}-${numericRunId.slice(2, 4)}-${numericRunId.slice(4, 9)}`;
    const fileName = `사업자등록증_${seeded.runId}.pdf`;
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
        CSRF_SECRET: "remote-ui-csrf-secret-0000000000000",
        FILE_URL_SECRET: "remote-ui-file-url-secret-00000000000",
        BANK_ACCOUNT_SECRET: "remote-ui-bank-account-secret-00000",
        FILE_STORAGE_DRIVER: "local",
        FILE_STORAGE_DIR: storageDir,
        FILE_SCAN_MODE: "local",
      });
      await waitForUrl(`${apiBaseUrl}/health`);

      frontend = startProcess(["run", "dev", "--", "--port", String(uiPort), "--strictPort"], {
        BROWSER: "none",
        VITE_ERP_API_MODE: "remote",
        VITE_ERP_API_BASE_URL: apiBaseUrl,
      });
      await waitForUrl(uiBaseUrl);

      browser = await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto(`${uiBaseUrl}/#vendors`, { waitUntil: "networkidle" });
      await page.waitForSelector("input[aria-label='로그인 이메일']", { timeout: 15_000 });
      await page.locator("input[aria-label='로그인 이메일']").fill(seeded.email);
      await page.locator("input[aria-label='로그인 비밀번호']").fill(testPassword);
      await page.locator(".auth-submit").click();
      await page.waitForSelector(".vendor-management-page", { timeout: 20_000 });

      await page.locator(".management-primary-button", { hasText: "거래처 추가" }).click();
      await page.waitForSelector("input[aria-label='거래처명 입력']", { timeout: 10_000 });
      await page.locator("input[aria-label='거래처명 입력']").fill(vendorName);
      await page.locator("input[aria-label='사업자번호 입력']").fill(businessNumber);
      await page.locator("input[aria-label='거래처 담당자 입력']").fill("원격 UI 담당자");
      await page.locator("input[aria-label='은행명 입력']").fill("신한은행");
      await page.locator("input[aria-label='계좌번호 입력']").fill("110-900-123456");
      await page.locator("input[aria-label='세금계산서 이메일 입력']").fill(`remote-ui-${seeded.runId}@example.test`);
      await page.locator("input[aria-label='거래처 증빙 파일 업로드']").setInputFiles({
        name: fileName,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 remote vendor evidence\n%%EOF\n"),
      });
      await page.waitForFunction(
        () => document.querySelector(".vendor-message")?.textContent?.includes("업로드 대기"),
        null,
        { timeout: 10_000 },
      );
      await page.locator(".vendor-detail-actions .save").click();
      await page.waitForFunction(
        () => document.querySelector(".vendor-message")?.textContent?.includes("거래처 정보가 저장되었습니다"),
        null,
        { timeout: 20_000 },
      );
      await page.waitForFunction(
        (expectedFileName) => document.querySelector(".vendor-document-list")?.textContent?.includes(expectedFileName),
        fileName,
        { timeout: 10_000 },
      );

      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".vendor-management-page", { timeout: 20_000 });
      await page.locator("input[aria-label='거래처 검색']").fill(vendorName);
      await page.waitForFunction(
        (expectedVendorName) => document.querySelector(".vendor-table tbody")?.textContent?.includes(expectedVendorName),
        vendorName,
        { timeout: 20_000 },
      );
      await page.locator(".vendor-table tbody tr", { hasText: vendorName }).click();
      await page.waitForFunction(
        (expectedFileName) => document.querySelector(".vendor-document-list")?.textContent?.includes(expectedFileName),
        fileName,
        { timeout: 20_000 },
      );

      const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const secondPage = await secondContext.newPage();
      secondPage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`second-browser:${message.text()}`);
      });
      secondPage.on("pageerror", (error) => consoleErrors.push(`second-browser:${error.message}`));
      await secondPage.goto(`${uiBaseUrl}/#vendors`, { waitUntil: "networkidle" });
      await secondPage.waitForSelector("input[aria-label='로그인 이메일']", { timeout: 15_000 });
      await secondPage.locator("input[aria-label='로그인 이메일']").fill(seeded.email);
      await secondPage.locator("input[aria-label='로그인 비밀번호']").fill(testPassword);
      await secondPage.locator(".auth-submit").click();
      await secondPage.waitForSelector(".vendor-management-page", { timeout: 20_000 });
      await secondPage.locator("input[aria-label='거래처 검색']").fill(vendorName);
      await secondPage.waitForFunction(
        (expectedVendorName) => document.querySelector(".vendor-table tbody")?.textContent?.includes(expectedVendorName),
        vendorName,
        { timeout: 20_000 },
      );
      await secondPage.locator(".vendor-table tbody tr", { hasText: vendorName }).click();
      await secondPage.waitForFunction(
        (expectedFileName) => document.querySelector(".vendor-document-list")?.textContent?.includes(expectedFileName),
        fileName,
        { timeout: 20_000 },
      );
      await secondContext.close();

      const vendor = await seeded.prisma.vendor.findUniqueOrThrow({ where: { businessNumber } });
      assert.equal(vendor.name, vendorName);
      assert.match(vendor.bankAccountEncrypted, /^v1:/);
      assert.equal(vendor.bankAccountMasked.includes("110-900-123456"), false);

      const attachment = await seeded.prisma.attachment.findFirstOrThrow({
        where: { ownerType: "VENDOR", ownerId: vendor.id, fileName },
      });
      assert.notEqual(attachment.checksum, "pending");
      assert.equal(attachment.uploadedBy.length > 0, true);

      const vendorAudit = await seeded.prisma.auditLog.findFirst({
        where: { entityType: "vendor", entityId: vendor.id, action: "create" },
      });
      assert.ok(vendorAudit, "vendor creation from the browser must write an audit log");

      assert.deepEqual(consoleErrors, []);
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      if (frontend) await frontend.stop();
      if (backend) await backend.stop();
      await seeded.cleanup({ businessNumber, storageDir });
    }
  },
);

test(
  "remote mode browser favorites reports and settings changes persist after reload and second browser login",
  { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run remote screen-level persistence E2E." },
  async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    const seeded = await seedRemoteAdmin();
    const storageDir = resolve(".local-test-file-storage", `remote-screens-${seeded.runId}`);
    const shortcutTitle = `원격지속성바로가기-${seeded.runId}`;
    const roleName = `원격지속성권한-${seeded.runId}`;
    const generatedReportName = "2024-05 지급 보고서";
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
        CSRF_SECRET: "remote-screen-csrf-secret-000000000000",
        FILE_URL_SECRET: "remote-screen-file-url-secret-0000000000",
        BANK_ACCOUNT_SECRET: "remote-screen-bank-account-secret-0000",
        FILE_STORAGE_DRIVER: "local",
        FILE_STORAGE_DIR: storageDir,
        FILE_SCAN_MODE: "local",
      });
      await waitForUrl(`${apiBaseUrl}/health`);

      frontend = startProcess(["run", "dev", "--", "--port", String(uiPort), "--strictPort"], {
        BROWSER: "none",
        VITE_ERP_API_MODE: "remote",
        VITE_ERP_API_BASE_URL: apiBaseUrl,
      });
      await waitForUrl(uiBaseUrl);

      browser = await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto(`${uiBaseUrl}/#favorites`, { waitUntil: "networkidle" });
      await loginRemotePage(page, seeded.email);
      await page.waitForSelector(".favorites-management-page", { timeout: 20_000 });
      await page.locator("input[aria-label='바로가기 이름 입력']").fill(shortcutTitle);
      await page.locator("select[aria-label='바로가기 대상 화면 선택']").selectOption("reports");
      await page.locator("input[aria-label='바로가기 필터 조건 입력']").fill(`유형: 지급, 검증: ${seeded.runId}`);
      await page.locator(".favorites-toolbar .management-primary-button", { hasText: "바로가기 추가" }).click();
      await page.waitForFunction(
        (expectedTitle) => document.querySelector(".favorites-message")?.textContent?.includes("backend FavoriteItem") && document.body.textContent?.includes(expectedTitle),
        shortcutTitle,
        { timeout: 20_000 },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".favorites-management-page", { timeout: 20_000 });
      await page.waitForFunction((expectedTitle) => document.body.textContent?.includes(expectedTitle), shortcutTitle, { timeout: 20_000 });

      await page.goto(`${uiBaseUrl}/#reports`, { waitUntil: "networkidle" });
      await page.waitForSelector(".reports-management-page", { timeout: 20_000 });
      await page.locator(".report-type-tabs button", { hasText: "지급" }).click();
      await page.locator(".reports-toolbar .management-primary-button", { hasText: "보고서 생성" }).click();
      await page.waitForFunction(
        (expectedName) => document.querySelector(".report-message")?.textContent?.includes(`${expectedName} 생성 완료`),
        generatedReportName,
        { timeout: 20_000 },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".reports-management-page", { timeout: 20_000 });
      await page.waitForFunction((expectedName) => document.querySelector(".reports-table")?.textContent?.includes(expectedName), generatedReportName, { timeout: 20_000 });

      await page.goto(`${uiBaseUrl}/#settings`, { waitUntil: "networkidle" });
      await page.waitForSelector(".settings-management-page", { timeout: 20_000 });
      await page.locator(".settings-top-tabs button", { hasText: "사용자 권한" }).click();
      await page.waitForSelector(".role-permission-card", { timeout: 20_000 });
      await page.locator("input[aria-label='권한 그룹명 입력']").fill(roleName);
      await page.locator("input[aria-label='권한 그룹 유형 입력']").fill("검증");
      await page.locator("select[aria-label='권한 템플릿 선택']").selectOption("조회 중심");
      await page.locator(".role-permission-card header button", { hasText: "권한 그룹 추가" }).click();
      await page.waitForFunction(
        (expectedRole) => document.querySelector(".settings-message")?.textContent?.includes("backend 역할 설정") && document.body.textContent?.includes(expectedRole),
        roleName,
        { timeout: 20_000 },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".settings-management-page", { timeout: 20_000 });
      await page.locator(".settings-top-tabs button", { hasText: "사용자 권한" }).click();
      await page.waitForFunction((expectedRole) => document.body.textContent?.includes(expectedRole), roleName, { timeout: 20_000 });

      const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const secondPage = await secondContext.newPage();
      secondPage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`second-browser:${message.text()}`);
      });
      secondPage.on("pageerror", (error) => consoleErrors.push(`second-browser:${error.message}`));
      await secondPage.goto(`${uiBaseUrl}/#favorites`, { waitUntil: "networkidle" });
      await loginRemotePage(secondPage, seeded.email);
      await secondPage.waitForSelector(".favorites-management-page", { timeout: 20_000 });
      await secondPage.waitForFunction((expectedTitle) => document.body.textContent?.includes(expectedTitle), shortcutTitle, { timeout: 20_000 });
      await secondPage.goto(`${uiBaseUrl}/#reports`, { waitUntil: "networkidle" });
      await secondPage.waitForSelector(".reports-management-page", { timeout: 20_000 });
      await secondPage.waitForFunction((expectedName) => document.querySelector(".reports-table")?.textContent?.includes(expectedName), generatedReportName, { timeout: 20_000 });
      await secondPage.goto(`${uiBaseUrl}/#settings`, { waitUntil: "networkidle" });
      await secondPage.waitForSelector(".settings-management-page", { timeout: 20_000 });
      await secondPage.locator(".settings-top-tabs button", { hasText: "사용자 권한" }).click();
      await secondPage.waitForFunction((expectedRole) => document.body.textContent?.includes(expectedRole), roleName, { timeout: 20_000 });
      await secondContext.close();

      const favorite = await seeded.prisma.favoriteItem.findFirstOrThrow({ where: { userId: seeded.userId, label: shortcutTitle } });
      assert.equal(favorite.pageKey, "reports");
      assert.equal(favorite.isActive, true);
      const report = await seeded.prisma.reportRun.findFirstOrThrow({ where: { createdBy: seeded.userId, name: generatedReportName } });
      assert.equal(report.status, "READY");
      const role = await seeded.prisma.role.findFirstOrThrow({ where: { name: roleName } });
      assert.equal(role.isActive, true);
      assert.equal(Array.isArray(role.permissions), true);
      assert.ok(role.permissions.includes("report:read"), "조회 중심 권한 그룹은 보고서 조회 권한을 가져야 한다");

      assert.deepEqual(consoleErrors, []);
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      if (frontend) await frontend.stop();
      if (backend) await backend.stop();
      await seeded.cleanup({ businessNumber: "", storageDir, roleNames: [roleName] });
    }
  },
);

test(
  "remote mode browser payment submission approval handoff and disbursement hold persist with DB evidence",
  { skip: testDatabaseUrl ? false : "Set ERP_TEST_DATABASE_URL to run remote payment workflow persistence E2E." },
  async () => {
    guardTestDatabaseUrl(testDatabaseUrl);
    const seeded = await seedRemoteAdmin();
    const workflow = await seedRemotePaymentWorkflow(seeded);
    const storageDir = resolve(".local-test-file-storage", `remote-payment-${seeded.runId}`);
    const evidenceFileName = `결제증빙_${seeded.runId}.pdf`;
    const requestReason = `원격 결제 요청 브라우저 검증 ${seeded.runId}`;
    let submittedRequestCode = "";
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
        CSRF_SECRET: "remote-payment-csrf-secret-000000000",
        FILE_URL_SECRET: "remote-payment-file-url-secret-000000",
        BANK_ACCOUNT_SECRET: "remote-payment-bank-secret-00000000",
        FILE_STORAGE_DRIVER: "local",
        FILE_STORAGE_DIR: storageDir,
        FILE_SCAN_MODE: "local",
      });
      await waitForUrl(`${apiBaseUrl}/health`);

      frontend = startProcess(["run", "dev", "--", "--port", String(uiPort), "--strictPort"], {
        BROWSER: "none",
        VITE_ERP_API_MODE: "remote",
        VITE_ERP_API_BASE_URL: apiBaseUrl,
      });
      await waitForUrl(uiBaseUrl);

      browser = await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto(`${uiBaseUrl}/#payment-request`, { waitUntil: "networkidle" });
      await loginRemotePage(page, seeded.email);
      await page.waitForSelector(".payment-request-page", { timeout: 20_000 });
      await page.locator(".payment-new-button").click();
      await page.waitForSelector("select[aria-label='거래처 선택']", { timeout: 20_000 });
      await page.waitForFunction(
        (expectedVendorName) => Array.from(document.querySelectorAll("select[aria-label='거래처 선택'] option")).some((option) => option.value === expectedVendorName),
        workflow.vendorName,
        { timeout: 20_000 },
      );
      await page.locator("select[aria-label='거래처 선택']").selectOption(workflow.vendorName);
      await page.locator("select[aria-label='부서 선택']").selectOption(seeded.departmentName);
      await page.waitForFunction(
        (expectedBudgetItemId) => Array.from(document.querySelectorAll("select[aria-label='예산 항목 선택'] option")).some((option) => option.value === expectedBudgetItemId),
        workflow.budgetItemId,
        { timeout: 20_000 },
      );
      await page.locator("select[aria-label='예산 항목 선택']").selectOption(workflow.budgetItemId);
      await page.locator("input[aria-label='금액 입력']").fill("450000");
      await page.locator("textarea[aria-label='요청 사유 입력']").fill(requestReason);
      await page.waitForFunction(
        () => /^PR-/.test(document.querySelector(".payment-info-head strong")?.textContent?.trim() ?? ""),
        null,
        { timeout: 20_000 },
      );
      submittedRequestCode = (await page.locator(".payment-info-head strong").innerText()).trim();
      await page.locator("input[aria-label='증빙 파일 업로드']").setInputFiles({
        name: evidenceFileName,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 remote payment workflow evidence\n%%EOF\n"),
      });
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll(".panel-action-message")).some((node) => node.textContent?.includes("업로드되었습니다")),
        null,
        { timeout: 20_000 },
      );
      await page.locator(".payment-info-actions .submit").click();
      await page.waitForFunction(
        () => document.querySelector(".panel-action-message")?.textContent?.includes("제출 완료"),
        null,
        { timeout: 20_000 },
      );

      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".payment-request-page", { timeout: 20_000 });
      await page.locator("input[aria-label='결제 요청 검색']").fill(submittedRequestCode);
      await page.waitForFunction(
        (expectedRequestCode) => document.querySelector(".payment-request-table tbody")?.textContent?.includes(expectedRequestCode),
        submittedRequestCode,
        { timeout: 20_000 },
      );

      const approverOneContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const approverOnePage = await approverOneContext.newPage();
      approverOnePage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`approver-one:${message.text()}`);
      });
      approverOnePage.on("pageerror", (error) => consoleErrors.push(`approver-one:${error.message}`));
      await approverOnePage.goto(`${uiBaseUrl}/#approval`, { waitUntil: "networkidle" });
      await loginRemotePage(approverOnePage, workflow.approverOneEmail);
      await approverOnePage.waitForSelector(".approval-request-table", { timeout: 20_000 });
      await approverOnePage.locator("input[aria-label='결제 요청 승인 검색']").fill(submittedRequestCode);
      await approverOnePage.waitForFunction(
        (expectedRequestCode) => document.querySelector(".approval-request-table tbody")?.textContent?.includes(expectedRequestCode),
        submittedRequestCode,
        { timeout: 20_000 },
      );
      await approverOnePage.locator(".approval-request-table tbody tr", { hasText: submittedRequestCode }).click();
      await approverOnePage.locator(".approval-detail-actions .approve").click();
      await approverOnePage.waitForFunction(
        () => document.querySelector(".panel-action-message")?.textContent?.includes("승인 완료 처리 완료"),
        null,
        { timeout: 20_000 },
      );
      await approverOneContext.close();

      const approverTwoContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const approverTwoPage = await approverTwoContext.newPage();
      approverTwoPage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`approver-two:${message.text()}`);
      });
      approverTwoPage.on("pageerror", (error) => consoleErrors.push(`approver-two:${error.message}`));
      await approverTwoPage.goto(`${uiBaseUrl}/#approval`, { waitUntil: "networkidle" });
      await loginRemotePage(approverTwoPage, workflow.approverTwoEmail);
      await approverTwoPage.waitForSelector(".approval-request-table", { timeout: 20_000 });
      await approverTwoPage.locator("input[aria-label='결제 요청 승인 검색']").fill(submittedRequestCode);
      await approverTwoPage.waitForFunction(
        (expectedRequestCode) => document.querySelector(".approval-request-table tbody")?.textContent?.includes(expectedRequestCode),
        submittedRequestCode,
        { timeout: 20_000 },
      );
      await approverTwoPage.locator(".approval-request-table tbody tr", { hasText: submittedRequestCode }).click();
      await approverTwoPage.locator(".approval-detail-actions .approve").click();
      await approverTwoPage.waitForFunction(
        () => document.querySelector(".panel-action-message")?.textContent?.includes("승인 완료 처리 완료"),
        null,
        { timeout: 20_000 },
      );
      await approverTwoContext.close();

      const secondAdminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const secondAdminPage = await secondAdminContext.newPage();
      secondAdminPage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`second-admin:${message.text()}`);
      });
      secondAdminPage.on("pageerror", (error) => consoleErrors.push(`second-admin:${error.message}`));
      await secondAdminPage.goto(`${uiBaseUrl}/#payment-request`, { waitUntil: "networkidle" });
      await loginRemotePage(secondAdminPage, seeded.email);
      await secondAdminPage.waitForSelector(".payment-request-page", { timeout: 20_000 });
      await secondAdminPage.locator("input[aria-label='결제 요청 검색']").fill(submittedRequestCode);
      await secondAdminPage.waitForFunction(
        (expectedRequestCode) => document.querySelector(".payment-request-table tbody")?.textContent?.includes(expectedRequestCode) && document.querySelector(".payment-request-table tbody")?.textContent?.includes("승인 완료"),
        submittedRequestCode,
        { timeout: 20_000 },
      );
      await secondAdminContext.close();

      await page.goto(`${uiBaseUrl}/#disbursement`, { waitUntil: "networkidle" });
      await page.waitForSelector(".disbursement-request-table", { timeout: 20_000 });
      await page.locator("input[aria-label='지급 관리 검색']").fill(workflow.disbursementCode);
      await page.waitForFunction(
        (expectedDisbursementCode) => document.querySelector(".disbursement-request-table tbody")?.textContent?.includes(expectedDisbursementCode),
        workflow.disbursementCode,
        { timeout: 20_000 },
      );
      await page.locator(".disbursement-request-table tbody tr", { hasText: workflow.disbursementCode }).click();
      await page.locator(".disbursement-reason-field textarea").fill("원격 브라우저 지급 보류 검증");
      await page.locator(".disbursement-detail-actions button", { hasText: "보류" }).click();
      await page.waitForFunction(
        () => document.querySelector(".panel-action-message")?.textContent?.includes("지급 보류 완료"),
        null,
        { timeout: 20_000 },
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".disbursement-request-table", { timeout: 20_000 });
      await page.locator("input[aria-label='지급 관리 검색']").fill(workflow.disbursementCode);
      await page.waitForFunction(
        (expectedDisbursementCode) => document.querySelector(".disbursement-request-table tbody")?.textContent?.includes(expectedDisbursementCode) && document.querySelector(".disbursement-request-table tbody")?.textContent?.includes("보류"),
        workflow.disbursementCode,
        { timeout: 20_000 },
      );

      const submittedRequest = await seeded.prisma.paymentRequest.findUniqueOrThrow({
        where: { requestCode: submittedRequestCode },
        include: { approvalSteps: { orderBy: { stepOrder: "asc" } } },
      });
      assert.equal(submittedRequest.status, "APPROVED");
      assert.equal(submittedRequest.reason, requestReason);
      assert.deepEqual(submittedRequest.approvalSteps.map((step) => step.status), ["APPROVED", "APPROVED"]);
      assert.deepEqual(new Set(submittedRequest.approvalSteps.map((step) => step.approverId)), new Set([workflow.approverOneId, workflow.approverTwoId]));

      const evidenceAttachment = await seeded.prisma.attachment.findFirstOrThrow({
        where: { ownerType: "PAYMENT_REQUEST", ownerId: submittedRequest.id, fileName: evidenceFileName },
      });
      assert.equal(evidenceAttachment.uploadedBy, seeded.userId);
      assert.notEqual(evidenceAttachment.checksum, "pending");

      const approvalAudits = await seeded.prisma.auditLog.findMany({
        where: {
          entityType: "approval_step",
          actorId: { in: [workflow.approverOneId, workflow.approverTwoId] },
          entityId: { in: submittedRequest.approvalSteps.map((step) => step.id) },
        },
      });
      assert.equal(approvalAudits.length, 2);

      const heldDisbursement = await seeded.prisma.disbursement.findUniqueOrThrow({ where: { id: workflow.disbursementId } });
      assert.equal(heldDisbursement.status, "HELD");
      const holdAudit = await seeded.prisma.auditLog.findFirst({
        where: { entityType: "disbursement", entityId: workflow.disbursementId, action: "hold" },
      });
      assert.ok(holdAudit, "disbursement hold from the browser must write an audit log");

      assert.deepEqual(consoleErrors, []);
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      if (frontend) await frontend.stop();
      if (backend) await backend.stop();
      await cleanupRemotePaymentWorkflow(seeded, workflow);
      await seeded.cleanup({ businessNumber: "", storageDir });
    }
  },
);
