import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const ciSource = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

describe("CI release gates", () => {
  it("runs release evidence gates for main and version tags", () => {
    assert.match(ciSource, /push:[\s\S]*branches:[\s\S]*-\s*main/, "CI must run on main branch pushes");
    assert.match(ciSource, /push:[\s\S]*tags:[\s\S]*-\s*"v\*"/, "CI must run on version tag pushes");
  });

  it("requires a shadow database for Prisma migration dry-run checks", () => {
    assert.match(ciSource, /Verify Prisma Migrations[\s\S]*REQUIRE_SHADOW_DATABASE_URL:\s*"true"/, "CI migration check must require a shadow database");
    assert.match(ciSource, /Verify Prisma Migrations[\s\S]*SHADOW_DATABASE_URL:\s*\$\{\{ secrets\.SHADOW_DATABASE_URL \}\}/, "CI migration check must use the SHADOW_DATABASE_URL secret");
    assert.match(ciSource, /Verify Prisma Migrations[\s\S]*npm run release:migration-check/, "CI must run the migration release check");
  });

  it("keeps frontend and backend deploy blockers in the required CI path", () => {
    assert.match(ciSource, /Generate Prisma Client[\s\S]*npm --prefix backend run db:generate/, "CI must generate the backend Prisma client");
    assert.match(ciSource, /Generate Migration Review[\s\S]*RELEASE_VERSION:\s*\$\{\{ github\.sha \}\}[\s\S]*npm run release:migration-review/, "CI must retain a migration review record for release approval");
    assert.match(ciSource, /Verify Migration Review[\s\S]*EXPECTED_RELEASE_VERSION:\s*\$\{\{ github\.sha \}\}[\s\S]*npm run release:verify-migration-review/, "CI must verify migration review evidence before release approval");
    assert.match(ciSource, /Verify Sensitive Data Exposure[\s\S]*npm run release:sensitive-data/, "CI must reject source paths that leak raw account or personal data");
    assert.match(ciSource, /Verify Mutation Safety[\s\S]*npm run release:mutation-safety/, "CI must reject unclassified or unguarded backend mutation routes");
    assert.match(ciSource, /Verify Performance Capacity[\s\S]*npm run release:performance-capacity/, "CI must verify production-volume list, report, upload, and rate-limit capacity guards");
    assert.match(ciSource, /Verify Operational Documentation[\s\S]*npm run release:operational-docs/, "CI must verify user, admin, incident, and deployment runbooks before release evidence");
    assert.match(ciSource, /Verify Production Environment Inventory Template[\s\S]*npm run release:environment-inventory/, "CI must verify the production environment inventory template before release evidence");
    assert.match(ciSource, /Verify Staging Smoke Evidence Template[\s\S]*npm run release:staging-smoke-evidence/, "CI must verify the staging smoke evidence template before release evidence");
    assert.match(ciSource, /Verify Backup Restore Evidence Template[\s\S]*npm run release:backup-restore-evidence/, "CI must verify the backup restore evidence template before release evidence");
    assert.match(ciSource, /Verify Data Migration Evidence Template[\s\S]*npm run release:data-migration-evidence/, "CI must verify the data migration evidence template before release evidence");
    assert.match(ciSource, /Verify Role UAT Evidence Template[\s\S]*npm run release:role-uat-evidence/, "CI must verify the role UAT evidence template before release evidence");
    assert.match(ciSource, /Verify Production Go-Live Evidence Template[\s\S]*npm run release:production-go-live-evidence/, "CI must verify the production go-live evidence template before release evidence");
    assert.match(ciSource, /Verify Post Go-Live Stabilization Evidence Template[\s\S]*npm run release:post-go-live-stabilization-evidence/, "CI must verify the post go-live stabilization evidence template before release evidence");
    assert.match(ciSource, /Verify Final Acceptance Evidence Template[\s\S]*npm run release:final-acceptance-evidence/, "CI must verify the final acceptance evidence template before release evidence");
    assert.match(ciSource, /Verify Go-Live Handoff Template[\s\S]*npm run release:go-live-handoff/, "CI must verify the go-live handoff template before release evidence");
    assert.match(ciSource, /Go-Live Readiness Audit[\s\S]*npm run release:go-live-readiness/, "CI must report open go-live P0 blockers on every release evidence run");
    assert.match(ciSource, /Generate Go-Live Readiness Report[\s\S]*npm run release:go-live-readiness-report/, "CI must retain the full open P0 readiness report for release evidence");
    assert.match(ciSource, /Require DB Test Evidence[\s\S]*startsWith\(github\.ref, 'refs\/tags\/v'\)[\s\S]*REQUIRE_DB_TEST_EVIDENCE:\s*"true"[\s\S]*npm run release:db-test-evidence-run[\s\S]*npm run release:db-test-evidence/, "CI must run and verify DB-backed test evidence before version-tag release candidates");
    assert.match(ciSource, /Run Tests[\s\S]*ERP_TEST_DATABASE_URL:\s*\$\{\{ secrets\.ERP_TEST_DATABASE_URL \}\}[\s\S]*npm test/, "CI must pass the test database URL into browser tests so remote-mode E2E can run when configured");
    assert.match(ciSource, /Run DB Integration Tests[\s\S]*ERP_TEST_DATABASE_URL:\s*\$\{\{ secrets\.ERP_TEST_DATABASE_URL \}\}[\s\S]*npm run test:integration/, "CI must run DB-backed integration tests when the test database secret is configured");
    assert.match(ciSource, /Build Frontend[\s\S]*VITE_ERP_API_MODE:\s*remote[\s\S]*VITE_RELEASE_VERSION:\s*\$\{\{ github\.sha \}\}[\s\S]*VITE_RELEASE_SOURCE_REF:\s*\$\{\{ github\.ref_name \}\}[\s\S]*VITE_RELEASE_GIT_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*npm run build/, "CI must build frontend in remote mode with release identity");
    assert.match(ciSource, /Frontend Production Artifact Scan[\s\S]*npm run release:frontend-artifact/, "CI must scan production frontend artifacts");
    assert.match(ciSource, /Build Backend[\s\S]*npm --prefix backend run build/, "CI must build the backend");
    assert.match(ciSource, /Backend Production Start Smoke[\s\S]*RELEASE_VERSION:\s*\$\{\{ github\.sha \}\}[\s\S]*RELEASE_SOURCE_REF:\s*\$\{\{ github\.ref_name \}\}[\s\S]*RELEASE_GIT_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*npm run release:backend-smoke/, "CI must run backend production startup smoke with release identity");
    assert.match(ciSource, /Generate Release Manifest[\s\S]*npm run release:manifest/, "CI must generate a release artifact manifest");
    assert.match(ciSource, /Verify Release Manifest[\s\S]*EXPECTED_RELEASE_GIT_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*npm run release:verify-manifest/, "CI must verify release manifest checksums and recorded git commit before retaining artifacts");
    assert.match(ciSource, /Upload Release Evidence[\s\S]*erp-release-evidence[\s\S]*release\/release-manifest\.json[\s\S]*release\/migration-review\.json[\s\S]*release\/go-live-readiness-report\.json[\s\S]*release\/go-live-readiness-report\.md/, "CI must retain release evidence artifacts");
  });
});
