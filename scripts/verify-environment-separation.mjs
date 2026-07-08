#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultMatrixPath = "docs/environment-separation-matrix-template.md";

const requiredSections = [
  "Environment Matrix",
  "Isolation Checks",
  "Secret Boundaries",
  "Data Boundaries",
  "Promotion Controls",
  "Evidence Links",
];

const requiredTerms = [
  "dev",
  "staging",
  "production",
  "Database",
  "Object storage",
  "Auth/session",
  "Secret scope",
  "Domain/API origin",
  "Logs/monitoring",
  "Data policy",
  "secret manager",
  "break-glass",
  "Same artifact promotion",
  "Same migration promotion",
  "release manifest hash",
  "Migration review hash",
  "RELEASE_NOTE_PATH",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

const localHostPattern = /(^|\.)(localhost|local|dev|test)(\.|$)|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1/i;

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

function tableCells(line) {
  if (!/^\|/.test(line.trim())) return null;
  const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.replace(/`/g, "").trim());
  if (cells.length === 0 || cells.every((cell) => /^-+$/.test(cell))) return null;
  return cells;
}

function environmentRows(source) {
  const rows = new Map();
  let header = null;
  for (const line of source.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!cells) continue;
    if (cells[0] === "Environment") {
      header = cells;
      continue;
    }
    if (!header) continue;
    const env = cells[0]?.toLowerCase();
    if (!["dev", "staging", "production"].includes(env)) continue;
    const row = new Map();
    header.forEach((key, index) => row.set(key, cells[index] ?? ""));
    rows.set(env, row);
  }
  return rows;
}

function clean(value) {
  return String(value ?? "").trim();
}

function isResolvedValue(value) {
  const trimmed = clean(value);
  return trimmed.length > 0 && !unresolvedPatterns.some((pattern) => pattern.test(trimmed));
}

function valuesAreSeparated(rows, column) {
  const values = ["dev", "staging", "production"].map((env) => clean(rows.get(env)?.get(column)).toLowerCase());
  return values.every(Boolean) && new Set(values).size === values.length;
}

function hasHttpsNonLocal(value) {
  const matches = clean(value).match(/https:\/\/[^\s,/]+/gi) ?? [];
  return matches.length > 0 && matches.every((raw) => {
    try {
      const parsed = new URL(raw);
      return parsed.protocol === "https:" && !localHostPattern.test(parsed.hostname);
    } catch {
      return false;
    }
  });
}

function validateStructuredMatrix(source, strict) {
  if (!strict) return [];

  const rows = environmentRows(source);
  const checks = [
    {
      label: "environment separation matrix has dev, staging, and production rows",
      ok: ["dev", "staging", "production"].every((env) => rows.has(env)),
      detail: Array.from(rows.keys()).join(", ") || "missing environment rows",
    },
  ];

  const requiredColumns = ["Database", "Object storage", "Auth/session", "Secret scope", "Domain/API origin", "Logs/monitoring", "Data policy"];
  for (const env of ["dev", "staging", "production"]) {
    for (const column of requiredColumns) {
      checks.push({
        label: `environment separation ${env} ${column} is resolved`,
        ok: isResolvedValue(rows.get(env)?.get(column)),
        detail: rows.get(env)?.get(column) || "missing",
      });
    }
  }

  for (const column of ["Database", "Object storage", "Auth/session", "Secret scope", "Domain/API origin", "Logs/monitoring"]) {
    checks.push({
      label: `environment separation keeps ${column} distinct across dev/staging/production`,
      ok: rows.size === 3 && valuesAreSeparated(rows, column),
      detail: ["dev", "staging", "production"].map((env) => `${env}=${rows.get(env)?.get(column) || "missing"}`).join(" | "),
    });
  }

  const stagingDataPolicy = rows.get("staging")?.get("Data policy") ?? "";
  const productionDataPolicy = rows.get("production")?.get("Data policy") ?? "";
  checks.push({
    label: "staging data policy avoids raw production sensitive data",
    ok: /(masked|anonym|synthetic|비식별|test account|테스트 계좌)/i.test(stagingDataPolicy),
    detail: stagingDataPolicy || "missing staging Data policy",
  });
  checks.push({
    label: "production data policy blocks mock/local seed data",
    ok: /(no mock|local seed|production data only|blocked|금지)/i.test(productionDataPolicy),
    detail: productionDataPolicy || "missing production Data policy",
  });
  checks.push({
    label: "staging and production domains use HTTPS non-local origins",
    ok: hasHttpsNonLocal(rows.get("staging")?.get("Domain/API origin")) && hasHttpsNonLocal(rows.get("production")?.get("Domain/API origin")),
    detail: `staging=${rows.get("staging")?.get("Domain/API origin") || "missing"} | production=${rows.get("production")?.get("Domain/API origin") || "missing"}`,
  });

  return checks;
}

export function runEnvironmentSeparationChecks({
  projectRoot = process.cwd(),
  matrixPath = process.env.ENVIRONMENT_SEPARATION_PATH || defaultMatrixPath,
  strict = isTruthyEnvValue(process.env.ENVIRONMENT_SEPARATION_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, matrixPath);
  const exists = existsSync(resolvedPath);
  checks.push({ label: "environment separation matrix document exists", ok: exists, detail: matrixPath });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, matrixPath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({ label: `environment separation section: ${section}`, ok: hasSection(source, section), detail: section });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "environment separation matrix covers environment, data, secret, promotion, and evidence terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "environment separation unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  checks.push(...validateStructuredMatrix(source, strict));
  const failures = checks.filter((check) => !check.ok);
  return { ok: failures.length === 0, checks, failures, strict, matrixPath, unresolvedCount: unresolved.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runEnvironmentSeparationChecks({ strict: process.env.RELEASE_TARGET === "production" || isTruthyEnvValue(process.env.ENVIRONMENT_SEPARATION_STRICT) });
    console.log(`[environment-separation] mode=${result.strict ? "strict" : "audit"} path=${result.matrixPath}`);
    for (const check of result.checks) {
      console.log(`[environment-separation] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[environment-separation] FAIL ${result.failures.length} environment separation check(s) failed.`);
      process.exit(1);
    }
    console.log(`[environment-separation] PASS ${result.checks.length} environment separation check(s) passed.`);
  } catch (error) {
    console.error(`[environment-separation] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}