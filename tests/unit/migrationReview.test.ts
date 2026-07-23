import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildMigrationReview } from "../../scripts/generate-migration-review.mjs";
import { verifyMigrationReview } from "../../scripts/verify-migration-review.mjs";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "erp-migration-review-"));
  mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "prisma", "schema.prisma"), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  writeFileSync(join(root, "prisma", "migrations", "migration_lock.toml"), 'provider = "postgresql"');
  writeFileSync(join(root, "prisma", "seed.ts"), 'import { assertSeedAllowed } from "./seedSafety.js";\nassertSeedAllowed();\n');
  writeFileSync(join(root, "prisma", "seedSafety.ts"), "NODE_ENV RELEASE_TARGET");
  writeFileSync(join(root, "scripts", "verify-release-env.mjs"), 'if (env("ALLOW_PRODUCTION_SEED")) fail("blocked");');
  return root;
}

describe("migration release approval review", () => {
  it("records additive migration compatibility, rollback impact, and seed policy evidence", () => {
    const root = makeFixture();
    try {
      mkdirSync(join(root, "prisma", "migrations", "20260705010000_add_vendor_tax_fields"));
      writeFileSync(
        join(root, "prisma", "migrations", "20260705010000_add_vendor_tax_fields", "migration.sql"),
        'ALTER TABLE "vendors" ADD COLUMN "taxInvoiceEmail" TEXT NOT NULL DEFAULT \'\';',
      );

      const review = buildMigrationReview({
        projectRoot: root,
        releaseTarget: "staging",
        releaseVersion: "release-sha",
        generatedAt: "2026-07-05T00:00:00.000Z",
      });

      assert.equal(review.ok, true);
      assert.equal(review.releaseVersion, "release-sha");
      assert.equal(review.migrationCount, 1);
      assert.equal(review.seedPolicy.status, "pass");
      assert.equal(review.approvalPolicy.backwardCompatibility, "pass");
      assert.match(review.reviewSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(review.migrations[0].operations, ["alter-table", "add-column"]);
      assert.match(review.migrations[0].rollbackImpact, /PITR|compensating migration/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails the review when migrations contain destructive or risky SQL", () => {
    const root = makeFixture();
    try {
      mkdirSync(join(root, "prisma", "migrations", "20260705020000_drop_vendor_column"));
      writeFileSync(
        join(root, "prisma", "migrations", "20260705020000_drop_vendor_column", "migration.sql"),
        'ALTER TABLE "vendors" DROP COLUMN "bankAccountEncrypted";',
      );

      const review = buildMigrationReview({ projectRoot: root });

      assert.equal(review.ok, false);
      assert.equal(review.approvalPolicy.backwardCompatibility, "fail");
      assert.deepEqual(review.issues.map((issue) => issue.ruleId), ["drop-column"]);
      assert.equal(review.migrations[0].compatibility, "blocked-by-risky-migration-rule");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies migration review evidence against the current migration files and release version", () => {
    const root = makeFixture();
    try {
      mkdirSync(join(root, "prisma", "migrations", "20260705030000_add_report_index"));
      const migrationPath = join(root, "prisma", "migrations", "20260705030000_add_report_index", "migration.sql");
      writeFileSync(migrationPath, 'CREATE INDEX "report_runs_type_created_at_idx" ON "report_runs"("type", "createdAt");');
      const review = buildMigrationReview({
        projectRoot: root,
        releaseTarget: "staging",
        releaseVersion: "release-sha",
        generatedAt: "2026-07-05T00:00:00.000Z",
      });
      mkdirSync(join(root, "release"), { recursive: true });
      writeFileSync(join(root, "release", "migration-review.json"), `${JSON.stringify(review, null, 2)}\n`);

      const verified = verifyMigrationReview({
        projectRoot: root,
        reviewPath: "release/migration-review.json",
        expectedReleaseVersion: "release-sha",
      });
      assert.equal(verified.ok, true);
      assert.deepEqual(verified.errors, []);

      const wrongVersion = verifyMigrationReview({
        projectRoot: root,
        reviewPath: "release/migration-review.json",
        expectedReleaseVersion: "different-sha",
      });
      assert.equal(wrongVersion.ok, false);
      assert.match(wrongVersion.errors.join("\n"), /EXPECTED_RELEASE_VERSION mismatch/);

      writeFileSync(migrationPath, 'CREATE INDEX "report_runs_type_created_at_idx" ON "report_runs"("type", "createdAt");\nCREATE INDEX "report_runs_creator_idx" ON "report_runs"("createdBy");');
      const stale = verifyMigrationReview({
        projectRoot: root,
        reviewPath: "release/migration-review.json",
        expectedReleaseVersion: "release-sha",
      });
      assert.equal(stale.ok, false);
      assert.match(stale.errors.join("\n"), /reviewSha256 changed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
