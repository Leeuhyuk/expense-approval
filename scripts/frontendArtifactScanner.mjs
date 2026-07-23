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

export function scanArtifactDirectory(rootDir, options = {}) {
  const root = resolve(rootDir);
  if (!existsSync(root)) {
    throw new Error(`Artifact directory does not exist: ${root}`);
  }

  const files = walkFiles(root).filter((path) => {
    const size = statSync(path).size;
    return size > 0 && size <= (options.maxFileBytes ?? 5_000_000) && isTextArtifact(path);
  });

  const issues = files.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return scanArtifactText(text, relative(root, path).replaceAll("\\", "/"), options.rules ?? frontendArtifactRules);
  });

  return { root, scannedFiles: files.length, issues };
}
