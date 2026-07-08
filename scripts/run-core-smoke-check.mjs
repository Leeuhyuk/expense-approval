#!/usr/bin/env node
const baseUrl = (process.env.CORE_SMOKE_API_BASE_URL || process.env.VITE_ERP_API_BASE_URL || "").replace(/\/+$/, "");
const email = process.env.CORE_SMOKE_EMAIL || "";
const password = process.env.CORE_SMOKE_PASSWORD || "";
const requireAuth = ["1", "true", "yes", "on"].includes((process.env.CORE_SMOKE_REQUIRE_AUTH || "").toLowerCase());
const timeoutMs = Number(process.env.CORE_SMOKE_TIMEOUT_MS || 10_000);

const publicChecks = [
  "/health",
  "/health/version",
  "/health/db",
  "/health/storage",
  "/health/file-security",
  "/health/jobs",
  "/health/integrations",
];
const authenticatedChecks = [
  "/auth/me",
  "/notifications",
  "/dashboard?page=1&pageSize=5",
  "/payment-requests?page=1&pageSize=5",
  "/approvals?page=1&pageSize=5",
  "/disbursements?page=1&pageSize=5",
  "/budgets?page=1&pageSize=5",
  "/vendors?page=1&pageSize=5",
  "/reports?page=1&pageSize=5",
  "/settings?page=1&pageSize=5",
  "/operations/mode",
];
const privilegedChecks = [
  "/operations/alerts",
  "/operations/business-failure-alerts",
  "/operations/data-quality",
];

function print(status, message) {
  console.log(`[core-smoke] ${status} ${message}`);
}

function fail(message) {
  print("FAIL", message);
  process.exitCode = 1;
}

function apiUrl(path) {
  if (!baseUrl) throw new Error("CORE_SMOKE_API_BASE_URL or VITE_ERP_API_BASE_URL is required.");
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

function cookieHeader(cookies) {
  return cookies.join("; ");
}

function csrfFromCookies(cookies) {
  const pair = cookies.find((cookie) => cookie.startsWith("erp_csrf="));
  return pair ? decodeURIComponent(pair.slice("erp_csrf=".length)) : "";
}

async function request(path, init = {}) {
  const response = await fetch(apiUrl(path), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload, cookies: parseCookies(response.headers) };
}

function expectSuccess(label, result) {
  const requestId = result.payload?.meta?.requestId || result.response.headers.get("x-request-id") || "requestId-missing";
  if (!result.response.ok || result.payload?.status !== "success") {
    throw new Error(`${label} failed status=${result.response.status} requestId=${requestId} body=${JSON.stringify(result.payload)}`);
  }
  print("PASS", `${label} status=${result.response.status} requestId=${requestId}`);
  return result.payload?.data;
}

async function runPublicChecks() {
  for (const path of publicChecks) {
    const result = await request(path);
    expectSuccess(path, result);
  }
}

async function login() {
  if (!email || !password) {
    if (requireAuth) throw new Error("CORE_SMOKE_EMAIL and CORE_SMOKE_PASSWORD are required when CORE_SMOKE_REQUIRE_AUTH=true.");
    print("WARN", "auth smoke skipped because CORE_SMOKE_EMAIL/PASSWORD are not set");
    return null;
  }

  const result = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expectSuccess("/auth/login", result);
  const cookies = result.cookies;
  const csrf = csrfFromCookies(cookies);
  if (!cookies.some((cookie) => cookie.startsWith("erp_session="))) throw new Error("/auth/login did not return erp_session cookie.");
  if (!csrf) throw new Error("/auth/login did not return erp_csrf cookie.");
  return { cookies, csrf };
}

async function runAuthenticatedChecks(session) {
  if (!session) return;
  const headers = { Cookie: cookieHeader(session.cookies), "X-CSRF-Token": session.csrf };
  for (const path of authenticatedChecks) {
    const result = await request(path, { headers });
    expectSuccess(path, result);
  }

  if (["1", "true", "yes", "on"].includes((process.env.CORE_SMOKE_INCLUDE_PRIVILEGED || "true").toLowerCase())) {
    for (const path of privilegedChecks) {
      const result = await request(path, { headers });
      expectSuccess(path, result);
    }
  }
}

try {
  await runPublicChecks();
  const session = await login();
  await runAuthenticatedChecks(session);
  if (!process.exitCode) print("PASS", "core smoke completed");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}