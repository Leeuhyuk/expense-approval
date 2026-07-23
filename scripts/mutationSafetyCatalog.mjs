import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function slashPath(path) {
  return path.split(sep).join("/");
}

function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function route(method, path, sourcePath, options) {
  return {
    method,
    path,
    sourcePath,
    requiresIdempotency: options.requiresIdempotency ?? true,
    requiresAudit: options.requiresAudit ?? true,
    requiresConcurrency: options.requiresConcurrency ?? false,
    auditSnippets: options.auditSnippets ?? ["auditLog.create", "createAudit("],
    concurrencySnippets: options.concurrencySnippets ?? ["rowVersion", "expectedAuditLogId", "updateMany", "deleteMany"],
    extraSnippets: options.extraSnippets ?? [],
    matrixSnippet: options.matrixSnippet,
    kind: "standard",
  };
}

function delegate(method, path, sourcePath, options = {}) {
  return {
    method,
    path,
    sourcePath,
    kind: "delegate",
    requiresIdempotency: options.requiresIdempotency ?? true,
    extraSnippets: ["app.inject", ...(options.extraSnippets ?? [])],
    matrixSnippet: options.matrixSnippet,
  };
}

function exception(method, path, sourcePath, options) {
  return {
    method,
    path,
    sourcePath,
    kind: "exception",
    extraSnippets: options.extraSnippets ?? [],
    matrixSnippet: options.matrixSnippet,
  };
}

function readOnlyReject(method, path, sourcePath) {
  return {
    method,
    path,
    sourcePath,
    kind: "read-only-reject",
    extraSnippets: ["대시보드는 읽기 전용입니다.", "fail(reply"],
  };
}

const pageResources = "backend/src/routes/pageResources.ts";

export const mutationRouteCatalog = [
  exception("POST", "/auth/login", "backend/src/routes/auth.ts", {
    matrixSnippet: "POST /auth/login",
    extraSnippets: ["verifyPassword(", "failWithFailureSecurityEvent"],
  }),
  exception("POST", "/auth/logout", "backend/src/routes/auth.ts", {
    matrixSnippet: "/auth/logout",
    extraSnippets: ["clearSession(", "clearCsrfCookie("],
  }),
  exception("POST", "/auth/refresh", "backend/src/routes/auth.ts", {
    matrixSnippet: "/auth/refresh",
    extraSnippets: ["refreshSession(", "issueCsrfCookie("],
  }),
  exception("PATCH", "/notifications/:id/read", "backend/src/routes/notifications.ts", {
    matrixSnippet: "PATCH /notifications/{id}/read",
    extraSnippets: ["readAt: item.readAt ?? new Date()"],
  }),
  exception("POST", "/notifications/read-all", "backend/src/routes/notifications.ts", {
    matrixSnippet: "POST /notifications/read-all",
    extraSnippets: ["readAt: null", "updateMany"],
  }),
  exception("POST", "/operations/business-failure-alerts/notify", "backend/src/routes/operations.ts", {
    matrixSnippet: "POST /operations/business-failure-alerts/notify",
    extraSnippets: ["notifyBusinessFailureOwners()"],
  }),

  route("POST", "/payment-requests", "backend/src/routes/paymentRequests.ts", {
    requiresConcurrency: false,
    matrixSnippet: "결제 요청",
    extraSnippets: ["findPaymentIdempotencyReplay", "prisma.$transaction("],
  }),
  route("PATCH", "/payment-requests/:requestCode", "backend/src/routes/paymentRequests.ts", {
    requiresConcurrency: true,
    matrixSnippet: "결제 요청",
    extraSnippets: ["readPaymentExpectedRowVersion", "rowVersion: before.rowVersion"],
  }),
  route("DELETE", "/payment-requests/:requestCode", "backend/src/routes/paymentRequests.ts", {
    requiresConcurrency: true,
    matrixSnippet: "결제 요청",
    extraSnippets: ["canDeletePaymentRequest", "deletedAt", "rowVersion: before.rowVersion"],
  }),
  delegate("POST", "/payment-requests/:requestCode/:action", "backend/src/routes/paymentRequests.ts", {
    matrixSnippet: "결제 요청",
    extraSnippets: ["rowVersion", "idempotencyKey", "/api/payment-requests/"],
  }),

  route("PATCH", "/approvals/:requestCode", "backend/src/routes/approvals.ts", {
    requiresConcurrency: true,
    matrixSnippet: "승인",
    extraSnippets: ["readApprovalIdempotencyKey", "결재RowVersion", "요청RowVersion"],
  }),
  delegate("POST", "/approvals/:requestCode/:action", "backend/src/routes/approvals.ts", {
    matrixSnippet: "승인",
    extraSnippets: ["idempotencyKey", "/api/approvals/"],
  }),

  route("POST", "/disbursements/bank-result-reconcile", "backend/src/routes/disbursements.ts", {
    requiresConcurrency: false,
    matrixSnippet: "은행 결과 대사",
    extraSnippets: ["validateBankResultReconciliation", "bank_result_reconcile"],
  }),
  route("PATCH", "/disbursements/:disbursementCode", "backend/src/routes/disbursements.ts", {
    requiresConcurrency: true,
    matrixSnippet: "지급",
    extraSnippets: ["validateDisbursementMutationControls", "rowVersion: Number(patch.rowVersion)"],
  }),
  route("POST", "/disbursements/:disbursementCode/execution-approval", "backend/src/routes/disbursements.ts", {
    requiresConcurrency: true,
    matrixSnippet: "지급",
    extraSnippets: ["validateExecutionControls", "executionApprovalAction"],
  }),
  delegate("POST", "/disbursements/:disbursementCode/:action", "backend/src/routes/disbursements.ts", {
    matrixSnippet: "지급",
    extraSnippets: ["idempotencyKey", "rowVersion", "/api/disbursements/"],
  }),

  route("POST", "/files/presign-upload", "backend/src/routes/files.ts", {
    requiresConcurrency: false,
    matrixSnippet: "POST /files/presign-upload",
    extraSnippets: ["presignUploadSchema", "presign_upload"],
  }),
  exception("PUT", "/files/:id/content", "backend/src/routes/files.ts", {
    matrixSnippet: "PUT /files/{id}/content",
    extraSnippets: ["verifyToken(params.id, \"upload\"", "scanAttachmentBuffer", "writeStoredFile"],
  }),
  route("POST", "/files/complete", "backend/src/routes/files.ts", {
    requiresConcurrency: false,
    matrixSnippet: "POST /files/complete",
    extraSnippets: ["completeSchema", "complete_upload"],
  }),
  route("DELETE", "/files/:id", "backend/src/routes/files.ts", {
    requiresConcurrency: false,
    matrixSnippet: "DELETE /files/{id}",
    extraSnippets: ["deleteStoredFile", "action: \"delete\""],
  }),

  readOnlyReject("POST", "/dashboard", pageResources),
  readOnlyReject("PATCH", "/dashboard/:requestCode", pageResources),
  readOnlyReject("DELETE", "/dashboard/:requestCode", pageResources),
  readOnlyReject("POST", "/dashboard/:requestCode/:action", pageResources),

  route("POST", "/budgets/:departmentName/adjustments", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "예산",
    extraSnippets: ["readBudgetAdjustmentInput", "STALE_BUDGET"],
  }),
  route("POST", "/budgets", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "예산",
    extraSnippets: ["createAudit", "idempotencyKey"],
  }),
  route("PATCH", "/budgets/:departmentName", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "예산",
    extraSnippets: ["예산RowVersion", "updateMany"],
  }),
  delegate("POST", "/budgets/:departmentName/:action", pageResources, {
    matrixSnippet: "예산",
    extraSnippets: ["idempotencyKey", "/api/budgets/"],
  }),

  route("POST", "/vendors", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "거래처",
    extraSnippets: ["validateVendorRow", "createAudit"],
  }),
  route("PATCH", "/vendors/:vendorName", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "거래처",
    extraSnippets: ["거래처RowVersion", "updateMany"],
  }),
  delegate("DELETE", "/vendors/:vendorName", pageResources, {
    matrixSnippet: "거래처",
    extraSnippets: ["idempotencyKey", "rowVersion", "/api/vendors/"],
  }),
  delegate("POST", "/vendors/:vendorName/:action", pageResources, {
    matrixSnippet: "거래처",
    extraSnippets: ["idempotencyKey", "rowVersion", "/api/vendors/"],
  }),

  route("POST", "/reports/schedules", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "보고서",
    extraSnippets: ["report_schedule", "createAudit"],
  }),
  route("PATCH", "/reports/schedules/:scheduleId", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "보고서",
    extraSnippets: ["예약RowVersion", "updateMany"],
  }),
  route("DELETE", "/reports/schedules/:scheduleId", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "보고서",
    extraSnippets: ["예약RowVersion", "updateMany"],
  }),
  route("POST", "/reports", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "보고서",
    extraSnippets: ["report_run", "createAudit"],
  }),
  route("PATCH", "/reports/:reportName", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "보고서",
    extraSnippets: ["보고서RowVersion", "updateMany"],
  }),
  route("DELETE", "/reports/:reportName", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "보고서",
    extraSnippets: ["보고서RowVersion", "updateMany"],
  }),
  delegate("POST", "/reports/:reportName/:action", pageResources, {
    matrixSnippet: "보고서",
    extraSnippets: ["idempotencyKey", "보고서RowVersion", "/api/reports/"],
  }),

  route("PATCH", "/settings/config/:settingKey", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "시스템 설정 스냅샷",
    concurrencySnippets: ["expectedAuditLogId", "currentAuditLogId"],
    extraSnippets: ["readSystemSettingSaveBody", "settings_", "idempotencyKey"],
  }),
  route("POST", "/settings/integrations/:integrationId/test", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "외부 연동 테스트",
    extraSnippets: ["settings_integration_test", "integrationTestResultFromSetting"],
  }),
  route("POST", "/settings/roles", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "설정 권한",
    extraSnippets: ["settings_role_create", "createAudit"],
  }),
  route("PATCH", "/settings/roles/:roleId", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "설정 권한",
    extraSnippets: ["rowVersion", "updateMany"],
  }),
  route("DELETE", "/settings/roles/:roleId", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "설정 권한",
    extraSnippets: ["rowVersion", "deleteMany"],
  }),
  route("POST", "/settings", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "설정 권한",
    extraSnippets: ["settings_create", "createAudit"],
  }),
  route("PATCH", "/settings/:userName", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "설정 권한",
    extraSnippets: ["사용자RowVersion", "updateMany"],
  }),
  delegate("DELETE", "/settings/:userName", pageResources, {
    matrixSnippet: "설정 권한",
    extraSnippets: ["idempotencyKey", "사용자RowVersion", "/api/settings/"],
  }),
  delegate("POST", "/settings/:userName/:action", pageResources, {
    matrixSnippet: "설정 권한",
    extraSnippets: ["idempotencyKey", "사용자RowVersion", "/api/settings/"],
  }),

  route("POST", "/favorites", pageResources, {
    requiresConcurrency: false,
    matrixSnippet: "즐겨찾기",
    extraSnippets: ["favorite_item", "createAudit"],
  }),
  route("PATCH", "/favorites/:label", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "즐겨찾기",
    extraSnippets: ["즐겨찾기RowVersion", "updateMany"],
  }),
  route("DELETE", "/favorites/:label", pageResources, {
    requiresConcurrency: true,
    matrixSnippet: "즐겨찾기",
    extraSnippets: ["즐겨찾기RowVersion", "updateMany"],
  }),
  delegate("POST", "/favorites/:label/:action", pageResources, {
    matrixSnippet: "즐겨찾기",
    extraSnippets: ["idempotencyKey", "즐겨찾기RowVersion", "/api/favorites/"],
  }),
];

function readRouteFiles(projectRoot) {
  const routesDir = resolve(projectRoot, "backend/src/routes");
  if (!existsSync(routesDir)) return new Map();
  const files = new Map();
  for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const absolutePath = join(routesDir, entry.name);
    files.set(slashPath(relative(projectRoot, absolutePath)), readFileSync(absolutePath, "utf8"));
  }
  return files;
}

export function extractMutationRoutes(routeFiles) {
  const routes = [];
  for (const [sourcePath, source] of routeFiles.entries()) {
    const matches = [...source.matchAll(/app\.(post|patch|put|delete)\("([^"]+)"/g)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = match.index ?? 0;
      const next = matches[index + 1]?.index ?? source.length;
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        sourcePath,
        block: source.slice(start, next),
      });
    }
  }
  return routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}

function hasAny(source, snippets) {
  return snippets.some((snippet) => source.includes(snippet));
}

function hasAll(source, snippets) {
  return snippets.every((snippet) => source.includes(snippet));
}

function issue(issues, routeEntry, ruleId, message) {
  issues.push({
    route: routeKey(routeEntry),
    sourcePath: routeEntry.sourcePath,
    ruleId,
    message,
  });
}

export function evaluateMutationSafety(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const routeFiles = options.routeFiles ?? readRouteFiles(projectRoot);
  const apiSpec = options.apiSpec ?? readFileSync(resolve(projectRoot, "docs/api-spec.md"), "utf8");
  const matrix = options.matrix ?? readFileSync(resolve(projectRoot, "docs/mutation-safety-matrix.md"), "utf8");
  const discoveredRoutes = extractMutationRoutes(routeFiles);
  const discoveredByKey = new Map(discoveredRoutes.map((item) => [routeKey(item), item]));
  const catalogByKey = new Map(mutationRouteCatalog.map((item) => [routeKey(item), item]));
  const issues = [];

  for (const discovered of discoveredRoutes) {
    if (!catalogByKey.has(routeKey(discovered))) {
      issue(issues, discovered, "uncatalogued-mutation-route", "Mutation route must be classified as standard, delegated, read-only reject, or approved exception.");
    }
  }

  for (const expected of mutationRouteCatalog) {
    const discovered = discoveredByKey.get(routeKey(expected));
    if (!discovered) {
      issue(issues, expected, "missing-mutation-route", "Catalogued mutation route is not implemented.");
      continue;
    }
    if (slashPath(discovered.sourcePath) !== expected.sourcePath) {
      issue(issues, expected, "route-source-mismatch", `Route is implemented in ${discovered.sourcePath}, expected ${expected.sourcePath}.`);
    }

    if (expected.matrixSnippet && !matrix.includes(expected.matrixSnippet) && !apiSpec.includes(expected.matrixSnippet)) {
      issue(issues, expected, "missing-mutation-documentation", `Missing mutation safety documentation snippet: ${expected.matrixSnippet}`);
    }

    if (expected.kind === "standard") {
      if (expected.requiresIdempotency && !discovered.block.includes("idempotencyKey")) {
        issue(issues, expected, "missing-idempotency-key", "Standard mutation route must read or persist idempotencyKey.");
      }
      if (expected.requiresAudit && !hasAny(discovered.block, expected.auditSnippets)) {
        issue(issues, expected, "missing-audit-log", "Standard mutation route must write an audit log or use createAudit.");
      }
      if (expected.requiresConcurrency && !hasAny(discovered.block, expected.concurrencySnippets)) {
        issue(issues, expected, "missing-concurrency-control", "Standard update/delete route must check rowVersion, expected audit id, or conditional DB writes.");
      }
      if (!hasAll(discovered.block, expected.extraSnippets)) {
        issue(issues, expected, "missing-route-evidence", `Route is missing evidence snippets: ${expected.extraSnippets.filter((snippet) => !discovered.block.includes(snippet)).join(", ")}`);
      }
    }

    if (expected.kind === "delegate") {
      if (expected.requiresIdempotency && !discovered.block.includes("idempotencyKey")) {
        issue(issues, expected, "missing-delegated-idempotency", "Delegated mutation route must forward idempotencyKey.");
      }
      if (!hasAll(discovered.block, expected.extraSnippets)) {
        issue(issues, expected, "missing-delegation-evidence", `Delegated route is missing evidence snippets: ${expected.extraSnippets.filter((snippet) => !discovered.block.includes(snippet)).join(", ")}`);
      }
    }

    if (expected.kind === "exception" || expected.kind === "read-only-reject") {
      if (!hasAll(discovered.block, expected.extraSnippets)) {
        issue(issues, expected, "missing-exception-evidence", `Route exception is missing evidence snippets: ${expected.extraSnippets.filter((snippet) => !discovered.block.includes(snippet)).join(", ")}`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    discoveredRoutes,
    catalogRoutes: mutationRouteCatalog,
  };
}
