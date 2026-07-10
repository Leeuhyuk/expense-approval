import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const appUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const projectRoot = process.cwd();
const artifactDir = join(projectRoot, "generated-images", "automated-tests");

async function isServerReady() {
  try {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes("<title>결제 요청 승인 ERP</title>");
  } catch {
    return false;
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dev server did not become ready: ${appUrl}`);
}

async function startDevServerIfNeeded() {
  if (await isServerReady()) {
    return async () => {};
  }

  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
        cwd: projectRoot,
        env: { ...process.env, BROWSER: "none" },
        stdio: "ignore",
      })
    : spawn("npm", ["run", "dev"], {
        cwd: projectRoot,
        env: { ...process.env, BROWSER: "none" },
        stdio: "ignore",
      });

  child.unref();
  await waitForServer();

  return async () => {
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("exit", resolve);
        killer.on("error", resolve);
      });
      return;
    }
    child.kill("SIGTERM");
  };
}

test("ERP notification and report download smoke flow", async (t) => {
  await mkdir(artifactDir, { recursive: true });
  const cleanup = await startDevServerIfNeeded();
  t.after(cleanup);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`${appUrl}/#dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector(".erp-shell", { timeout: 10_000 });

    await page.locator(".notification-anchor .icon-button").click();
    await page.waitForSelector(".notification-panel", { timeout: 10_000 });
    assert.equal(await page.locator(".notification-item").count(), 9);
    assert.equal(await page.locator(".notification-item.unread").count(), 6);
    await page.locator(".notification-panel header button").click();
    await page.waitForFunction(() => document.querySelectorAll(".notification-item.unread").length === 0, null, { timeout: 10_000 });
    assert.equal(await page.locator(".notification-anchor .icon-button i").count(), 0);
    await page.locator(".notification-anchor .icon-button").click();
    await page.waitForSelector(".notification-panel", { state: "detached", timeout: 10_000 });

    await page.goto(`${appUrl}/#payment-request`, { waitUntil: "networkidle" });
    await page.waitForSelector(".payment-request-table", { timeout: 10_000 });
    await page.locator(".payment-request-table .table-sort-button", { hasText: "금액" }).click();
    await page.waitForTimeout(300);
    assert.match(await page.locator(".payment-request-table tbody tr").first().innerText(), /215,000 원/);
    await page.locator(".payment-toolbar-actions button[aria-label='새로고침']").click();
    await page.locator(".payment-new-button").click();
    await page.locator("select[aria-label='거래처 선택']").selectOption("클라우드존(주)");
    await page.locator("select[aria-label='부서 선택']").selectOption("IT운영팀");
    await page.locator("input[aria-label='금액 입력']").fill("360000");
    const longPaymentReason = "클라우드 서비스 월 사용료 정산 및 장문 입력 검증 ".repeat(10);
    await page.locator("textarea[aria-label='요청 사유 입력']").fill(longPaymentReason);
    assert.equal(await page.locator("textarea[aria-label='요청 사유 입력']").inputValue(), longPaymentReason);
    await page.locator("input[aria-label='증빙 파일 업로드']").setInputFiles({
      name: "세금계산서_클라우드존.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 payment evidence"),
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".panel-action-message")).some((node) => node.textContent?.includes("파일이 업로드")),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-long-input.png") });
    await page.locator(".payment-info-actions .submit").click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("제출 완료"),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-payment-request.png") });

    await page.goto(`${appUrl}/#approval`, { waitUntil: "networkidle" });
    await page.waitForSelector(".approval-request-table", { timeout: 10_000 });
    await page.locator(".approval-plain-button", { hasText: "내 요청" }).click();
    assert.match(await page.locator(".approval-plain-button", { hasText: "내 요청" }).getAttribute("class"), /active/);
    await page.locator(".approval-request-table tbody tr", { hasText: "PR-2024-0051" }).click();
    await page.locator(".approval-bulk-button").click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("일괄 승인 요청 완료"),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator(".panel-action-message").first().innerText(), /부분 실패|감사 로그/);
    await page.locator(".approval-request-table tbody tr", { hasText: "PR-2024-0056" }).click();
    await page.locator(".approval-reason-field textarea").fill("계약 금액 증빙 보완 필요");
    await page.locator(".approval-detail-actions .reject").click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("반려 처리 완료"),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-approval.png") });

    await page.goto(`${appUrl}/#disbursement`, { waitUntil: "networkidle" });
    await page.waitForSelector(".disbursement-request-table", { timeout: 10_000 });
    await page.locator(".disbursement-bulk-button").click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("일괄 지급 완료"),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator(".panel-action-message").first().innerText(), /부분 실패|재시도/);
    await page.locator(".disbursement-request-table tbody tr", { hasText: "PMT-2024-0083" }).click();
    await page.waitForSelector(".disbursement-error-card", { timeout: 10_000 });
    const retryButton = page.locator(".disbursement-detail-actions button", { hasText: "재처리" });
    assert.equal(await retryButton.isDisabled(), true);
    await page.locator(".disbursement-account-card button", { hasText: "계좌 재확인" }).click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("계좌 확인 완료"),
      null,
      { timeout: 10_000 },
    );

    await page.locator(".disbursement-reason-field textarea").fill("계좌 확인 후 지급 일정 재검토");
    await page.locator(".disbursement-detail-actions button", { hasText: "보류" }).click();
    await page.waitForFunction(
      () => document.querySelector(".panel-action-message")?.textContent?.includes("지급 보류 완료"),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-disbursement.png") });

    await page.goto(`${appUrl}/#budget`, { waitUntil: "networkidle" });
    await page.waitForSelector(".budget-table", { timeout: 10_000 });
    await page.locator(".budget-table tbody tr", { hasText: "구매팀" }).click();
    await page.locator(".management-primary-button", { hasText: "예산 조정" }).click();
    await page.waitForSelector(".budget-adjust-panel", { timeout: 10_000 });
    await page.locator("input[aria-label='예산 조정 금액 입력']").fill("35000000");
    await page.locator("input[aria-label='예산 조정 사유 입력']").fill("초과 위험 완화");
    await page.locator(".budget-adjust-panel button", { hasText: "조정 적용" }).click();
    await page.waitForFunction(
      () => document.querySelector(".budget-message")?.textContent?.includes("구매팀 예산"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".budget-filter-group .management-filter").nth(0).click();
    assert.match(await page.locator(".budget-filter-group .management-filter").nth(0).innerText(), /2026-01-01 ~ 2026-06-30/);
    await page.locator(".budget-filter-group .management-filter").nth(1).click();
    await page.locator(".budget-filter-group .management-filter").nth(2).click();
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-budget.png") });

    await page.goto(`${appUrl}/#vendors`, { waitUntil: "networkidle" });
    await page.waitForSelector(".vendor-table", { timeout: 10_000 });
    await page.locator("input[aria-label='거래처 검색']").fill("이노베이션");
    await page.waitForFunction(() => document.querySelectorAll(".vendor-table tbody tr").length === 1, null, { timeout: 10_000 });
    await page.locator("input[aria-label='거래처 검색']").fill("");
    await page.locator(".management-primary-button", { hasText: "거래처 추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("거래처 등록 폼"),
      null,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => document.querySelector(".vendor-detail-title strong")?.textContent?.includes("신규거래처"),
      null,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => document.querySelector("input[aria-label='거래처명 입력']")?.value?.includes("신규거래처"),
      null,
      { timeout: 10_000 },
    );
    await page.locator("input[aria-label='사업자번호 입력']").fill("123-81-45678");
    await page.locator("input[aria-label='거래처 담당자 입력']").fill("홍길동 과장");
    await page.locator("input[aria-label='은행명 입력']").fill("신한은행");
    await page.locator("input[aria-label='계좌번호 입력']").fill("110-555-777777");
    await page.locator("input[aria-label='세금계산서 이메일 입력']").fill("tax-new@example.com");
    await page.waitForFunction(
      () => document.querySelector("input[aria-label='사업자번호 입력']")?.value === "123-81-45678",
      null,
      { timeout: 10_000 },
    );
    await page.locator(".vendor-detail-actions .save").click();
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("사업자번호가 이미 등록"),
      null,
      { timeout: 10_000 },
    );
    await page.locator("input[aria-label='사업자번호 입력']").fill("999-00-77777");
    await page.locator("input[aria-label='거래처 증빙 파일 업로드']").setInputFiles({
      name: "사업자등록증_신규거래처.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 vendor evidence"),
    });
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("증빙 파일 1개가 업로드"),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator(".vendor-document-list").innerText(), /사업자등록증_신규거래처.pdf/);
    await page.locator(".vendor-detail-actions .save").click();
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("저장되었습니다"),
      null,
      { timeout: 10_000 },
    );

    const vendorDocumentDownload = await Promise.all([
      page.waitForEvent("download"),
      page.locator("button[aria-label='사업자등록증_신규거래처.pdf 다운로드']").click(),
    ]).then(([download]) => download);
    const vendorDocumentPath = join(artifactDir, await vendorDocumentDownload.suggestedFilename());
    await vendorDocumentDownload.saveAs(vendorDocumentPath);
    assert.ok((await stat(vendorDocumentPath)).size > 10);
    await page.locator("button[aria-label='사업자등록증_신규거래처.pdf 삭제']").click();
    await page.waitForFunction(
      () => !document.querySelector(".vendor-document-list")?.textContent?.includes("사업자등록증_신규거래처.pdf"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".vendor-recheck-button").click();
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("계좌 확인이 완료"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".vendor-detail-actions .danger").click();
    await page.waitForFunction(
      () => document.querySelector(".vendor-message")?.textContent?.includes("비활성화되었습니다"),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-vendors.png") });

    await page.goto(`${appUrl}/#reports`, { waitUntil: "networkidle" });
    await page.waitForSelector(".export-card", { timeout: 10_000 });
    await page.locator(".report-type-tabs button", { hasText: "지급" }).click();
    await page.locator(".reports-toolbar .management-primary-button", { hasText: "보고서 생성" }).click();
    await page.waitForFunction(
      () => document.querySelector(".report-message")?.textContent?.includes("지급 보고서 생성 완료"),
      null,
      { timeout: 10_000 },
    );
    await page.locator("input[aria-label='보고서명 검색']").fill("보고서");
    await page.locator(".reports-table button", { hasText: "상세 보기" }).first().click();
    await page.waitForSelector(".report-preview-card", { timeout: 10_000 });
    await page.locator(".schedule-card header button", { hasText: "추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".export-message")?.textContent?.includes("예약 발송이 추가"),
      null,
      { timeout: 10_000 },
    );
    const exportButtons = page.locator(".export-card button");
    const csvDownload = await Promise.all([page.waitForEvent("download"), exportButtons.nth(0).click()]).then(([download]) => download);
    const csvPath = join(artifactDir, await csvDownload.suggestedFilename());
    await csvDownload.saveAs(csvPath);
    const pdfDownload = await Promise.all([page.waitForEvent("download"), exportButtons.nth(1).click()]).then(([download]) => download);
    const pdfPath = join(artifactDir, await pdfDownload.suggestedFilename());
    await pdfDownload.saveAs(pdfPath);

    const csvStat = await stat(csvPath);
    const pdfStat = await stat(pdfPath);
    assert.ok(csvStat.size > 100);
    assert.ok(pdfStat.size > 100);
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-reports.png") });

    await page.goto(`${appUrl}/#settings`, { waitUntil: "networkidle" });
    await page.waitForSelector(".settings-management-page", { timeout: 10_000 });
    await page.locator(".approval-limit-card .add-row-button", { hasText: "구간 추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("승인 한도 구간이 추가"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".approval-limit-card tbody tr").last().locator("input[aria-label$='필수 승인자 수']").fill("5");
    await page.locator(".approval-limit-card tbody tr").last().locator("button", { hasText: "저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("승인 한도 구간이 수정"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".approval-limit-card tbody tr").last().locator("button", { hasText: "삭제" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("승인 한도 구간이 삭제"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".approval-rule-card .toggle-row", { hasText: "거래처 예외 결재선" }).click();
    await page.locator(".approval-rule-card .settings-card-save", { hasText: "결재선 규칙 저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("결재선 규칙이 저장"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".settings-top-tabs button", { hasText: "사용자 권한" }).click();
    await page.waitForSelector(".role-permission-card", { timeout: 10_000 });
    await page.locator("input[aria-label='권한 그룹명 입력']").fill("프로젝트 결재자");
    await page.locator("select[aria-label='권한 템플릿 선택']").selectOption("승인 중심");
    await page.locator(".role-permission-card header button", { hasText: "권한 그룹 추가" }).click();
    await page.waitForSelector("text=프로젝트 결재자", { timeout: 10_000 });
    await page.locator("button[aria-label='프로젝트 결재자 지급 관리 권한 전환']").click();
    await page.locator("select[aria-label='권한 그룹 선택']").selectOption({ label: "프로젝트 결재자" });
    await page.locator("input[aria-label='사용자 입력']").fill("홍길동");
    await page.locator("select[aria-label='역할 선택']").selectOption("정산 담당자");
    await page.locator(".user-add-card .add-row-button", { hasText: "추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("홍길동 사용자 권한이 추가"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".settings-top-tabs button", { hasText: "알림" }).click();
    await page.waitForSelector(".settings-notification-card", { timeout: 10_000 });
    await page.locator(".settings-notification-card .settings-toggle-button", { hasText: "정책 변경 알림" }).click();
    await page.locator(".settings-notification-card .settings-card-save", { hasText: "알림 설정 저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("알림 설정이 저장"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".settings-top-tabs button", { hasText: "연동" }).click();
    await page.waitForSelector(".settings-integration-card", { timeout: 10_000 });
    await page.locator("button[aria-label='세금계산서 수집 연동 상태 변경']").click();
    await page.locator(".settings-integration-card .settings-card-save", { hasText: "연동 설정 저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("외부 연동 설정 구조"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".settings-top-tabs button", { hasText: "결재 정책" }).click();
    await page.waitForSelector(".settings-policy-grid", { timeout: 10_000 });
    await page.locator(".settings-actions .save", { hasText: "저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".settings-message")?.textContent?.includes("결재 정책이 저장"),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator(".settings-history-panel").innerText(), /결재 정책 저장/);
    assert.match(await page.locator(".settings-scope-card").innerText(), /신규 결제 요청/);
    assert.match(await page.locator(".settings-scope-card").innerText(), /스냅샷/);
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-settings.png") });

    await page.goto(`${appUrl}/#favorites`, { waitUntil: "networkidle" });
    await page.waitForSelector(".favorites-management-page", { timeout: 10_000 });
    assert.ok(await page.locator(".favorite-card-grid button").count() >= 4);
    assert.ok(await page.locator(".saved-filter-grid button").count() >= 3);
    await page.locator(".favorites-toolbar .management-primary-button", { hasText: "바로가기 추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("바로가기가 추가"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".favorites-toolbar .management-primary-button", { hasText: "바로가기 추가" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("이미 추가된"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".favorites-toolbar .management-secondary-button", { hasText: "사용자 저장" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("사용자별 즐겨찾기"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".favorites-toolbar .management-secondary-button", { hasText: "순서 편집" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("순서를 편집"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".favorite-table tbody tr", { hasText: "구 시스템 설정" }).click();
    assert.match(await page.locator(".favorite-detail-panel").innerText(), /비활성 메뉴 기준/);
    assert.match(await page.locator(".favorite-detail-panel").innerText(), /메뉴: 비활성/);
    await page.locator(".favorite-table tbody tr", { hasText: "예산 초과 알림" }).click();
    assert.match(await page.locator(".favorite-detail-panel").innerText(), /예산상태: 초과/);
    await page.locator(".favorite-related-actions .delete").click();
    await page.locator(".favorite-delete-confirm button", { hasText: "삭제 확인" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("즐겨찾기를 삭제"),
      null,
      { timeout: 10_000 },
    );
    await page.locator(".favorite-undo-bar button", { hasText: "undo" }).click();
    await page.waitForFunction(
      () => document.querySelector(".favorites-message")?.textContent?.includes("즐겨찾기를 복구"),
      null,
      { timeout: 10_000 },
    );
    await page.screenshot({ fullPage: true, path: join(artifactDir, "ui-smoke-favorites.png") });

    assert.equal(await page.locator(".vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]").count(), 0);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});

test("ERP viewport and long-input smoke flow", async (t) => {
  await mkdir(artifactDir, { recursive: true });
  const cleanup = await startDevServerIfNeeded();
  t.after(cleanup);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const viewportCases = [
      { name: "1920", width: 1920, height: 1080, routes: ["#dashboard", "#payment-request", "#approval", "#disbursement", "#budget", "#vendors", "#reports", "#settings", "#favorites"] },
      { name: "1280", width: 1280, height: 800, routes: ["#dashboard", "#payment-request", "#reports"] },
      { name: "mobile", width: 390, height: 844, routes: ["#dashboard", "#favorites"] },
    ];

    for (const viewportCase of viewportCases) {
      const context = await browser.newContext({ viewport: { width: viewportCase.width, height: viewportCase.height } });
      const page = await context.newPage();
      for (const route of viewportCase.routes) {
        await page.goto(`${appUrl}/${route}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".erp-shell", { timeout: 10_000 });
        assert.equal(await page.locator(".vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]").count(), 0);
      }
      await page.screenshot({ fullPage: true, path: join(artifactDir, `ui-viewport-${viewportCase.name}.png`) });
      await page.keyboard.press("Tab");
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
      assert.ok(["button", "input", "select", "textarea", "a"].includes(focusedTag ?? ""));
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
