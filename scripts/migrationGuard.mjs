import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const destructiveMigrationRules = [
  { id: "drop-table", pattern: /\bDROP\s+TABLE\b/i, message: "drops a table" },
  { id: "drop-column", pattern: /\bDROP\s+COLUMN\b/i, message: "drops a column" },
  { id: "truncate", pattern: /\bTRUNCATE\b/i, message: "truncates data" },
  { id: "delete-from", pattern: /\bDELETE\s+FROM\b/i, message: "deletes data" },
  { id: "rename-table-or-column", pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\b/i, message: "renames a table or column" },
  { id: "alter-type", pattern: /\bALTER\s+TYPE\b[\s\S]*?\b(?:DROP|RENAME)\b/i, message: "changes enum/type compatibility" },
  { id: "set-not-null", pattern: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i, message: "sets a column to NOT NULL" },
];

const riskyAddNotNullWithoutDefault = /\bADD\s+COLUMN\b[^,;]*\bNOT\s+NULL\b(?![^,;]*\bDEFAULT\b)/gi;

function readText(path) {
  return readFileSync(path, "utf8");
}

function stripSqlComments(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function schemaProvider(schemaText) {
  return /datasource\s+\w+\s+\{[\s\S]*?provider\s*=\s*"([^"]+)"/.exec(schemaText)?.[1] ?? null;
}

function migrationProvider(lockText) {
  return /provider\s*=\s*"([^"]+)"/.exec(lockText)?.[1] ?? null;
}

function migrationDirectories(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function scanSql(sql) {
  const normalized = stripSqlComments(sql);
  const issues = destructiveMigrationRules.flatMap((rule) => (rule.pattern.test(normalized) ? [{ ruleId: rule.id, message: rule.message }] : []));
  for (const match of normalized.matchAll(riskyAddNotNullWithoutDefault)) {
    issues.push({
      ruleId: "add-not-null-without-default",
      message: `adds a NOT NULL column without DEFAULT near "${match[0].trim()}"`,
    });
  }
  return issues;
}

export function evaluateMigrationDirectory({ projectRoot = process.cwd(), schemaPath = "prisma/schema.prisma", migrationsDir = "prisma/migrations" } = {}) {
  const root = resolve(projectRoot);
  const resolvedSchema = resolve(root, schemaPath);
  const resolvedMigrations = resolve(root, migrationsDir);
  const lockPath = join(resolvedMigrations, "migration_lock.toml");
  const issues = [];
  const warnings = [];
  const checkedMigrations = [];

  if (!existsSync(resolvedSchema)) {
    issues.push({ ruleId: "missing-schema", message: `Missing Prisma schema: ${schemaPath}` });
    return { issues, warnings, checkedMigrations };
  }
  if (!existsSync(resolvedMigrations)) {
    issues.push({ ruleId: "missing-migrations", message: `Missing migrations directory: ${migrationsDir}` });
    return { issues, warnings, checkedMigrations };
  }
  if (!existsSync(lockPath)) {
    issues.push({ ruleId: "missing-migration-lock", message: "Missing prisma/migrations/migration_lock.toml" });
  } else {
    const provider = schemaProvider(readText(resolvedSchema));
    const lockProvider = migrationProvider(readText(lockPath));
    if (!provider || !lockProvider || provider !== lockProvider) {
      issues.push({
        ruleId: "provider-mismatch",
        message: `Schema provider (${provider ?? "unknown"}) does not match migration lock provider (${lockProvider ?? "unknown"}).`,
      });
    }
  }

  for (const dirName of migrationDirectories(resolvedMigrations)) {
    if (!/^\d{14}_[a-z0-9_]+$/.test(dirName)) {
      warnings.push({ ruleId: "migration-name", migration: dirName, message: "Migration directory name should be timestamp_slug." });
    }
    const migrationPath = join(resolvedMigrations, dirName, "migration.sql");
    if (!existsSync(migrationPath)) {
      issues.push({ ruleId: "missing-sql", migration: dirName, message: "Missing migration.sql." });
      continue;
    }
    if (statSync(migrationPath).size === 0) {
      issues.push({ ruleId: "empty-sql", migration: dirName, message: "migration.sql is empty." });
      continue;
    }
    checkedMigrations.push(dirName);
    for (const issue of scanSql(readText(migrationPath))) {
      issues.push({ ...issue, migration: dirName });
    }
  }

  if (checkedMigrations.length === 0) {
    issues.push({ ruleId: "no-migrations", message: "No migration directories were found." });
  }

  return { issues, warnings, checkedMigrations };
}
