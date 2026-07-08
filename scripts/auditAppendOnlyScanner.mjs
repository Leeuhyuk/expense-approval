import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const sourceRoots = ["backend/src", "prisma/migrations"];
const textExtensions = new Set([".sql", ".ts", ".tsx", ".js", ".mjs"]);

export const auditAppendOnlyRules = [
  {
    id: "prisma-audit-log-mutation",
    pattern: /\bauditLog\s*\.\s*(?:update|updateMany|delete|deleteMany|upsert)\s*\(/g,
    message: "AuditLog must be append-only; Prisma update/delete/upsert calls are not allowed.",
  },
  {
    id: "sql-audit-log-mutation",
    pattern: /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\s+"?audit_logs"?\b/gi,
    message: "audit_logs table must not be updated, truncated, deleted, or dropped by application migrations.",
  },
  {
    id: "audit-log-mutation-route",
    pattern: /\bapp\s*\.\s*(?:patch|put|delete)\s*\(\s*["'`]\/audit-logs(?:\/|["'`])/g,
    message: "Audit log mutation API routes are not allowed.",
  },
];

function extensionOf(path) {
  const match = /\.[^.\\/]+$/.exec(path);
  return match?.[0].toLowerCase() ?? "";
}

function isTextSource(path) {
  return textExtensions.has(extensionOf(path));
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    if (!entry.isFile()) return [];
    return [path];
  });
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function excerptAt(text, index, length) {
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + length + 48);
  return text.slice(start, end).replace(/\s+/g, " ");
}

export function scanAuditAppendOnlyText(text, filePath, rules = auditAppendOnlyRules) {
  return rules.flatMap((rule) => {
    const matches = [];
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        filePath,
        line: lineAt(text, match.index),
        ruleId: rule.id,
        message: rule.message,
        excerpt: excerptAt(text, match.index, match[0].length),
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return matches;
  });
}

export function scanAuditAppendOnlyProject(rootDir = process.cwd(), options = {}) {
  const root = resolve(rootDir);
  const roots = options.sourceRoots ?? sourceRoots;
  const files = roots.flatMap((sourceRoot) => walkFiles(resolve(root, sourceRoot))).filter((path) => {
    const size = statSync(path).size;
    return size > 0 && size <= (options.maxFileBytes ?? 3_000_000) && isTextSource(path);
  });

  const issues = files.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return scanAuditAppendOnlyText(text, relative(root, path).replaceAll("\\", "/"), options.rules ?? auditAppendOnlyRules);
  });

  return { root, scannedFiles: files.length, issues };
}
