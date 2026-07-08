import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { scanAuditAppendOnlyProject, scanAuditAppendOnlyText } from "../../scripts/auditAppendOnlyScanner.mjs";

describe("audit log append-only scanner", () => {
  it("allows create-only audit log writes", () => {
    const issues = scanAuditAppendOnlyText(
      [
        "await tx.auditLog.create({ data: { action: 'approve' } });",
        "CREATE TABLE \"audit_logs\" (\"id\" UUID PRIMARY KEY);",
      ].join("\n"),
      "backend/src/routes/approvals.ts",
    );

    assert.equal(issues.length, 0);
  });

  it("blocks Prisma, SQL, and route audit log mutations", () => {
    const issues = scanAuditAppendOnlyText(
      [
        "await prisma.auditLog.update({ where: { id }, data: {} });",
        "DELETE FROM \"audit_logs\" WHERE id = '1';",
        "app.delete('/audit-logs/:id', async () => {});",
      ].join("\n"),
      "backend/src/routes/auditLogs.ts",
    );

    assert.deepEqual(
      issues.map((issue) => issue.ruleId).sort(),
      ["audit-log-mutation-route", "prisma-audit-log-mutation", "sql-audit-log-mutation"],
    );
  });

  it("scans only release source roots", () => {
    const root = mkdtempSync(join(tmpdir(), "erp-audit-scan-"));
    try {
      mkdirSync(join(root, "backend", "src", "routes"), { recursive: true });
      mkdirSync(join(root, "tests", "unit"), { recursive: true });
      writeFileSync(join(root, "backend", "src", "routes", "approvals.ts"), "await tx.auditLog.create({ data: {} });");
      writeFileSync(join(root, "tests", "unit", "fixture.test.ts"), "await prisma.auditLog.delete({ where: { id } });");

      const result = scanAuditAppendOnlyProject(root);

      assert.equal(result.issues.length, 0);
      assert.equal(result.scannedFiles, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the database-level append-only trigger migration", () => {
    const path = "prisma/migrations/20260705030000_audit_log_append_only_trigger/migration.sql";
    assert.equal(existsSync(path), true);
    const sql = readFileSync(path, "utf8");

    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+prevent_audit_log_mutation/i);
    assert.match(sql, /CREATE\s+TRIGGER\s+audit_logs_append_only/i);
    assert.match(sql, /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"audit_logs"/i);
  });
});
