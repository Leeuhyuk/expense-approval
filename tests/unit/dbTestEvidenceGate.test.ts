import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const harnessFiles = [
  "tests/integration/backendDataPersistence.test.ts",
  "tests/integration/backendListQueryConsistency.test.ts",
  "tests/integration/backendSettingsPersistence.test.ts",
  "tests/integration/backendPaymentRequestFlow.test.ts",
  "tests/integration/backendNotificationOperationsFlow.test.ts",
  "tests/integration/backendOperatingDataFlow.test.ts",
  "tests/e2e/remote-auth-smoke.test.mjs",
  "tests/e2e/remote-ui-persistence.test.mjs",
];
const safeTestDbUrl = "postgresql://erp:secret@test-db.example.com:5432/erp_test";

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-06T00:00:00.000Z",
    releaseVersion: "release-sha",
    sourceRef: "v2026.07.06",
    gitCommit: "release-sha",
    databaseUrlFingerprint: sha256(safeTestDbUrl),
    databaseUrlSafety: "pass",
    harnessFiles: harnessFiles.map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(path))),
    })),
    commands: [
      { id: "db-integration", status: 0, ok: true, skipped: false, missingRequiredOutput: [] },
      { id: "remote-auth-e2e", status: 0, ok: true, skipped: false, missingRequiredOutput: [] },
      { id: "remote-ui-persistence-e2e", status: 0, ok: true, skipped: false, missingRequiredOutput: [] },
    ],
    ok: true,
    ...overrides,
  };
}

describe("DB-backed release evidence gate", () => {
  it("audits harness availability without requiring a test DB in local mode", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REQUIRE_DB_TEST_EVIDENCE: "",
        ERP_TEST_DATABASE_URL: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[db-test-evidence\] mode=audit/);
    assert.match(result.stdout, /DB-backed integration and remote UI E2E will skip/);
  });

  it("fails strict release evidence mode when the test DB is missing", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REQUIRE_DB_TEST_EVIDENCE: "true",
        ERP_TEST_DATABASE_URL: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERP_TEST_DATABASE_URL is required/);
  });

  it("fails strict release evidence mode when the DB execution result artifact is missing", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REQUIRE_DB_TEST_EVIDENCE: "true",
        ERP_TEST_DATABASE_URL: safeTestDbUrl,
        DB_TEST_EVIDENCE_RESULT_PATH: "release/definitely-missing-db-test-evidence.json",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /DB test evidence result is required/);
  });

  it("passes strict release evidence mode only with a current passing DB execution result artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "erp-db-test-evidence-"));
    try {
      const evidencePath = join(root, "db-test-evidence.json");
      writeFileSync(evidencePath, `${JSON.stringify(makeEvidence(), null, 2)}\n`);

      const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REQUIRE_DB_TEST_EVIDENCE: "true",
          ERP_TEST_DATABASE_URL: safeTestDbUrl,
          DB_TEST_EVIDENCE_RESULT_PATH: evidencePath,
          EXPECTED_RELEASE_VERSION: "release-sha",
          EXPECTED_RELEASE_SOURCE_REF: "v2026.07.06",
          EXPECTED_RELEASE_GIT_COMMIT: "release-sha",
        },
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /PASS DB-backed test evidence gate is satisfied/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects stale, skipped, or failed DB execution result artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "erp-db-test-evidence-"));
    try {
      mkdirSync(root, { recursive: true });
      const evidencePath = join(root, "db-test-evidence.json");
      const stale = makeEvidence({
        harnessFiles: [{ path: harnessFiles[0], sha256: "0".repeat(64) }],
        commands: [
          { id: "db-integration", status: 0, ok: true, skipped: false, missingRequiredOutput: [] },
          { id: "remote-auth-e2e", status: 0, ok: true, skipped: false, missingRequiredOutput: [] },
          { id: "remote-ui-persistence-e2e", status: 0, ok: true, skipped: true, missingRequiredOutput: [] },
        ],
      });
      writeFileSync(evidencePath, `${JSON.stringify(stale, null, 2)}\n`);

      const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REQUIRE_DB_TEST_EVIDENCE: "true",
          ERP_TEST_DATABASE_URL: safeTestDbUrl,
          DB_TEST_EVIDENCE_RESULT_PATH: evidencePath,
        },
        encoding: "utf8",
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /stale/);
      assert.match(result.stderr, /reported skipped tests/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects production-looking or non-PostgreSQL test DB URLs", () => {
    for (const databaseUrl of [
      "postgresql://erp:secret@prod-db.example.com:5432/erp_test",
      "mysql://erp:secret@test-db.example.com:3306/erp_test",
    ]) {
      const result = spawnSync(process.execPath, ["scripts/verify-db-test-evidence.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REQUIRE_DB_TEST_EVIDENCE: "true",
          ERP_TEST_DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /ERP_TEST_DATABASE_URL must/);
    }
  });

  it("requires DB evidence before version-tag release candidates in CI", () => {
    const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
    const packageJson = readFileSync(resolve("package.json"), "utf8");

    assert.match(packageJson, /"release:db-test-evidence-run": "node scripts\/generate-db-test-evidence\.mjs"/);
    assert.match(packageJson, /"release:db-test-evidence": "node scripts\/verify-db-test-evidence\.mjs"/);
    assert.match(ci, /Require DB Test Evidence[\s\S]*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.match(ci, /Require DB Test Evidence[\s\S]*REQUIRE_DB_TEST_EVIDENCE:\s*"true"/);
    assert.match(ci, /Require DB Test Evidence[\s\S]*ERP_TEST_DATABASE_URL:\s*\$\{\{ secrets\.ERP_TEST_DATABASE_URL \}\}/);
    assert.match(ci, /Require DB Test Evidence[\s\S]*npm run release:db-test-evidence-run[\s\S]*npm run release:db-test-evidence/);
  });

  it("requires remote browser persistence evidence across multiple operating screens", () => {
    const verifier = readFileSync(resolve("scripts/verify-db-test-evidence.mjs"), "utf8");
    const remoteUi = readFileSync(resolve("tests/e2e/remote-ui-persistence.test.mjs"), "utf8");

    assert.match(verifier, /favorites, reports, and settings persistence/);
    assert.match(verifier, /payment request submission, approval handoff, and disbursement hold persistence/);
    assert.match(remoteUi, /remote mode browser favorites reports and settings changes persist after reload and second browser login/);
    assert.match(remoteUi, /remote mode browser payment submission approval handoff and disbursement hold persist with DB evidence/);
  });
});
