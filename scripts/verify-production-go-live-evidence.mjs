#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/production-go-live-evidence-template.md";

const requiredSections = [
  "Release Identity",
  "Artifact And Environment Checksums",
  "Production Migration",
  "Backend Health Checks",
  "Frontend Smoke",
  "Business Smoke",
  "Open P0 And Exceptions",
  "Rollback Readiness",
  "Communication And Freeze",
  "Evidence Links",
  "Final Production Sign-Off",
];

const requiredTerms = [
  "Release version",
  "Release source ref",
  "Git commit",
  "Release manifest hash",
  "EXPECTED_RELEASE_MANIFEST_SHA256",
  "Migration review hash",
  "Frontend artifact checksum",
  "Backend artifact checksum",
  "Prisma migration checksum",
  "Production env checksum",
  "Secret manager version",
  "VITE_ERP_API_MODE",
  "VITE_ERP_API_BASE_URL",
  "/api/health/version",
  "Frontend/backend release identity comparison",
  "Production DB backup before migration",
  "Migration deploy command/result",
  "Applied migration version",
  "Rollback/PITR readiness",
  "/api/health",
  "/api/health/db",
  "/api/health/storage",
  "/api/health/file-security",
  "/api/health/jobs",
  "/api/health/integrations",
  "/api/operations/alerts",
  "/api/operations/business-failure-alerts",
  "/api/operations/data-quality",
  "requestId",
  "Login smoke",
  "Menu permission smoke",
  "Payment request list smoke",
  "Attachment access smoke",
  "Notification center smoke",
  "Report download smoke",
  "Network API base URL",
  "결제 요청 생성",
  "증빙 첨부",
  "승인 처리",
  "지급 보류",
  "거래처",
  "시스템 설정 권한",
  "AuditLog",
  "open P0 count",
  "Approved exception",
  "Go-live readiness command result",
  "Rollback trigger criteria",
  "Rollback owner",
  "Rollback estimated time",
  "Previous release manifest",
  "User notice message",
  "Read-only mode",
  "Change freeze",
  "Incident channel",
  "Status update cadence",
  "Hypercare",
  "Production deployment run URL",
  "Go-live handoff document",
  "Role UAT evidence",
  "기능 책임자",
  "보안 책임자",
  "재무 책임자",
  "운영 책임자",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

const hashPattern = /^[a-f0-9]{64}$/i;
const passLikePattern = /\b(pass|passed|ok|healthy|success|successful|verified|clean|approved|match|matched|equal|same)\b/i;
const dateLikePattern = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?\b/;

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSection(source, section) {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(source);
}

function hasTerm(source, term) {
  return source.toLowerCase().includes(term.toLowerCase());
}

function unresolvedLines(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => unresolvedPatterns.some((pattern) => pattern.test(line)));
}

function markdownTableValues(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replace(/`/g, "").trim());
    if (cells.length < 2) continue;
    const [key, ...rest] = cells;
    const value = rest.join(" | ").trim();
    if (!key || key === "---" || key === "항목" || key === "책임 영역") continue;
    values.set(key, value);
  }
  return values;
}

function valueEquals(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function nonLocalHttps(value) {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname) &&
      !url.hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function parseIntegerValue(value) {
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  return Number.parseInt(value.trim(), 10);
}

function looksLikeEvidenceReference(value) {
  const normalized = value.trim();
  return /(https:\/\/|[A-Z]+-[A-Z0-9-]+|\w+:\/\/|release\/|docs\/|artifact:|run:)/i.test(normalized);
}

function validateStructuredGoLiveFields(source, strict) {
  if (!strict) return [];

  const table = markdownTableValues(source);
  const checks = [];
  const releaseManifestHash = table.get("Release manifest hash") ?? "";
  const expectedManifestHash = table.get("EXPECTED_RELEASE_MANIFEST_SHA256") ?? "";
  const migrationReviewHash = table.get("Migration review hash") ?? "";
  const releaseVersion = table.get("Release version") ?? "";
  const sourceRef = table.get("Release source ref") ?? "";
  const gitCommit = table.get("Git commit") ?? "";
  const apiMode = table.get("Frontend VITE_ERP_API_MODE") ?? table.get("VITE_ERP_API_MODE") ?? "";
  const apiBaseUrl = table.get("Frontend VITE_ERP_API_BASE_URL") ?? table.get("VITE_ERP_API_BASE_URL") ?? "";
  const frontendUrl = table.get("Production frontend URL") ?? "";
  const identityComparison = table.get("Frontend/backend release identity comparison") ?? "";
  const versionHealth = table.get("Backend /api/health/version result") ?? table.get("/api/health/version") ?? "";
  const expectedHashEnv = String(process.env.EXPECTED_RELEASE_MANIFEST_SHA256 ?? "").trim();
  const expectedRefEnv = String(process.env.EXPECTED_RELEASE_SOURCE_REF ?? "").trim();
  const expectedCommitEnv = String(process.env.EXPECTED_RELEASE_GIT_COMMIT ?? process.env.RELEASE_GIT_COMMIT ?? "").trim();
  const expectedVersionEnv = String(process.env.EXPECTED_RELEASE_VERSION ?? process.env.RELEASE_VERSION ?? "").trim();
  const expectedApiBaseEnv = String(process.env.EXPECTED_PRODUCTION_API_BASE_URL ?? "").trim();

  checks.push({
    label: "production go-live evidence uses a valid release manifest hash",
    ok: hashPattern.test(releaseManifestHash),
    detail: releaseManifestHash || "missing Release manifest hash",
  });

  checks.push({
    label: "production go-live evidence uses a valid expected release manifest hash",
    ok: hashPattern.test(expectedManifestHash),
    detail: expectedManifestHash || "missing EXPECTED_RELEASE_MANIFEST_SHA256",
  });

  checks.push({
    label: "production go-live evidence pins the promoted release manifest hash",
    ok: hashPattern.test(releaseManifestHash) && releaseManifestHash.toLowerCase() === expectedManifestHash.toLowerCase(),
    detail: `${releaseManifestHash || "missing"} / ${expectedManifestHash || "missing"}`,
  });

  checks.push({
    label: "production go-live evidence uses a valid migration review hash",
    ok: hashPattern.test(migrationReviewHash),
    detail: migrationReviewHash || "missing Migration review hash",
  });

  if (expectedHashEnv) {
    checks.push({
      label: "production go-live evidence manifest hash matches EXPECTED_RELEASE_MANIFEST_SHA256 env",
      ok: expectedManifestHash.toLowerCase() === expectedHashEnv.toLowerCase(),
      detail: `${expectedManifestHash || "missing"} / ${expectedHashEnv}`,
    });
  }

  if (expectedRefEnv) {
    checks.push({
      label: "production go-live evidence release source ref matches EXPECTED_RELEASE_SOURCE_REF env",
      ok: sourceRef === expectedRefEnv,
      detail: `${sourceRef || "missing"} / ${expectedRefEnv}`,
    });
  }

  if (expectedCommitEnv) {
    checks.push({
      label: "production go-live evidence git commit matches expected release commit",
      ok: gitCommit === expectedCommitEnv,
      detail: `${gitCommit || "missing"} / ${expectedCommitEnv}`,
    });
  }

  if (expectedVersionEnv) {
    checks.push({
      label: "production go-live evidence release version matches expected release version",
      ok: releaseVersion === expectedVersionEnv,
      detail: `${releaseVersion || "missing"} / ${expectedVersionEnv}`,
    });
  }

  checks.push({
    label: "production go-live evidence confirms frontend remote API mode",
    ok: valueEquals(apiMode, "remote"),
    detail: apiMode || "missing VITE_ERP_API_MODE",
  });

  checks.push({
    label: "production go-live evidence uses an HTTPS production API URL",
    ok: nonLocalHttps(apiBaseUrl),
    detail: apiBaseUrl || "missing VITE_ERP_API_BASE_URL",
  });

  if (expectedApiBaseEnv) {
    checks.push({
      label: "production go-live evidence API URL matches EXPECTED_PRODUCTION_API_BASE_URL env",
      ok: apiBaseUrl === expectedApiBaseEnv,
      detail: `${apiBaseUrl || "missing"} / ${expectedApiBaseEnv}`,
    });
  }

  checks.push({
    label: "production go-live evidence uses an HTTPS production frontend URL",
    ok: nonLocalHttps(frontendUrl),
    detail: frontendUrl || "missing Production frontend URL",
  });

  checks.push({
    label: "production go-live evidence confirms frontend/backend release identity match",
    ok: passLikePattern.test(identityComparison) && passLikePattern.test(versionHealth),
    detail: `${identityComparison || "missing identity comparison"} / ${versionHealth || "missing version health"}`,
  });

  const healthRows = [
    "/api/health",
    "/api/health/db",
    "/api/health/storage",
    "/api/health/file-security",
    "/api/health/jobs",
    "/api/health/integrations",
    "/api/health/version",
    "/api/operations/alerts",
    "/api/operations/business-failure-alerts",
    "/api/operations/data-quality",
  ];

  for (const row of healthRows) {
    const value = table.get(row) ?? "";
    checks.push({
      label: `production go-live evidence health result: ${row}`,
      ok: passLikePattern.test(value),
      detail: value || `missing ${row}`,
    });
  }

  const smokeRows = [
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
  ];

  for (const row of smokeRows) {
    const value = table.get(row) ?? "";
    checks.push({
      label: `production go-live evidence smoke result: ${row}`,
      ok: passLikePattern.test(value),
      detail: value || `missing ${row}`,
    });
  }

  const p0Counts = ["23장 open P0 count", "24장 open P0 count", "25장 open P0 count"].map((row) => ({
    row,
    value: table.get(row) ?? "",
    count: parseIntegerValue(table.get(row) ?? ""),
  }));
  const p0CountDetails = p0Counts.map(({ row, value }) => `${row}=${value || "missing"}`).join(", ");
  const totalOpenP0 = p0Counts.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  const approvedExceptionList = table.get("Approved exception list") ?? "";
  const exceptionOwnerDeadline = table.get("Exception owner/deadline") ?? "";

  checks.push({
    label: "production go-live evidence records numeric open P0 counts",
    ok: p0Counts.every((item) => Number.isInteger(item.count)),
    detail: p0CountDetails,
  });

  checks.push({
    label: "production go-live evidence has zero open P0 or explicit approved exceptions",
    ok:
      p0Counts.every((item) => Number.isInteger(item.count)) &&
      (totalOpenP0 === 0 || (/approved/i.test(approvedExceptionList) && dateLikePattern.test(exceptionOwnerDeadline))),
    detail:
      totalOpenP0 === 0
        ? "open P0 total=0"
        : `open P0 total=${totalOpenP0}; exceptions=${approvedExceptionList || "missing"}; owner/deadline=${exceptionOwnerDeadline || "missing"}`,
  });

  checks.push({
    label: "production go-live evidence readiness command passed",
    ok: passLikePattern.test(table.get("Go-live readiness command result") ?? ""),
    detail: table.get("Go-live readiness command result") || "missing Go-live readiness command result",
  });

  const requiredEvidenceLinks = [
    "Production deployment run URL",
    "Production health check log",
    "Frontend smoke recording or screenshot folder",
    "Release manifest artifact",
    "Migration review artifact",
    "Environment checksum archive",
    "Go-live handoff document",
    "Role UAT evidence",
  ];

  for (const row of requiredEvidenceLinks) {
    const value = table.get(row) ?? "";
    checks.push({
      label: `production go-live evidence reference: ${row}`,
      ok: looksLikeEvidenceReference(value),
      detail: value || `missing ${row}`,
    });
  }

  const signOffRows = ["기능 책임자", "보안 책임자", "재무 책임자", "운영 책임자"];
  for (const row of signOffRows) {
    const value = table.get(row) ?? "";
    checks.push({
      label: `production go-live evidence sign-off: ${row}`,
      ok: dateLikePattern.test(value) && looksLikeEvidenceReference(value),
      detail: value || `missing ${row} sign-off`,
    });
  }

  return checks;
}

export function runProductionGoLiveEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.PRODUCTION_GO_LIVE_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.PRODUCTION_GO_LIVE_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "production go-live evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `production go-live evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "production go-live evidence covers release, artifact, env, migration, health, frontend, business, P0, rollback, communication, and sign-off terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "production go-live evidence unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  checks.push(...validateStructuredGoLiveFields(source, strict));

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    strict,
    evidencePath,
    unresolvedCount: unresolved.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runProductionGoLiveEvidenceChecks();
    console.log(`[production-go-live-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[production-go-live-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[production-go-live-evidence] FAIL ${result.failures.length} production go-live evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[production-go-live-evidence] PASS ${result.checks.length} production go-live evidence check(s) passed.`);
  } catch (error) {
    console.error(`[production-go-live-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
