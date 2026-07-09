#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const baseUrl = (
  process.env.SYNTHETIC_MONITOR_API_BASE_URL ||
  process.env.CORE_SMOKE_API_BASE_URL ||
  process.env.VITE_ERP_API_BASE_URL ||
  ""
).replace(/\/+$/, "");
const email = process.env.SYNTHETIC_MONITOR_EMAIL || process.env.CORE_SMOKE_EMAIL || "";
const password = process.env.SYNTHETIC_MONITOR_PASSWORD || process.env.CORE_SMOKE_PASSWORD || "";
const timeoutMs = Number(process.env.SYNTHETIC_MONITOR_TIMEOUT_MS || 10_000);
const latencyTargetMs = Number(process.env.SYNTHETIC_MONITOR_MAX_LATENCY_MS || 3_000);
const requireConfig = ["1", "true", "yes", "on"].includes((process.env.SYNTHETIC_MONITOR_REQUIRE_CONFIG || "").toLowerCase());
const includePrivileged = ["1", "true", "yes", "on"].includes((process.env.SYNTHETIC_MONITOR_INCLUDE_PRIVILEGED || "true").toLowerCase());
const outputPath = process.env.SYNTHETIC_MONITOR_OUTPUT || "";

const publicChecks = [
  { id: "health", path: "/health", stage: "health" },
  { id: "health_db", path: "/health/db", stage: "health" },
  { id: "health_storage", path: "/health/storage", stage: "health" },
  { id: "health_jobs", path: "/health/jobs", stage: "health" },
];

const businessChecks = [
  { id: "auth_me", path: "/auth/me", stage: "login" },
  { id: "dashboard", path: "/dashboard?page=1&pageSize=5", stage: "overview" },
  { id: "payment_requests", path: "/payment-requests?page=1&pageSize=5", stage: "request" },
  { id: "approvals", path: "/approvals?page=1&pageSize=5", stage: "approval" },
  { id: "budgets", path: "/budgets?page=1&pageSize=5", stage: "budget" },
  { id: "vendors", path: "/vendors?page=1&pageSize=5", stage: "vendor" },
  { id: "reports", path: "/reports?page=1&pageSize=5", stage: "report" },
  { id: "disbursement_preflight", path: "/disbursements?page=1&pageSize=5", stage: "pre_disbursement" },
  { id: "operation_mode", path: "/operations/mode", stage: "operations" },
];

const privilegedChecks = [
  { id: "data_quality", path: "/operations/data-quality", stage: "operations" },
  { id: "financial_reconciliation", path: "/operations/financial-reconciliation", stage: "operations" },
  { id: "business_failure_alerts", path: "/operations/business-failure-alerts", stage: "operations" },
];

function log(status, message) {
  console.log(`[synthetic-monitor] ${status} ${message}`);
}

function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${suffix}`;
}

function parseCookies(headers) {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const fallback = headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  return [...raw, ...fallback]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/,(?=\s*[^;,=]+=[^;,]+)/))
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean);
}

function csrfFromCookies(cookies) {
  const pair = cookies.find((cookie) => cookie.startsWith("erp_csrf="));
  return pair ? decodeURIComponent(pair.slice("erp_csrf=".length)) : "";
}

function cookieHeader(cookies) {
  return cookies.join("; ");
}

async function request(path, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(apiUrl(path), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload, cookies: parseCookies(response.headers), latencyMs };
}

function rowFor(check, result, ok, message) {
  const requestId = result?.payload?.meta?.requestId || result?.response?.headers.get("x-request-id") || "";
  return {
    id: check.id,
    stage: check.stage,
    path: check.path,
    ok,
    statusCode: result?.response?.status ?? 0,
    latencyMs: result?.latencyMs ?? 0,
    requestId,
    message,
  };
}

async function runCheck(check, session) {
  const headers = session ? { Cookie: cookieHeader(session.cookies), "X-CSRF-Token": session.csrf } : {};
  try {
    const result = await request(check.path, { method: "GET", headers });
    const envelopeOk = result.response.ok && result.payload?.status === "success";
    const latencyOk = result.latencyMs <= latencyTargetMs;
    const ok = envelopeOk && latencyOk;
    const message = !envelopeOk
      ? `status=${result.response.status}`
      : latencyOk
        ? "ok"
        : `latency ${result.latencyMs}ms exceeds ${latencyTargetMs}ms`;
    log(ok ? "PASS" : "FAIL", `${check.id} ${message} requestId=${result.payload?.meta?.requestId || "n/a"}`);
    return rowFor(check, result, ok, message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("FAIL", `${check.id} ${message}`);
    return rowFor(check, null, false, message);
  }
}

async function login() {
  const result = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!result.response.ok || result.payload?.status !== "success") {
    throw new Error(`/auth/login failed status=${result.response.status}`);
  }
  const cookies = result.cookies;
  const csrf = csrfFromCookies(cookies);
  if (!cookies.some((cookie) => cookie.startsWith("erp_session="))) throw new Error("/auth/login did not return erp_session cookie.");
  if (!csrf) throw new Error("/auth/login did not return erp_csrf cookie.");
  log("PASS", `/auth/login status=${result.response.status} requestId=${result.payload?.meta?.requestId || "n/a"}`);
  return { cookies, csrf, loginLatencyMs: result.latencyMs };
}

function writeReport(report) {
  if (!outputPath) return;
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  log("PASS", `wrote ${outputPath}`);
}

function skippedReport(reason) {
  return {
    ok: !requireConfig,
    skipped: true,
    reason,
    generatedAt: new Date().toISOString(),
    summary: { checks: 0, failed: requireConfig ? 1 : 0, maxLatencyMs: 0 },
    checks: [],
  };
}

async function main() {
  if (!baseUrl || !email || !password) {
    const missing = [
      !baseUrl ? "SYNTHETIC_MONITOR_API_BASE_URL" : "",
      !email ? "SYNTHETIC_MONITOR_EMAIL" : "",
      !password ? "SYNTHETIC_MONITOR_PASSWORD" : "",
    ].filter(Boolean).join(", ");
    const report = skippedReport(`missing ${missing}`);
    writeReport(report);
    log(requireConfig ? "FAIL" : "SKIP", report.reason);
    process.exitCode = requireConfig ? 1 : 0;
    return;
  }

  const publicRows = [];
  for (const check of publicChecks) publicRows.push(await runCheck(check, null));
  const session = await login();
  const businessRows = [];
  for (const check of businessChecks) businessRows.push(await runCheck(check, session));
  if (includePrivileged) {
    for (const check of privilegedChecks) businessRows.push(await runCheck(check, session));
  }

  const checks = [...publicRows, ...businessRows];
  const failed = checks.filter((check) => !check.ok);
  const maxLatencyMs = Math.max(0, ...checks.map((check) => check.latencyMs));
  const report = {
    ok: failed.length === 0,
    skipped: false,
    generatedAt: new Date().toISOString(),
    baseUrl,
    latencyTargetMs,
    summary: {
      checks: checks.length,
      failed: failed.length,
      maxLatencyMs,
      stages: [...new Set(checks.map((check) => check.stage))],
    },
    checks,
  };
  writeReport(report);
  if (failed.length > 0) process.exitCode = 1;
  log(report.ok ? "PASS" : "FAIL", `completed checks=${checks.length} failed=${failed.length} maxLatencyMs=${maxLatencyMs}`);
}

main().catch((error) => {
  log("FAIL", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
