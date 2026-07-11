import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const routeFiles = [
  "backend/src/routes/approvals.ts",
  "backend/src/routes/disbursements.ts",
  "backend/src/routes/paymentRequests.ts",
  "backend/src/routes/pageResources.ts",
];

describe("internal action forwarding", () => {
  it("drops stale body framing headers before transformed requests are injected", () => {
    const rowUtils = readFileSync(resolve("backend/src/routes/rowUtils.ts"), "utf8");
    assert.match(rowUtils, /function forwardedInjectHeaders/);
    assert.match(rowUtils, /key\.toLowerCase\(\) === "content-length"/);
    assert.match(rowUtils, /key\.toLowerCase\(\) === "transfer-encoding"/);

    for (const routeFile of routeFiles) {
      const source = readFileSync(resolve(routeFile), "utf8");
      assert.doesNotMatch(source, /headers: request\.headers as Record<string, string>/, `${routeFile} must not forward a stale content-length`);
      assert.match(source, /headers: forwardedInjectHeaders\(request\.headers\)/, `${routeFile} must sanitize forwarded headers`);
    }
  });
});
