import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { alertThreshold, alertWindowMinutes, evaluateAlertRule, operationalAlertRules } from "../../backend/src/operations/operationalAlerts";

const operationsRouteSource = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");
const appSource = readFileSync(resolve("backend/src/app.ts"), "utf8");
const prismaSource = readFileSync(resolve("backend/src/db/prisma.ts"), "utf8");

describe("backend operational alert checks", () => {
  it("keeps alert windows and thresholds configurable by environment", () => {
    assert.equal(alertWindowMinutes({ ALERT_WINDOW_MINUTES: "20" } as NodeJS.ProcessEnv), 20);
    assert.equal(alertWindowMinutes({ ALERT_WINDOW_MINUTES: "0" } as NodeJS.ProcessEnv), 15);

    const api5xxRule = operationalAlertRules.find((rule) => rule.id === "api_5xx");
    assert.ok(api5xxRule);
    assert.equal(alertThreshold(api5xxRule, { ALERT_API_5XX_THRESHOLD: "3" } as NodeJS.ProcessEnv), 3);
    assert.equal(alertThreshold(api5xxRule, { ALERT_API_5XX_THRESHOLD: "bad" } as NodeJS.ProcessEnv), api5xxRule.defaultThreshold);
  });

  it("evaluates API, auth, permission, slow-query, and file failure rules from security event counts", () => {
    const ruleIds = operationalAlertRules.map((rule) => rule.id);
    assert.deepEqual(ruleIds, ["api_5xx", "slow_query", "login_failure_spike", "permission_failure_spike", "file_upload_failure"]);

    const loginRule = operationalAlertRules.find((rule) => rule.id === "login_failure_spike");
    assert.ok(loginRule);
    const loginStatus = evaluateAlertRule(
      loginRule,
      { login_rejected: 8, auth_required: 2 },
      { ALERT_LOGIN_FAILURE_THRESHOLD: "10" } as NodeJS.ProcessEnv,
    );
    assert.equal(loginStatus.ok, false);
    assert.equal(loginStatus.count, 10);

    const fileRule = operationalAlertRules.find((rule) => rule.id === "file_upload_failure");
    assert.ok(fileRule);
    assert.equal(evaluateAlertRule(fileRule, { file_scan_unavailable: 1 }).ok, false);
  });

  it("exposes protected operational alert summaries for system managers", () => {
    assert.match(appSource, /import \{ operationsRoutes \} from "\.\/routes\/operations\.js"/, "operations routes must be registered in the app");
    assert.match(appSource, /app\.register\(operationsRoutes, \{ prefix: "\/api" \}\)/, "operations routes must use the API prefix");
    assert.match(operationsRouteSource, /app\.get\("\/operations\/alerts"/, "operations alert endpoint must be registered");
    assert.match(operationsRouteSource, /requireAuth\(/, "operations alerts must require authentication");
    assert.match(operationsRouteSource, /hasPermission\(user, "system:manage"\)/, "operations alerts must require system management permission");
    assert.match(operationsRouteSource, /reply\.code\(summary\.ok \? 200 : 503\)/, "triggered alerts must degrade HTTP status for monitors");
  });

  it("records slow Prisma queries without storing raw SQL or parameters", () => {
    assert.match(prismaSource, /SLOW_QUERY_MS/, "slow query threshold must be configurable");
    assert.match(prismaSource, /\$on\("query"/, "Prisma query events must be observed");
    assert.match(prismaSource, /eventType: "slow_query"/, "slow query events must be written to security_events");
    assert.match(prismaSource, /durationMs: event\.duration/, "slow query records must include duration");
    assert.match(prismaSource, /thresholdMs/, "slow query records must include the threshold used");
    assert.doesNotMatch(prismaSource, /query: event\.query|params: event\.params/, "slow query records must not store raw SQL or parameters");
  });
});
