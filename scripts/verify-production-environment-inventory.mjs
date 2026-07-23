#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultInventoryPath = "docs/production-environment-inventory-template.md";

const requiredSections = [
  "Environment Identity",
  "Deployment Platform",
  "Production Domains",
  "Database",
  "Object Storage",
  "Secret Manager",
  "Monitoring And Logging",
  "Runtime And Scaling",
  "Security Controls",
  "Backup And Restore",
  "External Integrations",
  "Evidence Links",
];

const requiredTerms = [
  "VITE_ERP_API_BASE_URL",
  "EXPECTED_PRODUCTION_API_BASE_URL",
  "FRONTEND_ORIGIN",
  "EXPECTED_PRODUCTION_FRONTEND_ORIGIN",
  "DATABASE_URL",
  "PGSSLMODE",
  "FILE_STORAGE_DRIVER",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_BUCKET_PUBLIC_ACCESS_BLOCKED",
  "S3_SERVER_SIDE_ENCRYPTION_ENABLED",
  "FILE_SCAN_MODE",
  "MALWARE_SCAN_ENDPOINT",
  "FILE_URL_SECRET",
  "CSRF_SECRET",
  "BANK_ACCOUNT_SECRET",
  "secret manager",
  "monitoring",
  "structured logs",
  "alerting",
  "backup",
  "PITR",
  "WAL",
  "object storage",
  "domain",
  "TLS",
  "HTTPS",
  "rollback",
  "requestId",
  "branch protection",
  "CDN",
  "WAF",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

const hashPattern = /^[a-f0-9]{64}$/i;
const localHostPattern = /(^|\.)(localhost|local|dev|test|staging)(\.|$)|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1/i;

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

function parseHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (localHostPattern.test(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseProductionHost(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const url = parseHttpsUrl(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (!url) return null;
  return url.hostname.toLowerCase();
}

function isSecretReference(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/postgres(?:ql)?:\/\//i.test(trimmed) || /@/.test(trimmed)) return false;
  return /(secret|vault|kms|key[-_ ]?vault|secretsmanager|parameter[-_ ]?store)/i.test(trimmed);
}

function isValidBucketName(value) {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.trim()) && !localHostPattern.test(value);
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value.trim());
}

function isScalingReady(value) {
  const trimmed = value.trim();
  if (isPositiveInteger(trimmed)) return Number(trimmed) >= 2;
  return /(autoscal|auto-scal|serverless|min\s*2|managed)/i.test(trimmed);
}

function validateStructuredInventoryFields(source, strict) {
  if (!strict) return [];

  const table = markdownTableValues(source);
  const releaseTarget = table.get("Release target") ?? "";
  const releaseManifestHash = table.get("Release manifest hash") ?? "";
  const migrationReviewHash = table.get("Migration review hash") ?? "";
  const frontendDomain = table.get("Frontend domain") ?? "";
  const apiDomain = table.get("API domain") ?? "";
  const apiBaseUrl = table.get("VITE_ERP_API_BASE_URL") ?? "";
  const expectedApiBaseUrl = table.get("EXPECTED_PRODUCTION_API_BASE_URL") ?? "";
  const frontendOrigin = table.get("FRONTEND_ORIGIN") ?? "";
  const expectedFrontendOrigin = table.get("EXPECTED_PRODUCTION_FRONTEND_ORIGIN") ?? "";
  const databaseUrlReference = table.get("DATABASE_URL secret reference") ?? "";
  const pgTlsPolicy = table.get("PGSSLMODE or URL TLS policy") ?? "";
  const storageDriver = table.get("FILE_STORAGE_DRIVER") ?? "";
  const storageEndpoint = table.get("S3_ENDPOINT") ?? "";
  const storageBucket = table.get("S3_BUCKET") ?? "";
  const storagePublicBlocked = table.get("S3_BUCKET_PUBLIC_ACCESS_BLOCKED") ?? "";
  const storageEncryption = table.get("S3_SERVER_SIDE_ENCRYPTION_ENABLED") ?? "";
  const backendInstanceCount = table.get("Backend instance count") ?? "";
  const bodyLimit = table.get("API_BODY_LIMIT_BYTES") ?? "";
  const rateLimitWindow = table.get("RATE_LIMIT_WINDOW_MS") ?? "";
  const rateLimitMax = table.get("RATE_LIMIT_MAX") ?? "";
  const fileScanMode = table.get("FILE_SCAN_MODE") ?? "";
  const malwareEndpoint = table.get("MALWARE_SCAN_ENDPOINT") ?? "";
  const frontendHost = parseProductionHost(frontendDomain);
  const apiHost = parseProductionHost(apiDomain);
  const parsedApiBaseUrl = parseHttpsUrl(apiBaseUrl);
  const parsedExpectedApiBaseUrl = parseHttpsUrl(expectedApiBaseUrl);
  const parsedFrontendOrigin = parseHttpsUrl(frontendOrigin);
  const parsedExpectedFrontendOrigin = parseHttpsUrl(expectedFrontendOrigin);
  const checks = [
    {
      label: "production environment inventory targets production",
      ok: valueEquals(releaseTarget, "production"),
      detail: releaseTarget || "missing Release target",
    },
    {
      label: "production environment inventory uses a valid release manifest hash",
      ok: hashPattern.test(releaseManifestHash),
      detail: releaseManifestHash || "missing Release manifest hash",
    },
    {
      label: "production environment inventory uses a valid migration review hash",
      ok: hashPattern.test(migrationReviewHash),
      detail: migrationReviewHash || "missing Migration review hash",
    },
    {
      label: "production environment inventory has non-local production frontend and API domains",
      ok: Boolean(frontendHost && apiHost && frontendHost !== apiHost),
      detail: `${frontendDomain || "missing"} / ${apiDomain || "missing"}`,
    },
    {
      label: "production environment inventory pins a HTTPS production API base URL",
      ok: Boolean(parsedApiBaseUrl && parsedExpectedApiBaseUrl && apiBaseUrl === expectedApiBaseUrl),
      detail: `${apiBaseUrl || "missing"} / ${expectedApiBaseUrl || "missing"}`,
    },
    {
      label: "production environment inventory API base URL matches the production API domain",
      ok: Boolean(parsedApiBaseUrl && apiHost && parsedApiBaseUrl.hostname.toLowerCase() === apiHost),
      detail: `${parsedApiBaseUrl?.hostname ?? "missing"} / ${apiHost ?? "missing"}`,
    },
    {
      label: "production environment inventory pins a HTTPS production frontend origin",
      ok: Boolean(parsedFrontendOrigin && parsedExpectedFrontendOrigin && frontendOrigin === expectedFrontendOrigin),
      detail: `${frontendOrigin || "missing"} / ${expectedFrontendOrigin || "missing"}`,
    },
    {
      label: "production environment inventory frontend origin matches the production frontend domain",
      ok: Boolean(parsedFrontendOrigin && frontendHost && parsedFrontendOrigin.hostname.toLowerCase() === frontendHost),
      detail: `${parsedFrontendOrigin?.hostname ?? "missing"} / ${frontendHost ?? "missing"}`,
    },
    {
      label: "production environment inventory stores DATABASE_URL as a secret reference",
      ok: isSecretReference(databaseUrlReference),
      detail: databaseUrlReference || "missing DATABASE_URL secret reference",
    },
    {
      label: "production environment inventory requires PostgreSQL TLS",
      ok: /(require|verify-ca|verify-full|tls|ssl)/i.test(pgTlsPolicy),
      detail: pgTlsPolicy || "missing PGSSLMODE or TLS policy",
    },
    {
      label: "production environment inventory uses object storage mode",
      ok: /^(s3|object-storage|object_storage)$/i.test(storageDriver.trim()),
      detail: storageDriver || "missing FILE_STORAGE_DRIVER",
    },
    {
      label: "production environment inventory pins a HTTPS object storage endpoint",
      ok: Boolean(parseHttpsUrl(storageEndpoint)),
      detail: storageEndpoint || "missing S3_ENDPOINT",
    },
    {
      label: "production environment inventory uses a production object storage bucket",
      ok: isValidBucketName(storageBucket),
      detail: storageBucket || "missing S3_BUCKET",
    },
    {
      label: "production environment inventory blocks public object storage access",
      ok: valueEquals(storagePublicBlocked, "true"),
      detail: storagePublicBlocked || "missing S3_BUCKET_PUBLIC_ACCESS_BLOCKED",
    },
    {
      label: "production environment inventory enables object storage encryption",
      ok: valueEquals(storageEncryption, "true"),
      detail: storageEncryption || "missing S3_SERVER_SIDE_ENCRYPTION_ENABLED",
    },
    {
      label: "production environment inventory stores application secrets as secret references",
      ok: [
        "FILE_URL_SECRET reference",
        "CSRF_SECRET reference",
        "BANK_ACCOUNT_SECRET reference",
        "S3_ACCESS_KEY_ID reference",
        "S3_SECRET_ACCESS_KEY reference",
        "MALWARE_SCAN_TOKEN reference",
      ].every((key) => isSecretReference(table.get(key) ?? "")),
      detail: "FILE_URL_SECRET, CSRF_SECRET, BANK_ACCOUNT_SECRET, S3, and malware scan token references",
    },
    {
      label: "production environment inventory has production runtime scaling",
      ok: isScalingReady(backendInstanceCount),
      detail: backendInstanceCount || "missing Backend instance count",
    },
    {
      label: "production environment inventory keeps API body limit within attachment policy bounds",
      ok: isPositiveInteger(bodyLimit) && Number(bodyLimit) >= 10 * 1024 * 1024 && Number(bodyLimit) <= 25 * 1024 * 1024,
      detail: bodyLimit || "missing API_BODY_LIMIT_BYTES",
    },
    {
      label: "production environment inventory keeps rate limits enabled",
      ok: isPositiveInteger(rateLimitWindow) && isPositiveInteger(rateLimitMax),
      detail: `${rateLimitWindow || "missing"} / ${rateLimitMax || "missing"}`,
    },
    {
      label: "production environment inventory uses external malware scanning",
      ok: valueEquals(fileScanMode, "external") && Boolean(parseHttpsUrl(malwareEndpoint)),
      detail: `${fileScanMode || "missing"} / ${malwareEndpoint || "missing"}`,
    },
  ];

  return checks;
}

export function runProductionEnvironmentInventoryChecks({
  projectRoot = process.cwd(),
  inventoryPath = process.env.PRODUCTION_ENVIRONMENT_INVENTORY_PATH || defaultInventoryPath,
  strict = isTruthyEnvValue(process.env.PRODUCTION_ENVIRONMENT_INVENTORY_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, inventoryPath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "production environment inventory document exists",
    ok: exists,
    detail: inventoryPath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, inventoryPath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `production environment inventory section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "production environment inventory covers deployment, data, storage, secrets, monitoring, backup, and security terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "production environment inventory unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  checks.push(...validateStructuredInventoryFields(source, strict));

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    strict,
    inventoryPath,
    unresolvedCount: unresolved.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runProductionEnvironmentInventoryChecks();
    console.log(`[production-environment-inventory] mode=${result.strict ? "strict" : "audit"} path=${result.inventoryPath}`);
    for (const check of result.checks) {
      console.log(`[production-environment-inventory] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[production-environment-inventory] FAIL ${result.failures.length} production environment inventory check(s) failed.`);
      process.exit(1);
    }
    console.log(`[production-environment-inventory] PASS ${result.checks.length} production environment inventory check(s) passed.`);
  } catch (error) {
    console.error(`[production-environment-inventory] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
