import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { runProductionEnvironmentInventoryChecks } from "../../scripts/verify-production-environment-inventory.mjs";

const releaseHash = "a".repeat(64);
const migrationHash = "b".repeat(64);

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "erp-production-environment-inventory-"));
}

function filledInventoryTemplate() {
  return readFileSync(resolve("docs/production-environment-inventory-template.md"), "utf8")
    .replace("| Release manifest hash | TBD |", `| Release manifest hash | ${releaseHash} |`)
    .replace("| Migration review hash | TBD |", `| Migration review hash | ${migrationHash} |`)
    .replace("| Release branch or tag | TBD |", "| Release branch or tag | v2026.07.06 |")
    .replace("| Frontend domain | TBD |", "| Frontend domain | erp.example.com |")
    .replace("| API domain | TBD |", "| API domain | erp-api.example.com |")
    .replace("| `VITE_ERP_API_BASE_URL` | TBD |", "| `VITE_ERP_API_BASE_URL` | https://erp-api.example.com/api |")
    .replace("| `EXPECTED_PRODUCTION_API_BASE_URL` | TBD |", "| `EXPECTED_PRODUCTION_API_BASE_URL` | https://erp-api.example.com/api |")
    .replace("| `FRONTEND_ORIGIN` | TBD |", "| `FRONTEND_ORIGIN` | https://erp.example.com |")
    .replace("| `EXPECTED_PRODUCTION_FRONTEND_ORIGIN` | TBD |", "| `EXPECTED_PRODUCTION_FRONTEND_ORIGIN` | https://erp.example.com |")
    .replace("| `DATABASE_URL` secret reference | `<secret-manager-reference>` |", "| `DATABASE_URL` secret reference | secret-manager://payment-approval-erp/prod/database-url |")
    .replace("| `PGSSLMODE` or URL TLS policy | TBD |", "| `PGSSLMODE` or URL TLS policy | verify-full |")
    .replace("| `S3_ENDPOINT` | TBD |", "| `S3_ENDPOINT` | https://s3.example.com |")
    .replace("| `S3_BUCKET` | TBD |", "| `S3_BUCKET` | payment-approval-erp-prod-files |")
    .replace("| `S3_BUCKET_PUBLIC_ACCESS_BLOCKED` | TBD |", "| `S3_BUCKET_PUBLIC_ACCESS_BLOCKED` | true |")
    .replace("| `S3_SERVER_SIDE_ENCRYPTION_ENABLED` | TBD |", "| `S3_SERVER_SIDE_ENCRYPTION_ENABLED` | true |")
    .replace("| `FILE_URL_SECRET` reference | `<secret-manager-reference>` |", "| `FILE_URL_SECRET` reference | secret-manager://payment-approval-erp/prod/file-url-secret |")
    .replace("| `CSRF_SECRET` reference | `<secret-manager-reference>` |", "| `CSRF_SECRET` reference | secret-manager://payment-approval-erp/prod/csrf-secret |")
    .replace("| `BANK_ACCOUNT_SECRET` reference | `<secret-manager-reference>` |", "| `BANK_ACCOUNT_SECRET` reference | secret-manager://payment-approval-erp/prod/bank-account-secret |")
    .replace("| `S3_ACCESS_KEY_ID` reference | `<secret-manager-reference>` |", "| `S3_ACCESS_KEY_ID` reference | secret-manager://payment-approval-erp/prod/s3-access-key-id |")
    .replace("| `S3_SECRET_ACCESS_KEY` reference | `<secret-manager-reference>` |", "| `S3_SECRET_ACCESS_KEY` reference | secret-manager://payment-approval-erp/prod/s3-secret-access-key |")
    .replace("| `MALWARE_SCAN_TOKEN` reference | `<secret-manager-reference>` |", "| `MALWARE_SCAN_TOKEN` reference | secret-manager://payment-approval-erp/prod/malware-scan-token |")
    .replace("| Backend instance count | TBD |", "| Backend instance count | 2 |")
    .replace("| `MALWARE_SCAN_ENDPOINT` | TBD |", "| `MALWARE_SCAN_ENDPOINT` | https://scanner.example.com/scan |")
    .replace("| Integration credential references | `<secret-manager-reference>` |", "| Integration credential references | secret-manager://payment-approval-erp/prod/integrations |")
    .replace(/\bTBD\b/g, "EVIDENCE-2026-07-06")
    .replace(/\bpending\b/g, "approved")
    .replace(/<[^>\n]+>/g, "secret-manager-reference");
}

describe("production environment inventory release gate", () => {
  it("allows the tracked production environment inventory template in audit mode while placeholders are still unresolved", () => {
    const result = runProductionEnvironmentInventoryChecks({ projectRoot: resolve("."), strict: false });

    assert.equal(result.ok, true);
    assert.ok(result.unresolvedCount > 0);
  });

  it("fails strict mode when production environment inventory placeholders remain", () => {
    const result = runProductionEnvironmentInventoryChecks({ projectRoot: resolve("."), strict: true });

    assert.equal(result.ok, false);
    assert.match(result.failures.map((failure) => failure.detail).join("\n"), /TBD|pending|<secret-manager-reference>/);
  });

  it("passes strict mode when all production environment inventory fields are filled", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "inventory"), { recursive: true });
      writeFileSync(join(root, "inventory", "production.md"), filledInventoryTemplate());

      const result = runProductionEnvironmentInventoryChecks({
        projectRoot: root,
        inventoryPath: "inventory/production.md",
        strict: true,
      });

      assert.equal(result.ok, true, result.failures.map((failure) => failure.detail).join("\n"));
      assert.equal(result.unresolvedCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails strict mode when production inventory values are not deployable", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "inventory"), { recursive: true });
      writeFileSync(
        join(root, "inventory", "production.md"),
        filledInventoryTemplate()
          .replace("| Frontend domain | erp.example.com |", "| Frontend domain | localhost |")
          .replace("| `EXPECTED_PRODUCTION_API_BASE_URL` | https://erp-api.example.com/api |", "| `EXPECTED_PRODUCTION_API_BASE_URL` | https://other-api.example.com/api |")
          .replace("| `DATABASE_URL` secret reference | secret-manager://payment-approval-erp/prod/database-url |", "| `DATABASE_URL` secret reference | postgresql://user:password@db.example.com:5432/app |")
          .replace("| `S3_BUCKET_PUBLIC_ACCESS_BLOCKED` | true |", "| `S3_BUCKET_PUBLIC_ACCESS_BLOCKED` | false |"),
      );

      const result = runProductionEnvironmentInventoryChecks({
        projectRoot: root,
        inventoryPath: "inventory/production.md",
        strict: true,
      });

      assert.equal(result.ok, false);
      const labels = result.failures.map((failure) => failure.label).join("\n");
      assert.match(labels, /non-local production frontend and API domains/);
      assert.match(labels, /HTTPS production API base URL/);
      assert.match(labels, /DATABASE_URL as a secret reference/);
      assert.match(labels, /blocks public object storage access/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
