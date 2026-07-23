import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { auditRequestContext } from "../../backend/src/routes/rowUtils";

const auditRouteFiles = [
  "backend/src/routes/approvals.ts",
  "backend/src/routes/disbursements.ts",
  "backend/src/routes/files.ts",
  "backend/src/routes/pageResources.ts",
  "backend/src/routes/paymentRequests.ts",
] as const;

function auditCreateBlocks(source: string) {
  const pattern = /(?:tx|prisma)\.auditLog\.create\s*\(\s*\{/g;
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? source.length;
    return source.slice(start, next);
  });
}

describe("backend audit log request context", () => {
  it("captures requestId, ipAddress, and userAgent from Fastify requests", () => {
    assert.deepEqual(
      auditRequestContext({
        id: "req-audit-1",
        ip: "203.0.113.90",
        headers: { "user-agent": ["Browser", "Agent"] },
      } as never),
      {
        requestId: "req-audit-1",
        ipAddress: "203.0.113.90",
        userAgent: "Browser Agent",
      },
    );
  });

  it("keeps every auditLog.create call on the shared request context helper", () => {
    for (const filePath of auditRouteFiles) {
      const source = readFileSync(resolve(filePath), "utf8");
      const blocks = auditCreateBlocks(source);
      assert.ok(blocks.length > 0, `${filePath} should have at least one auditLog.create call`);
      for (const block of blocks) {
        assert.match(block, /\.\.\.auditRequestContext\(request\)/, `${filePath} auditLog.create must include requestId, ipAddress, and userAgent`);
      }
    }
  });

  it("keeps audit log request context fields in schema and migration", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const migration = readFileSync(resolve("prisma/migrations/20260705040000_audit_log_request_context/migration.sql"), "utf8");

    assert.match(schema, /model AuditLog[\s\S]*ipAddress\s+String\?/);
    assert.match(schema, /model AuditLog[\s\S]*userAgent\s+String\?/);
    assert.match(migration, /ADD COLUMN "ipAddress" TEXT/);
    assert.match(migration, /ADD COLUMN "userAgent" TEXT/);
  });
});
