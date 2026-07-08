import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const operationsSource = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");
const schemaSource = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
const serviceSource = readFileSync(resolve("src/api/service.ts"), "utf8");

describe("audit log read access", () => {
  it("keeps external audit lookup read-only and separate from system settings", () => {
    const routeBlock = operationsSource.slice(
      operationsSource.indexOf('app.get("/operations/audit-logs"'),
      operationsSource.indexOf('app.get("/operations/retention-policy"'),
    );

    assert.match(routeBlock, /hasPermission\(user, "audit:read"\)/, "audit log lookup must allow audit:read");
    assert.match(routeBlock, /hasPermission\(user, "system:manage"\)/, "system managers may also inspect audit logs");
    assert.match(routeBlock, /rawValuePolicy/, "route must document that raw before/after values are not returned");
    assert.doesNotMatch(routeBlock, /beforeValue:\s*log\.beforeValue|afterValue:\s*log\.afterValue/, "external audit response must not expose raw JSON values");
    assert.match(serviceSource, /listAuditLogs\(query\?: AuditLogSearchQuery\)/, "frontend service must expose audit log search");
    assert.match(mainSource, /AuditLogSearchCard/, "reports screen must expose the read-only audit search card");
  });

  it("keeps audit log search backed by explicit indexes", () => {
    assert.match(schemaSource, /@@index\(\[entityType, entityId, createdAt\]\)/);
    assert.match(schemaSource, /@@index\(\[actorId, createdAt\]\)/);
    assert.match(schemaSource, /@@index\(\[action, createdAt\]\)/);
    assert.match(schemaSource, /@@index\(\[requestId\]\)/);
  });
});
