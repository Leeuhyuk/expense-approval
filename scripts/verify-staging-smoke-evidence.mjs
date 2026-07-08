#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/staging-smoke-evidence-template.md";

const requiredSections = [
  "Release Identity",
  "Environment Separation",
  "Artifact And Migration",
  "Health Checks",
  "Remote Frontend",
  "Business Smoke Flows",
  "Persistence And Cross Browser",
  "Security Smoke",
  "File And Integration Smoke",
  "Evidence Links",
  "Promotion Decision",
];

const requiredTerms = [
  "Release manifest hash",
  "EXPECTED_RELEASE_MANIFEST_SHA256",
  "Migration review hash",
  "staging DB",
  "object storage",
  "secret manager",
  "domain",
  "VITE_ERP_API_MODE",
  "remote",
  "VITE_ERP_API_BASE_URL",
  "/api/health/version",
  "Frontend/backend release identity comparison",
  "backend API",
  "/api/health",
  "/api/health/db",
  "/api/health/storage",
  "/api/health/file-security",
  "/api/health/jobs",
  "/api/health/integrations",
  "/api/operations/data-quality",
  "requestId",
  "mock fallback",
  "결제 요청",
  "첨부 업로드",
  "승인자 순차 승인",
  "지급 보류",
  "거래처 등록",
  "시스템 설정",
  "권한 그룹",
  "보고서",
  "다운로드",
  "즐겨찾기",
  "새로고침",
  "재로그인",
  "다른 브라우저",
  "Prisma DB",
  "AuditLog",
  "CSRF",
  "signed URL",
  "session 만료",
  "Secure",
  "HttpOnly",
  "SameSite",
  "CORS",
  "malware scanner",
  "Promotion Decision",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

const hashPattern = /^[a-f0-9]{64}$/i;

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
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/);
    if (!match) continue;
    const key = match[1].replace(/`/g, "").trim();
    const value = match[2].trim();
    if (!key || key === "---" || key === "항목") continue;
    values.set(key, value);
  }
  return values;
}

function valueEquals(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function validateStructuredPromotionFields(source, strict) {
  if (!strict) return [];

  const table = markdownTableValues(source);
  const checks = [];
  const releaseManifestHash = table.get("Release manifest hash") ?? "";
  const expectedPromotionHash = table.get("EXPECTED_RELEASE_MANIFEST_SHA256 promotion hash") ?? "";
  const migrationReviewHash = table.get("Migration review hash") ?? "";
  const releaseRef = table.get("Release branch or tag") ?? "";
  const target = table.get("Release target promoted from staging") ?? "";
  const apiMode = table.get("VITE_ERP_API_MODE") ?? "";
  const promotionDecision = table.get("Production promotion decision") ?? "";
  const openBlockerCount = table.get("Open blocker count") ?? "";
  const expectedHashEnv = String(process.env.EXPECTED_RELEASE_MANIFEST_SHA256 ?? "").trim();
  const expectedRefEnv = String(process.env.EXPECTED_RELEASE_SOURCE_REF ?? "").trim();

  checks.push({
    label: "staging smoke evidence pins a production promotion target",
    ok: valueEquals(target, "production"),
    detail: target || "missing Release target promoted from staging",
  });

  checks.push({
    label: "staging smoke evidence confirms frontend remote API mode",
    ok: valueEquals(apiMode, "remote"),
    detail: apiMode || "missing VITE_ERP_API_MODE",
  });

  checks.push({
    label: "staging smoke evidence uses a valid release manifest hash",
    ok: hashPattern.test(releaseManifestHash),
    detail: releaseManifestHash || "missing Release manifest hash",
  });

  checks.push({
    label: "staging smoke evidence uses a valid promotion manifest hash",
    ok: hashPattern.test(expectedPromotionHash),
    detail: expectedPromotionHash || "missing EXPECTED_RELEASE_MANIFEST_SHA256 promotion hash",
  });

  checks.push({
    label: "staging smoke evidence promotion hash matches release manifest hash",
    ok: hashPattern.test(releaseManifestHash) && releaseManifestHash.toLowerCase() === expectedPromotionHash.toLowerCase(),
    detail: `${releaseManifestHash || "missing"} / ${expectedPromotionHash || "missing"}`,
  });

  checks.push({
    label: "staging smoke evidence uses a valid migration review hash",
    ok: hashPattern.test(migrationReviewHash),
    detail: migrationReviewHash || "missing Migration review hash",
  });

  if (expectedHashEnv) {
    checks.push({
      label: "staging smoke evidence promotion hash matches EXPECTED_RELEASE_MANIFEST_SHA256 env",
      ok: expectedPromotionHash.toLowerCase() === expectedHashEnv.toLowerCase(),
      detail: `${expectedPromotionHash || "missing"} / ${expectedHashEnv}`,
    });
  }

  if (expectedRefEnv) {
    checks.push({
      label: "staging smoke evidence release ref matches EXPECTED_RELEASE_SOURCE_REF env",
      ok: releaseRef === expectedRefEnv,
      detail: `${releaseRef || "missing"} / ${expectedRefEnv}`,
    });
  }

  checks.push({
    label: "staging smoke evidence approves production promotion",
    ok: /^(approved|approve|go|yes)$/i.test(promotionDecision.trim()),
    detail: promotionDecision || "missing Production promotion decision",
  });

  checks.push({
    label: "staging smoke evidence has zero open blockers for promotion",
    ok: openBlockerCount.trim() === "0",
    detail: openBlockerCount || "missing Open blocker count",
  });

  return checks;
}

export function runStagingSmokeEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.STAGING_SMOKE_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.STAGING_SMOKE_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "staging smoke evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `staging smoke evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "staging smoke evidence covers artifact, migration, health, business, persistence, security, file, and promotion terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "staging smoke evidence unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  checks.push(...validateStructuredPromotionFields(source, strict));

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
    const result = runStagingSmokeEvidenceChecks();
    console.log(`[staging-smoke-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[staging-smoke-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[staging-smoke-evidence] FAIL ${result.failures.length} staging smoke evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[staging-smoke-evidence] PASS ${result.checks.length} staging smoke evidence check(s) passed.`);
  } catch (error) {
    console.error(`[staging-smoke-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
