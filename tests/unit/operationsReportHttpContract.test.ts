import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(resolve("backend/src/routes/operations.ts"), "utf8");

function routeBlock(signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} route must exist`);
  const next = source.indexOf("\n  app.", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("operations report HTTP contract", () => {
  for (const route of [
    "/operations/alerts",
    "/operations/business-failure-alerts",
    "/operations/data-quality",
    "/operations/financial-reconciliation",
    "/operations/financial-control-report",
    "/operations/permission-review",
    "/operations/privacy-access-report",
    "/operations/audit-integrity-report",
  ]) {
    it(`returns ${route} report content even when action is required`, () => {
      const block = routeBlock(`app.get("${route}"`);
      assert.match(block, /reply\.send\(success\(request, (summary|report)\)\)/);
      assert.doesNotMatch(block, /\.ok \? 200 : (409|503)/);
    });
  }
});
