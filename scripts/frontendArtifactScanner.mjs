import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt", ".xml"]);

export const frontendArtifactRules = [
  {
    id: "mock-fixture-runtime",
    pattern: /mockData|mockService|mockApi|mock-upload:|mock-download:|bank-transfer-mock|MOCK_ROLE|mode["']?:["']mock/g,
    message: "local mock runtime or fixture string is present",
  },
  {
    id: "test-email",
    pattern: /example\.local|@test\.|@example\.(?:local|invalid)/gi,
    message: "test email or local example identity is present",
  },
  {
    id: "local-endpoint",
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/gi,
    message: "localhost or loopback endpoint is present",
  },
  {
    id: "seed-data",
    pattern: /seed:encrypted|seed-checksum|seed-request|payment-approval-erp-dev-seed|seed-only-password-hash/gi,
    message: "seed data marker is present",
  },
  {
    id: "dev-secret",
    pattern: /dev-file-url-secret-change-in-production|dev-bank-account-secret-change-in-production/gi,
    message: "development secret placeholder is present",
  },
];

function extensionOf(path) {
  const match = /\.[^.\\/]+$/.exec(path);
  return match?.[0].toLowerCase() ?? "";
}

function isTextArtifact(path) {
  return textExtensions.has(extensionOf(path));
}

function walkFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    if (!entry.isFile()) return [];
    return [path];
  });
}

function excerptAt(text, index, length) {
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + length + 48);
  return text.slice(start, end).replace(/\s+/g, " ");
}

function issue(filePath, ruleId, message, excerpt = "") {
  return { filePath, ruleId, message, excerpt };
}

export function scanArtifactText(text, filePath, rules = frontendArtifactRules) {
  return rules.flatMap((rule) => {
    const matches = [];
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        filePath,
        ruleId: rule.id,
        message: rule.message,
        excerpt: excerptAt(text, match.index, match[0].length),
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return matches;
  });
}

export function scanHostingPolicy(rootDir) {
  const headersPath = resolve(rootDir, "_headers");
  if (!existsSync(headersPath)) {
    return [issue("_headers", "missing-hosting-headers", "frontend artifact must include hosting cache/security headers")];
  }

  const text = readFileSync(headersPath, "utf8");
  const checks = [
    {
      ok: /Strict-Transport-Security:\s*max-age=31536000/i.test(text),
      ruleId: "missing-hsts",
      message: "Strict-Transport-Security with one-year max-age is required",
    },
    {
      ok: /X-Content-Type-Options:\s*nosniff/i.test(text),
      ruleId: "missing-nosniff",
      message: "X-Content-Type-Options: nosniff is required",
    },
    {
      ok: /\/index\.html[\s\S]*Cache-Control:\s*(?:no-store|no-cache|max-age=0)/i.test(text),
      ruleId: "missing-index-cache-policy",
      message: "index.html must use no-store/no-cache cache policy for fast rollback",
    },
    {
      ok: /\/assets\/\*[\s\S]*Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/i.test(text),
      ruleId: "missing-immutable-assets-cache",
      message: "hashed static assets must use one-year immutable cache policy",
    },
  ];

  return checks
    .filter((check) => !check.ok)
    .map((check) => issue("_headers", check.ruleId, check.message, text.slice(0, 240).replace(/\s+/g, " ")));
}

export function scanArtifactDirectory(rootDir, options = {}) {
  const root = resolve(rootDir);
  if (!existsSync(root)) {
    throw new Error(`Artifact directory does not exist: ${root}`);
  }

  const files = walkFiles(root).filter((path) => {
    const size = statSync(path).size;
    return size > 0 && size <= (options.maxFileBytes ?? 5_000_000) && isTextArtifact(path);
  });

  const textIssues = files.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return scanArtifactText(text, relative(root, path).replaceAll("\\", "/"), options.rules ?? frontendArtifactRules);
  });

  const hostingIssues = options.requireHostingPolicy ? scanHostingPolicy(root) : [];
  return { root, scannedFiles: files.length, issues: [...textIssues, ...hostingIssues] };
}