#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanAuditAppendOnlyProject } from "./auditAppendOnlyScanner.mjs";
import { runBackupRestoreEvidenceChecks } from "./verify-backup-restore-evidence.mjs";
import { runDataMigrationEvidenceChecks } from "./verify-data-migration-evidence.mjs";
import { runFinalAcceptanceEvidenceChecks } from "./verify-final-acceptance-evidence.mjs";
import { runGoLiveHandoffChecks } from "./verify-go-live-handoff.mjs";
import { runPostGoLiveStabilizationEvidenceChecks } from "./verify-post-go-live-stabilization-evidence.mjs";
import { runProductionGoLiveEvidenceChecks } from "./verify-production-go-live-evidence.mjs";
import { runEnvironmentSeparationChecks } from "./verify-environment-separation.mjs";
import { runProductionEnvironmentInventoryChecks } from "./verify-production-environment-inventory.mjs";
import { runRoleUatEvidenceChecks } from "./verify-role-uat-evidence.mjs";
import { runReleaseNoteChecks } from "./verify-release-note.mjs";
import { runStagingSmokeEvidenceChecks } from "./verify-staging-smoke-evidence.mjs";
import { evaluateGoLiveReadiness, readGoLiveChecklist } from "./goLiveReadiness.mjs";
import { scanSensitiveDataExposureProject } from "./sensitiveDataExposureScanner.mjs";
import { verifyReleaseManifest } from "./verify-release-manifest.mjs";

const target = (process.env.RELEASE_TARGET ?? "local").trim().toLowerCase();
const allowedTargets = new Set(["local", "staging", "production"]);
const defaultFileSecret = "dev-file-url-secret-change-in-production";
const defaultBankAccountSecret = "dev-bank-account-secret-change-in-production";
const objectStorageDrivers = new Set(["s3", "object-storage", "object_storage"]);
const minimumBodyLimitBytes = 10 * 1024 * 1024;
const maximumBodyLimitBytes = 25 * 1024 * 1024;

const checks = [];

function addCheck(status, message) {
  checks.push({ status, message });
}

function pass(message) {
  addCheck("pass", message);
}

function warn(message) {
  addCheck("warn", message);
}

function fail(message) {
  addCheck("fail", message);
}

function env(name) {
  return (process.env[name] ?? "").trim();
}

function hasEnv(name) {
  return env(name).length > 0;
}

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function integerEnv(name, fallback) {
  const raw = env(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : Number.NaN;
}

function isLocalUrl(value) {
  return /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:|\/|$)/i.test(value);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function databaseUrlUsesTls(value) {
  const sslMode = env("PGSSLMODE").toLowerCase();
  if (["require", "verify-ca", "verify-full"].includes(sslMode)) return true;
  try {
    const parsed = new URL(value);
    const urlSslMode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
    const sslAccept = (parsed.searchParams.get("sslaccept") ?? "").toLowerCase();
    return ["require", "verify-ca", "verify-full"].includes(urlSslMode) || sslAccept === "strict";
  } catch {
    return false;
  }
}

function normalizeComparableUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeUrlList(value) {
  return value
    .split(",")
    .map(normalizeComparableUrl)
    .filter(Boolean)
    .sort();
}

function sameUrlList(left, right) {
  const normalizedLeft = normalizeUrlList(left);
  const normalizedRight = normalizeUrlList(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function validateFrontendMockIsolation() {
  const guardedImports = [
    {
      file: "src/main.tsx",
      pattern: /from\s+["']\.\/mockData["']/,
      message: "src/main.tsx must not statically import mockData in staging/production.",
    },
    {
      file: "src/api/service.ts",
      pattern: /from\s+["']\.\.\/mockData["']|from\s+["']\.\/mockApi["']/,
      message: "src/api/service.ts must not statically import mockData/mockApi in staging/production; mock mode must stay lazy-loaded.",
    },
  ];

  for (const item of guardedImports) {
    const source = readProjectFile(item.file);
    if (item.pattern.test(source)) {
      fail(item.message);
    }
  }

  if (!checks.some((check) => check.status === "fail" && check.message.includes("mockData"))) {
    pass("Frontend production entrypoints do not statically import mockData/mockApi fixtures.");
  }
}

function validateSharedRemoteEnvironment() {
  const apiMode = env("VITE_ERP_API_MODE");
  const apiBaseUrl = env("VITE_ERP_API_BASE_URL");
  const expectedProductionApiBaseUrl = env("EXPECTED_PRODUCTION_API_BASE_URL");
  const databaseUrl = env("DATABASE_URL");
  const frontendOrigin = env("FRONTEND_ORIGIN");
  const expectedProductionFrontendOrigin = env("EXPECTED_PRODUCTION_FRONTEND_ORIGIN");
  const fileUrlSecret = env("FILE_URL_SECRET");
  const csrfSecret = env("CSRF_SECRET");
  const bankAccountSecret = env("BANK_ACCOUNT_SECRET");
  const storageDriver = env("FILE_STORAGE_DRIVER").toLowerCase();
  const scanMode = env("FILE_SCAN_MODE").toLowerCase();

  if (apiMode === "remote") {
    pass("VITE_ERP_API_MODE is remote.");
  } else {
    fail("VITE_ERP_API_MODE must be remote for staging/production release candidates.");
  }

  if (!apiBaseUrl) {
    fail("VITE_ERP_API_BASE_URL is required for staging/production.");
  } else if (isLocalUrl(apiBaseUrl)) {
    fail("VITE_ERP_API_BASE_URL must not point to localhost or loopback.");
  } else if (!isHttpsUrl(apiBaseUrl)) {
    fail("VITE_ERP_API_BASE_URL must be an absolute HTTPS URL for staging/production.");
  } else {
    pass("VITE_ERP_API_BASE_URL is present and non-local.");
  }

  if (target === "production") {
    if (!expectedProductionApiBaseUrl) {
      fail("EXPECTED_PRODUCTION_API_BASE_URL is required for production release candidates.");
    } else if (isLocalUrl(expectedProductionApiBaseUrl) || !isHttpsUrl(expectedProductionApiBaseUrl)) {
      fail("EXPECTED_PRODUCTION_API_BASE_URL must be an absolute non-local HTTPS URL.");
    } else if (normalizeComparableUrl(apiBaseUrl) !== normalizeComparableUrl(expectedProductionApiBaseUrl)) {
      fail("VITE_ERP_API_BASE_URL must match EXPECTED_PRODUCTION_API_BASE_URL for production.");
    } else {
      pass("VITE_ERP_API_BASE_URL matches the expected production API base URL.");
    }
  }

  if (!databaseUrl) {
    fail("DATABASE_URL is required.");
  } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    fail("DATABASE_URL must use PostgreSQL for staging/production.");
  } else if (isLocalUrl(databaseUrl)) {
    fail("DATABASE_URL must not point to localhost or loopback.");
  } else if (!databaseUrlUsesTls(databaseUrl)) {
    fail("DATABASE_URL must require TLS using sslmode=require/verify-ca/verify-full, sslaccept=strict, or PGSSLMODE.");
  } else {
    pass("DATABASE_URL is PostgreSQL, non-local, and TLS-enabled.");
  }

  if (!frontendOrigin) {
    fail("FRONTEND_ORIGIN is required for CORS allowlist.");
  } else if (frontendOrigin.split(",").some((origin) => origin.trim() === "*" || isLocalUrl(origin.trim()))) {
    fail("FRONTEND_ORIGIN must be an explicit non-local allowlist and must not include wildcard origins.");
  } else if (frontendOrigin.split(",").some((origin) => !isHttpsUrl(origin.trim()))) {
    fail("FRONTEND_ORIGIN must use HTTPS origins in staging/production.");
  } else {
    pass("FRONTEND_ORIGIN is an explicit non-local CORS allowlist.");
  }

  if (target === "production") {
    if (!expectedProductionFrontendOrigin) {
      fail("EXPECTED_PRODUCTION_FRONTEND_ORIGIN is required for production release candidates.");
    } else if (expectedProductionFrontendOrigin.split(",").some((origin) => origin.trim() === "*" || isLocalUrl(origin.trim()) || !isHttpsUrl(origin.trim()))) {
      fail("EXPECTED_PRODUCTION_FRONTEND_ORIGIN must be an explicit HTTPS non-local allowlist.");
    } else if (!sameUrlList(frontendOrigin, expectedProductionFrontendOrigin)) {
      fail("FRONTEND_ORIGIN must match EXPECTED_PRODUCTION_FRONTEND_ORIGIN for production.");
    } else {
      pass("FRONTEND_ORIGIN matches the expected production frontend origin allowlist.");
    }
  }

  if (!fileUrlSecret) {
    fail("FILE_URL_SECRET is required for signed file URLs.");
  } else if (fileUrlSecret === defaultFileSecret || fileUrlSecret.length < 32) {
    fail("FILE_URL_SECRET must be a non-default secret with at least 32 characters.");
  } else {
    pass("FILE_URL_SECRET is configured.");
  }

  if (!csrfSecret) {
    fail("CSRF_SECRET is required for signed CSRF double-submit tokens.");
  } else if (csrfSecret.length < 32) {
    fail("CSRF_SECRET must have at least 32 characters.");
  } else {
    pass("CSRF_SECRET is configured.");
  }

  if (!bankAccountSecret) {
    fail("BANK_ACCOUNT_SECRET is required for encrypted bank account storage.");
  } else if (bankAccountSecret === defaultBankAccountSecret || bankAccountSecret.length < 32) {
    fail("BANK_ACCOUNT_SECRET must be a non-default secret with at least 32 characters.");
  } else {
    pass("BANK_ACCOUNT_SECRET is configured.");
  }

  if (!objectStorageDrivers.has(storageDriver)) {
    fail("FILE_STORAGE_DRIVER must be s3/object-storage for staging/production.");
  } else {
    pass("FILE_STORAGE_DRIVER uses an object storage driver.");
  }

  const s3Endpoint = env("S3_ENDPOINT") || env("FILE_STORAGE_ENDPOINT");
  const s3Bucket = env("S3_BUCKET") || env("FILE_STORAGE_BUCKET");
  const s3AccessKey = env("S3_ACCESS_KEY_ID") || env("AWS_ACCESS_KEY_ID");
  const s3SecretKey = env("S3_SECRET_ACCESS_KEY") || env("AWS_SECRET_ACCESS_KEY");
  const bucketPrivateEvidence = env("S3_BUCKET_PUBLIC_ACCESS_BLOCKED") || env("FILE_STORAGE_BUCKET_PRIVATE");
  const storageEncryptionEvidence = env("S3_SERVER_SIDE_ENCRYPTION_ENABLED") || env("FILE_STORAGE_ENCRYPTION_AT_REST");
  const publicStorageUrl = env("S3_PUBLIC_BASE_URL") || env("S3_PUBLIC_URL") || env("FILE_STORAGE_PUBLIC_BASE_URL") || env("FILE_STORAGE_PUBLIC_URL");
  if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
    fail("S3-compatible object storage requires endpoint, bucket, access key, and secret key env vars.");
  } else if (isLocalUrl(s3Endpoint)) {
    fail("S3/object storage endpoint must not point to localhost or loopback.");
  } else if (!isHttpsUrl(s3Endpoint)) {
    fail("S3/object storage endpoint must use HTTPS in staging/production.");
  } else {
    pass("S3-compatible object storage configuration is present.");
  }

  if (!bucketPrivateEvidence || !isTruthyEnvValue(bucketPrivateEvidence)) {
    fail("S3_BUCKET_PUBLIC_ACCESS_BLOCKED=true or FILE_STORAGE_BUCKET_PRIVATE=true is required to document private object storage bucket access.");
  } else {
    pass("Object storage bucket private/public-access-block evidence is configured.");
  }

  if (!storageEncryptionEvidence || !isTruthyEnvValue(storageEncryptionEvidence)) {
    fail("S3_SERVER_SIDE_ENCRYPTION_ENABLED=true or FILE_STORAGE_ENCRYPTION_AT_REST=true is required for attachment storage encryption at rest.");
  } else {
    pass("Object storage encryption-at-rest evidence is configured.");
  }

  if (publicStorageUrl) {
    fail("Direct public object storage URL env vars must not be configured; files must be served through API signed paths only.");
  } else {
    pass("No direct public object storage base URL is configured.");
  }

  if (scanMode !== "external") {
    fail("FILE_SCAN_MODE must be external for staging/production.");
  } else {
    pass("FILE_SCAN_MODE is external.");
  }

  if (!hasEnv("MALWARE_SCAN_ENDPOINT")) {
    fail("MALWARE_SCAN_ENDPOINT is required for staging/production file scanning.");
  } else if (!isHttpsUrl(env("MALWARE_SCAN_ENDPOINT"))) {
    fail("MALWARE_SCAN_ENDPOINT must use HTTPS in staging/production.");
  } else {
    pass("MALWARE_SCAN_ENDPOINT is configured.");
  }
}

function validateApiTrafficControls() {
  const bodyLimit = integerEnv("API_BODY_LIMIT_BYTES", 11 * 1024 * 1024);
  const rateWindowMs = integerEnv("RATE_LIMIT_WINDOW_MS", 60 * 1000);
  const rateLimitMax = integerEnv("RATE_LIMIT_MAX", 600);
  const rateLimitDisabled = ["1", "true", "yes", "on"].includes(env("RATE_LIMIT_DISABLED").toLowerCase());

  if (!Number.isFinite(bodyLimit)) {
    fail("API_BODY_LIMIT_BYTES must be an integer byte value.");
  } else if (bodyLimit < minimumBodyLimitBytes) {
    fail("API_BODY_LIMIT_BYTES must allow the configured 10MB attachment limit.");
  } else if (bodyLimit > maximumBodyLimitBytes) {
    fail("API_BODY_LIMIT_BYTES must not exceed 25MB without a separate upload architecture review.");
  } else {
    pass("API_BODY_LIMIT_BYTES is compatible with the attachment size policy.");
  }

  if (rateLimitDisabled) {
    fail("RATE_LIMIT_DISABLED must not be enabled for staging/production.");
  } else {
    pass("API rate limiting is enabled.");
  }

  if (!Number.isFinite(rateWindowMs) || rateWindowMs < 1000 || rateWindowMs > 60 * 60 * 1000) {
    fail("RATE_LIMIT_WINDOW_MS must be between 1 second and 1 hour.");
  } else {
    pass("RATE_LIMIT_WINDOW_MS is within the allowed range.");
  }

  if (!Number.isFinite(rateLimitMax) || rateLimitMax < 1 || rateLimitMax > 5000) {
    fail("RATE_LIMIT_MAX must be between 1 and 5000 requests per window.");
  } else {
    pass("RATE_LIMIT_MAX is within the allowed range.");
  }
}

function validateAuditAppendOnly() {
  const result = scanAuditAppendOnlyProject(process.cwd());
  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      fail(`Audit log append-only violation: ${issue.filePath}:${issue.line} [${issue.ruleId}] ${issue.message}`);
    }
  } else {
    pass(`Audit log append-only scanner checked ${result.scannedFiles} source file(s).`);
  }
}

function validateSensitiveDataExposure() {
  const result = scanSensitiveDataExposureProject(process.cwd());
  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      fail(`Sensitive data exposure violation: ${issue.filePath}:${issue.line} [${issue.ruleId}] ${issue.message}`);
    }
  } else {
    pass(`Sensitive data exposure scanner checked ${result.scannedFiles} production source file(s).`);
  }
}

function validateProductionAccessApproval() {
  if (target !== "production") return;

  const approved = isTruthyEnvValue(env("PRODUCTION_ACCESS_REVIEW_APPROVED"));
  const reviewId = env("PRODUCTION_ACCESS_REVIEW_ID");
  const approver = env("PRODUCTION_ACCESS_REVIEW_APPROVER");

  if (!approved) {
    fail("PRODUCTION_ACCESS_REVIEW_APPROVED=true is required to confirm production account permission review approval.");
  } else {
    pass("Production account permission review is marked approved.");
  }

  if (!reviewId) {
    fail("PRODUCTION_ACCESS_REVIEW_ID is required to link production account permission approval evidence.");
  } else {
    pass("Production account permission review ID is configured.");
  }

  if (!approver) {
    fail("PRODUCTION_ACCESS_REVIEW_APPROVER is required for production account permission approval accountability.");
  } else {
    pass("Production account permission review approver is configured.");
  }
}

function validateProductionReadiness() {
  if (target !== "production") return;

  const result = evaluateGoLiveReadiness(readGoLiveChecklist(), "production-candidate");
  if (result.blockers.length === 0) {
    pass("Production candidate readiness gate has no open P0 blockers in scope.");
    return;
  }

  const preview = result.blockers.slice(0, 5).map((item) => `${item.section} ${item.text}`).join(" | ");
  fail(`Production readiness gate blocked by ${result.blockers.length} open P0 item(s): ${preview}`);
}

function validateProductionGoLiveHandoff() {
  if (target !== "production") return;

  const result = runGoLiveHandoffChecks({ strict: true });
  if (result.ok) {
    pass("Production go-live handoff has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Production go-live handoff is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionEnvironmentInventory() {
  if (target !== "production") return;

  const result = runProductionEnvironmentInventoryChecks({ strict: true });
  if (result.ok) {
    pass("Production environment inventory has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Production environment inventory is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionEnvironmentSeparation() {
  if (target !== "production") return;

  const result = runEnvironmentSeparationChecks({ strict: true });
  if (result.ok) {
    pass("Environment separation matrix has no unresolved placeholders and isolates dev/staging/production.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Environment separation matrix is incomplete: ${failure.label} - ${failure.detail}`);
  }
}
function validateProductionStagingSmokeEvidence() {
  if (target !== "production") return;

  const result = runStagingSmokeEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Staging smoke evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Staging smoke evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionBackupRestoreEvidence() {
  if (target !== "production") return;

  const result = runBackupRestoreEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Backup restore evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Backup restore evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionDataMigrationEvidence() {
  if (target !== "production") return;

  const result = runDataMigrationEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Data migration evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Data migration evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionRoleUatEvidence() {
  if (target !== "production") return;

  const result = runRoleUatEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Role UAT evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Role UAT evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionGoLiveEvidence() {
  if (target !== "production") return;

  const result = runProductionGoLiveEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Production go-live evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Production go-live evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validatePostGoLiveStabilizationEvidence() {
  if (target !== "production") return;

  const result = runPostGoLiveStabilizationEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Post go-live stabilization evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Post go-live stabilization evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateFinalAcceptanceEvidence() {
  if (target !== "production") return;

  const result = runFinalAcceptanceEvidenceChecks({ strict: true });
  if (result.ok) {
    pass("Final acceptance evidence has no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Final acceptance evidence is incomplete: ${failure.label} - ${failure.detail}`);
  }
}

function validateProductionReleaseNote() {
  if (target !== "production") return;

  const result = runReleaseNoteChecks({ strict: true });
  if (result.ok) {
    pass("Release note has required sections and no unresolved placeholders.");
    return;
  }

  for (const failure of result.failures) {
    fail(`Release note is incomplete: ${failure.label} - ${failure.detail}`);
  }
}
function validateProductionReleaseManifestEvidence() {
  if (target !== "production") return;

  if (!hasEnv("EXPECTED_RELEASE_MANIFEST_SHA256")) {
    fail("EXPECTED_RELEASE_MANIFEST_SHA256 is required for production release candidates to pin the promoted artifact checksum.");
  }

  if (!hasEnv("EXPECTED_RELEASE_SOURCE_REF")) {
    fail("EXPECTED_RELEASE_SOURCE_REF is required for production release candidates to pin the promoted release branch or tag.");
  }

  try {
    const result = verifyReleaseManifest({
      expectedManifestSha256: env("EXPECTED_RELEASE_MANIFEST_SHA256"),
      expectedSourceRef: env("EXPECTED_RELEASE_SOURCE_REF"),
      expectedGitCommit: env("EXPECTED_RELEASE_GIT_COMMIT"),
    });

    if (result.ok) {
      pass("Release manifest and release evidence files match current artifacts.");
      return;
    }

    for (const error of result.errors) {
      fail(`Release manifest/evidence verification failed: ${error}`);
    }
  } catch (error) {
    fail(`Release manifest/evidence verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateProductionReleaseIdentity() {
  if (target !== "production") return;

  const releaseVersion = env("RELEASE_VERSION");
  const frontendReleaseVersion = env("VITE_RELEASE_VERSION");
  const releaseSourceRef = env("RELEASE_SOURCE_REF");
  const frontendSourceRef = env("VITE_RELEASE_SOURCE_REF");
  const expectedSourceRef = env("EXPECTED_RELEASE_SOURCE_REF");
  const releaseGitCommit = env("RELEASE_GIT_COMMIT");
  const frontendGitCommit = env("VITE_RELEASE_GIT_COMMIT");
  const expectedGitCommit = env("EXPECTED_RELEASE_GIT_COMMIT");

  if (!releaseVersion) fail("RELEASE_VERSION is required for production release identity checks.");
  if (!frontendReleaseVersion) fail("VITE_RELEASE_VERSION is required so the frontend artifact can be compared with the backend release.");
  if (releaseVersion && frontendReleaseVersion && releaseVersion !== frontendReleaseVersion) {
    fail("RELEASE_VERSION and VITE_RELEASE_VERSION must match for production.");
  }

  if (!releaseSourceRef) fail("RELEASE_SOURCE_REF is required for production release identity checks.");
  if (!frontendSourceRef) fail("VITE_RELEASE_SOURCE_REF is required so the frontend artifact can be compared with the backend release.");
  if (releaseSourceRef && frontendSourceRef && releaseSourceRef !== frontendSourceRef) {
    fail("RELEASE_SOURCE_REF and VITE_RELEASE_SOURCE_REF must match for production.");
  }
  if (expectedSourceRef && releaseSourceRef && releaseSourceRef !== expectedSourceRef) {
    fail("RELEASE_SOURCE_REF must match EXPECTED_RELEASE_SOURCE_REF for production.");
  }

  if (!releaseGitCommit) fail("RELEASE_GIT_COMMIT is required for production release identity checks.");
  if (!frontendGitCommit) fail("VITE_RELEASE_GIT_COMMIT is required so the frontend artifact can be compared with the backend release.");
  if (releaseGitCommit && frontendGitCommit && releaseGitCommit !== frontendGitCommit) {
    fail("RELEASE_GIT_COMMIT and VITE_RELEASE_GIT_COMMIT must match for production.");
  }
  if (expectedGitCommit && releaseGitCommit && releaseGitCommit !== expectedGitCommit) {
    fail("RELEASE_GIT_COMMIT must match EXPECTED_RELEASE_GIT_COMMIT for production.");
  }

  if (
    releaseVersion &&
    frontendReleaseVersion &&
    releaseVersion === frontendReleaseVersion &&
    releaseSourceRef &&
    frontendSourceRef &&
    releaseSourceRef === frontendSourceRef &&
    releaseGitCommit &&
    frontendGitCommit &&
    releaseGitCommit === frontendGitCommit
  ) {
    pass("Frontend and backend release identity values match.");
  }
}

if (!allowedTargets.has(target)) {
  fail(`RELEASE_TARGET must be one of ${Array.from(allowedTargets).join(", ")}.`);
} else if (target === "local") {
  pass("Local release gate selected.");
  if (env("VITE_ERP_API_MODE") === "mock") {
    warn("VITE_ERP_API_MODE=mock is acceptable only for local UI verification.");
  }
  warn("Run with RELEASE_TARGET=staging or RELEASE_TARGET=production before deployment.");
} else {
  validateSharedRemoteEnvironment();
  validateApiTrafficControls();
  validateFrontendMockIsolation();

  if (env("NODE_ENV") === "production") {
    pass("NODE_ENV is production.");
  } else {
    fail("NODE_ENV must be production for staging/production release candidates.");
  }

  if (hasEnv("DEV_LOGIN_PASSWORD")) {
    fail("DEV_LOGIN_PASSWORD must be empty for staging/production; login must use passwordHash or SSO.");
  } else {
    pass("DEV_LOGIN_PASSWORD is not set.");
  }

  if (hasEnv("ALLOW_PRODUCTION_SEED")) {
    fail("ALLOW_PRODUCTION_SEED must be empty for staging/production release candidates; production seed execution is blocked by default.");
  } else {
    pass("ALLOW_PRODUCTION_SEED is not set.");
  }
}

validateAuditAppendOnly();
validateSensitiveDataExposure();
validateProductionAccessApproval();
validateProductionEnvironmentInventory();
validateProductionEnvironmentSeparation();
validateProductionStagingSmokeEvidence();
validateProductionBackupRestoreEvidence();
validateProductionDataMigrationEvidence();
validateProductionRoleUatEvidence();
validateProductionGoLiveEvidence();
validateProductionReleaseNote();
validatePostGoLiveStabilizationEvidence();
validateFinalAcceptanceEvidence();
validateProductionReleaseManifestEvidence();
validateProductionReleaseIdentity();
validateProductionGoLiveHandoff();
validateProductionReadiness();

for (const check of checks) {
  const label = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`[${label}] ${check.message}`);
}

if (checks.some((check) => check.status === "fail")) {
  process.exitCode = 1;
}
