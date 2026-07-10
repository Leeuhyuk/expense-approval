import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

function productionCandidateEnv(overrides: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    RELEASE_TARGET: "production",
    NODE_ENV: "production",
    VITE_ERP_API_MODE: "remote",
    VITE_ERP_API_BASE_URL: "https://erp-api.example.com/api",
    EXPECTED_PRODUCTION_API_BASE_URL: "https://erp-api.example.com/api",
    DATABASE_URL: "postgresql://erp_user:erp_password@db.example.com:5432/payment_approval_erp?sslmode=require",
    FRONTEND_ORIGIN: "https://erp.example.com",
    EXPECTED_PRODUCTION_FRONTEND_ORIGIN: "https://erp.example.com",
    FILE_URL_SECRET: "production-file-secret-000000000000",
    CSRF_SECRET: "production-csrf-secret-000000000000",
    BANK_ACCOUNT_SECRET: "production-bank-secret-000000000000",
    FILE_STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "payment-approval-erp-files",
    S3_BUCKET_PUBLIC_ACCESS_BLOCKED: "true",
    S3_SERVER_SIDE_ENCRYPTION_ENABLED: "true",
    S3_ACCESS_KEY_ID: "example-access-key",
    S3_SECRET_ACCESS_KEY: "example-secret-key",
    FILE_SCAN_MODE: "external",
    MALWARE_SCAN_ENDPOINT: "https://scanner.example.com/scan",
    DATA_QUALITY_JOB_ENABLED: "true",
    DATA_QUALITY_JOB_INTERVAL_MINUTES: "60",
    DATA_QUALITY_JOB_HISTORY_LIMIT: "30",
    DATA_QUALITY_JOB_RUN_ON_START: "true",
    PRODUCTION_ACCESS_REVIEW_APPROVED: "true",
    PRODUCTION_ACCESS_REVIEW_ID: "ACCESS-2026-07-GOLIVE",
    PRODUCTION_ACCESS_REVIEW_APPROVER: "security-owner@example.com",
    ...overrides,
  };
}

function runReleaseGate(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["scripts/verify-release-env.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("release environment gate", () => {
  it("rejects production candidates without the recurring data quality scheduler", () => {
    const disabled = runReleaseGate(productionCandidateEnv({ DATA_QUALITY_JOB_ENABLED: "false" }));
    const noStartup = runReleaseGate(productionCandidateEnv({ DATA_QUALITY_JOB_RUN_ON_START: "false" }));
    const invalidInterval = runReleaseGate(productionCandidateEnv({ DATA_QUALITY_JOB_INTERVAL_MINUTES: "2" }));

    assert.equal(disabled.status, 1);
    assert.match(disabled.stdout, /DATA_QUALITY_JOB_ENABLED=true is required/);
    assert.equal(noStartup.status, 1);
    assert.match(noStartup.stdout, /DATA_QUALITY_JOB_RUN_ON_START=true is required/);
    assert.equal(invalidInterval.status, 1);
    assert.match(invalidInterval.stdout, /DATA_QUALITY_JOB_INTERVAL_MINUTES must be between 5 and 1440/);
  });

  it("rejects production release candidates with the seed override flag enabled", () => {
    const result = runReleaseGate(productionCandidateEnv({ ALLOW_PRODUCTION_SEED: "true" }));

    assert.equal(result.status, 1);
    assert.match(result.stdout, /ALLOW_PRODUCTION_SEED must be empty/);
  });

  it("rejects staging or production candidates with disabled rate limits or too-small body limits", () => {
    const result = runReleaseGate({
      ...process.env,
      RELEASE_TARGET: "staging",
      NODE_ENV: "production",
      RATE_LIMIT_DISABLED: "true",
      API_BODY_LIMIT_BYTES: "1048576",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /RATE_LIMIT_DISABLED must not be enabled/);
    assert.match(result.stdout, /API_BODY_LIMIT_BYTES must allow the configured 10MB attachment limit/);
  });

  it("rejects production candidates unless frontend uses remote mode and the pinned production API base URL", () => {
    const mockMode = runReleaseGate(productionCandidateEnv({ VITE_ERP_API_MODE: "mock" }));
    const loopbackApi = runReleaseGate(
      productionCandidateEnv({
        VITE_ERP_API_BASE_URL: "http://127.0.0.1:4000/api",
      }),
    );
    const unpinnedApi = runReleaseGate(
      productionCandidateEnv({
        VITE_ERP_API_BASE_URL: "https://staging-api.example.com/api",
      }),
    );
    const missingExpectedApi = runReleaseGate(
      productionCandidateEnv({
        EXPECTED_PRODUCTION_API_BASE_URL: "",
      }),
    );

    assert.equal(mockMode.status, 1);
    assert.match(mockMode.stdout, /VITE_ERP_API_MODE must be remote/);

    assert.equal(loopbackApi.status, 1);
    assert.match(loopbackApi.stdout, /VITE_ERP_API_BASE_URL must not point to localhost or loopback/);

    assert.equal(unpinnedApi.status, 1);
    assert.match(unpinnedApi.stdout, /VITE_ERP_API_BASE_URL must match EXPECTED_PRODUCTION_API_BASE_URL/);

    assert.equal(missingExpectedApi.status, 1);
    assert.match(missingExpectedApi.stdout, /EXPECTED_PRODUCTION_API_BASE_URL is required/);
  });

  it("rejects production candidates unless CORS allowlist matches the pinned production frontend origin", () => {
    const localOrigin = runReleaseGate(
      productionCandidateEnv({
        FRONTEND_ORIGIN: "http://127.0.0.1:5173",
      }),
    );
    const unpinnedOrigin = runReleaseGate(
      productionCandidateEnv({
        FRONTEND_ORIGIN: "https://staging-erp.example.com",
      }),
    );
    const missingExpectedOrigin = runReleaseGate(
      productionCandidateEnv({
        EXPECTED_PRODUCTION_FRONTEND_ORIGIN: "",
      }),
    );

    assert.equal(localOrigin.status, 1);
    assert.match(localOrigin.stdout, /FRONTEND_ORIGIN must be an explicit non-local allowlist/);

    assert.equal(unpinnedOrigin.status, 1);
    assert.match(unpinnedOrigin.stdout, /FRONTEND_ORIGIN must match EXPECTED_PRODUCTION_FRONTEND_ORIGIN/);

    assert.equal(missingExpectedOrigin.status, 1);
    assert.match(missingExpectedOrigin.stdout, /EXPECTED_PRODUCTION_FRONTEND_ORIGIN is required/);
  });

  it("rejects production candidates with public object storage URLs or missing private bucket evidence", () => {
    const missingPrivateBucketEvidence = runReleaseGate(
      productionCandidateEnv({
        S3_BUCKET_PUBLIC_ACCESS_BLOCKED: "",
      }),
    );
    const publicStorageUrl = runReleaseGate(
      productionCandidateEnv({
        S3_PUBLIC_BASE_URL: "https://s3.example.com/payment-approval-erp-files",
      }),
    );

    assert.equal(missingPrivateBucketEvidence.status, 1);
    assert.match(missingPrivateBucketEvidence.stdout, /S3_BUCKET_PUBLIC_ACCESS_BLOCKED=true or FILE_STORAGE_BUCKET_PRIVATE=true is required/);

    assert.equal(publicStorageUrl.status, 1);
    assert.match(publicStorageUrl.stdout, /Direct public object storage URL env vars must not be configured/);
  });

  it("rejects staging or production candidates without transport and storage-at-rest encryption evidence", () => {
    const dbWithoutTls = runReleaseGate(
      productionCandidateEnv({
        DATABASE_URL: "postgresql://erp_user:erp_password@db.example.com:5432/payment_approval_erp",
      }),
    );
    const objectStorageWithoutEncryption = runReleaseGate(
      productionCandidateEnv({
        S3_SERVER_SIDE_ENCRYPTION_ENABLED: "",
      }),
    );
    const nonHttpsStorage = runReleaseGate(
      productionCandidateEnv({
        S3_ENDPOINT: "http://s3.example.com",
      }),
    );
    const nonHttpsScanner = runReleaseGate(
      productionCandidateEnv({
        MALWARE_SCAN_ENDPOINT: "http://scanner.example.com/scan",
      }),
    );
    const pgSslModeOverride = runReleaseGate(
      productionCandidateEnv({
        DATABASE_URL: "postgresql://erp_user:erp_password@db.example.com:5432/payment_approval_erp",
        PGSSLMODE: "verify-full",
      }),
    );

    assert.equal(dbWithoutTls.status, 1);
    assert.match(dbWithoutTls.stdout, /DATABASE_URL must require TLS/);

    assert.equal(objectStorageWithoutEncryption.status, 1);
    assert.match(objectStorageWithoutEncryption.stdout, /S3_SERVER_SIDE_ENCRYPTION_ENABLED=true or FILE_STORAGE_ENCRYPTION_AT_REST=true is required/);

    assert.equal(nonHttpsStorage.status, 1);
    assert.match(nonHttpsStorage.stdout, /S3\/object storage endpoint must use HTTPS/);

    assert.equal(nonHttpsScanner.status, 1);
    assert.match(nonHttpsScanner.stdout, /MALWARE_SCAN_ENDPOINT must use HTTPS/);

    assert.equal(pgSslModeOverride.status, 1);
    assert.doesNotMatch(pgSslModeOverride.stdout, /DATABASE_URL must require TLS/);
  });

  it("reports whether production readiness P0 items are blocked or covered by approved exceptions", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Production (?:readiness gate blocked|candidate readiness gate is conditionally cleared)/);
    assert.match(result.stdout, /(?:open P0 item|approved P0 exception)/);
  });

  it("requires production candidates to pin the promoted release manifest and source ref", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /EXPECTED_RELEASE_MANIFEST_SHA256 is required/);
    assert.match(result.stdout, /EXPECTED_RELEASE_SOURCE_REF is required/);
  });

  it("rejects production candidates when the pinned release manifest evidence does not match", () => {
    const result = runReleaseGate(
      productionCandidateEnv({
        EXPECTED_RELEASE_MANIFEST_SHA256: "0".repeat(64),
        EXPECTED_RELEASE_SOURCE_REF: "definitely-not-the-recorded-release-ref",
      }),
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Release manifest\/evidence verification failed: EXPECTED_RELEASE_MANIFEST_SHA256 mismatch/);
    assert.match(result.stdout, /Release manifest\/evidence verification failed: EXPECTED_RELEASE_SOURCE_REF mismatch/);
  });

  it("rejects production candidates when frontend and backend release identities are missing or mismatched", () => {
    const missing = runReleaseGate(productionCandidateEnv());
    const mismatched = runReleaseGate(
      productionCandidateEnv({
        RELEASE_VERSION: "release-a",
        VITE_RELEASE_VERSION: "release-b",
        RELEASE_SOURCE_REF: "v2026.07.06",
        VITE_RELEASE_SOURCE_REF: "v2026.07.06",
        EXPECTED_RELEASE_SOURCE_REF: "v2026.07.06",
        RELEASE_GIT_COMMIT: "commit-a",
        VITE_RELEASE_GIT_COMMIT: "commit-b",
      }),
    );

    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /RELEASE_VERSION is required/);
    assert.match(missing.stdout, /VITE_RELEASE_VERSION is required/);
    assert.match(missing.stdout, /RELEASE_SOURCE_REF is required/);
    assert.match(missing.stdout, /VITE_RELEASE_SOURCE_REF is required/);

    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stdout, /RELEASE_VERSION and VITE_RELEASE_VERSION must match/);
    assert.match(mismatched.stdout, /RELEASE_GIT_COMMIT and VITE_RELEASE_GIT_COMMIT must match/);
  });

  it("rejects production candidates without production account permission approval evidence", () => {
    const result = runReleaseGate(
      productionCandidateEnv({
        PRODUCTION_ACCESS_REVIEW_APPROVED: "",
        PRODUCTION_ACCESS_REVIEW_ID: "",
        PRODUCTION_ACCESS_REVIEW_APPROVER: "",
      }),
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /PRODUCTION_ACCESS_REVIEW_APPROVED=true is required/);
    assert.match(result.stdout, /PRODUCTION_ACCESS_REVIEW_ID is required/);
    assert.match(result.stdout, /PRODUCTION_ACCESS_REVIEW_APPROVER is required/);
  });

  it("rejects production candidates while the go-live handoff still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Production go-live handoff is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while the production environment inventory still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Production environment inventory is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while staging smoke evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Staging smoke evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while backup restore evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Backup restore evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while data migration evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Data migration evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while role UAT evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Role UAT evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while production go-live evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Production go-live evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while post go-live stabilization evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Post go-live stabilization evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });

  it("rejects production candidates while final acceptance evidence still has unresolved placeholders", () => {
    const result = runReleaseGate(productionCandidateEnv());

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Final acceptance evidence is incomplete/);
    assert.match(result.stdout, /unresolved placeholder/);
  });
});
