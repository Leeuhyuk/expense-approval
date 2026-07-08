import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { evaluateMigrationDirectory } from "../../scripts/migrationGuard.mjs";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "erp-migrations-"));
  mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "prisma", "schema.prisma"),
    'datasource db { provider = "postgresql" url = env("DATABASE_URL") }',
  );
  writeFileSync(join(root, "prisma", "migrations", "migration_lock.toml"), 'provider = "postgresql"');
  return root;
}

describe("migration release guard", () => {
  it("passes additive migrations with defaults", () => {
    const root = makeFixture();
    const originalCwd = process.cwd();
    try {
      mkdirSync(join(root, "prisma", "migrations", "20260705010000_add_vendor_tax_fields"));
      writeFileSync(
        join(root, "prisma", "migrations", "20260705010000_add_vendor_tax_fields", "migration.sql"),
        'ALTER TABLE "vendors" ADD COLUMN "taxInvoiceEmail" TEXT NOT NULL DEFAULT \'\';',
      );
      process.chdir(root);

      const result = evaluateMigrationDirectory();

      assert.equal(result.issues.length, 0);
      assert.deepEqual(result.checkedMigrations, ["20260705010000_add_vendor_tax_fields"]);
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks destructive or risky migrations", () => {
    const root = makeFixture();
    const originalCwd = process.cwd();
    try {
      mkdirSync(join(root, "prisma", "migrations", "20260705020000_risky_change"));
      writeFileSync(
        join(root, "prisma", "migrations", "20260705020000_risky_change", "migration.sql"),
        'ALTER TABLE "vendors" DROP COLUMN "bankAccountEncrypted";\nALTER TABLE "users" ADD COLUMN "employeeNo" TEXT NOT NULL;',
      );
      process.chdir(root);

      const result = evaluateMigrationDirectory();

      assert.deepEqual(
        result.issues.map((issue) => issue.ruleId).sort(),
        ["add-not-null-without-default", "drop-column"],
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails release migration checks when strict dry-run mode has no shadow database", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-migrations.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REQUIRE_SHADOW_DATABASE_URL: "true",
        SHADOW_DATABASE_URL: "",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHADOW_DATABASE_URL is required/);
  });
});
