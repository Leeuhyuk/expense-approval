import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runProductionGoLiveEvidenceChecks } from "../../scripts/verify-production-go-live-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-production-go-live-evidence-"));
}

function filledProductionGoLiveTemplate() {
  return readFileSync(resolve("docs/production-go-live-evidence-template.md"), "utf8")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "evidence");
}

const releaseManifestHash = "a".repeat(64);
const migrationReviewHash = "b".repeat(64);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setRow(source: string, key: string, value: string) {
  const pattern = new RegExp(`^\\|\\s*${escapeRegExp(key)}\\s*\\|.*\\|$`, "m");
  assert.match(source, pattern, `row must exist: ${key}`);
  const next = source.replace(pattern, `| ${key} | ${value} |`);
  return next;
}

function validProductionGoLiveTemplate() {
  let source = filledProductionGoLiveTemplate();
  const healthPass = "pass requestId=req-20260706 evidence=https://evidence.example.com/health";
  const smokePass = "pass evidence=https://evidence.example.com/smoke";

  source = setRow(source, "Release version", "release-sha");
  source = setRow(source, "Release source ref", "v2026.07.06");
  source = setRow(source, "Git commit", "release-sha");
  source = setRow(source, "Release manifest hash", releaseManifestHash);
  source = setRow(source, "`EXPECTED_RELEASE_MANIFEST_SHA256`", releaseManifestHash);
  source = setRow(source, "Migration review hash", migrationReviewHash);
  source = setRow(source, "Production deployment window", "2026-07-06 09:00");
  source = setRow(source, "Go-live decision ID", "GOLIVE-2026-07-06");
  source = setRow(source, "Frontend artifact checksum", "c".repeat(64));
  source = setRow(source, "Backend artifact checksum", "d".repeat(64));
  source = setRow(source, "Prisma migration checksum", "e".repeat(64));
  source = setRow(source, "Release input checksum", "f".repeat(64));
  source = setRow(source, "Production env checksum", "1".repeat(64));
  source = setRow(source, "Secret manager version set", "vault://erp-production/secrets/v42");
  source = setRow(source, "Frontend `VITE_ERP_API_MODE`", "remote");
  source = setRow(source, "Frontend `VITE_ERP_API_BASE_URL`", "https://api.erp.example.com");
  source = setRow(source, "Backend `/api/health/version` result", "pass release=release-sha source=v2026.07.06 commit=release-sha");
  source = setRow(source, "Frontend/backend release identity comparison", "matched frontend/backend release identity");
  source = setRow(source, "Production DB backup before migration", "pass backup-id=backup-20260706");
  source = setRow(source, "Migration deploy command/result", "passed npm --prefix backend run db:deploy");
  source = setRow(source, "Applied migration version", "20260706000000_release");
  source = setRow(source, "Rollback/PITR readiness confirmation", "pass PITR verified");

  for (const key of [
    "`/api/health`",
    "`/api/health/db`",
    "`/api/health/storage`",
    "`/api/health/file-security`",
    "`/api/health/jobs`",
    "`/api/health/integrations`",
    "`/api/health/version`",
    "`/api/operations/alerts`",
    "`/api/operations/business-failure-alerts`",
    "`/api/operations/data-quality`",
  ]) {
    source = setRow(source, key, healthPass);
  }

  source = setRow(source, "requestId/log evidence", "pass requestId=req-20260706");
  source = setRow(source, "Production frontend URL", "https://erp.example.com");

  for (const key of [
    "Login smoke",
    "Menu permission smoke",
    "Payment request list smoke",
    "Attachment access smoke",
    "Notification center smoke",
    "Report download smoke",
    "Browser console error check",
    "Network API base URL check",
    "결제 요청 생성 smoke",
    "증빙 첨부 smoke",
    "승인 처리 smoke",
    "지급 보류 또는 실행 전 dry-run smoke",
    "거래처 조회/등록 smoke",
    "시스템 설정 권한 smoke",
    "보고서 생성/다운로드 smoke",
    "AuditLog evidence",
  ]) {
    source = setRow(source, key, smokePass);
  }

  source = setRow(source, "23장 open P0 count", "0");
  source = setRow(source, "24장 open P0 count", "0");
  source = setRow(source, "25장 open P0 count", "0");
  source = setRow(source, "Approved exception list", "none");
  source = setRow(source, "Exception owner/deadline", "none");
  source = setRow(source, "Go-live readiness command result", "pass open P0 count 0");
  source = setRow(source, "Previous release manifest artifact", "release/release-manifest.previous.json");

  for (const key of [
    "Production deployment run URL",
    "Production health check log",
    "Frontend smoke recording or screenshot folder",
    "Release manifest artifact",
    "Migration review artifact",
    "Environment checksum archive",
    "Go-live handoff document",
    "Role UAT evidence",
  ]) {
    source = setRow(source, key, `https://evidence.example.com/${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  }

  source = setRow(source, "기능 책임자", "Function Owner | 2026-07-06 10:00 | https://evidence.example.com/signoff/function");
  source = setRow(source, "보안 책임자", "Security Owner | 2026-07-06 10:05 | https://evidence.example.com/signoff/security");
  source = setRow(source, "재무 책임자", "Finance Owner | 2026-07-06 10:10 | https://evidence.example.com/signoff/finance");
  source = setRow(source, "운영 책임자", "Operations Owner | 2026-07-06 10:15 | https://evidence.example.com/signoff/operations");
  return source;
}

describe("production go-live evidence release gate", () => {
  it("allows the tracked production go-live evidence template in audit mode while placeholders are still unresolved", () => {
    const result = runProductionGoLiveEvidenceChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when production go-live evidence placeholders remain", () => {
    const result = runProductionGoLiveEvidenceChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending/);
  });

  it("rejects filled but structurally weak production go-live evidence", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "production-go-live.md"), filledProductionGoLiveTemplate());

      const result = runProductionGoLiveEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/production-go-live.md",
        strict: true,
      });

      assert.equal(result.ok, false);
      assert.match(result.failures.map((failure) => failure.label).join("\n"), /release manifest hash|open P0|smoke result/);
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes strict mode when production go-live evidence has valid structured fields", () => {
    const root = makeRoot();
    const previousEnv = {
      EXPECTED_RELEASE_MANIFEST_SHA256: process.env.EXPECTED_RELEASE_MANIFEST_SHA256,
      EXPECTED_RELEASE_SOURCE_REF: process.env.EXPECTED_RELEASE_SOURCE_REF,
      EXPECTED_RELEASE_GIT_COMMIT: process.env.EXPECTED_RELEASE_GIT_COMMIT,
      EXPECTED_RELEASE_VERSION: process.env.EXPECTED_RELEASE_VERSION,
      EXPECTED_PRODUCTION_API_BASE_URL: process.env.EXPECTED_PRODUCTION_API_BASE_URL,
    };

    try {
      process.env.EXPECTED_RELEASE_MANIFEST_SHA256 = releaseManifestHash;
      process.env.EXPECTED_RELEASE_SOURCE_REF = "v2026.07.06";
      process.env.EXPECTED_RELEASE_GIT_COMMIT = "release-sha";
      process.env.EXPECTED_RELEASE_VERSION = "release-sha";
      process.env.EXPECTED_PRODUCTION_API_BASE_URL = "https://api.erp.example.com";
      mkdirSync(join(root, "evidence"), { recursive: true });
      writeFileSync(join(root, "evidence", "production-go-live.md"), validProductionGoLiveTemplate());

      const result = runProductionGoLiveEvidenceChecks({
        projectRoot: root,
        evidencePath: "evidence/production-go-live.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => `${failure.label}: ${failure.detail}`).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
