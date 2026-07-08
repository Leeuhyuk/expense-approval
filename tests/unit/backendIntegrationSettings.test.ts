import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateIntegrationTestSetup } from "../../backend/src/routes/pageResources";

describe("backend integration settings controls", () => {
  it("requires credential reference, server secret, and HTTPS test endpoint", () => {
    assert.match(validateIntegrationTestSetup({ credentialRef: "", testEndpoint: "https://example.com/health" }, {}), /credential reference/);
    assert.match(validateIntegrationTestSetup({ credentialRef: "bad-ref", testEndpoint: "https://example.com/health" }, {}), /대문자/);
    assert.match(validateIntegrationTestSetup({ credentialRef: "ERP_TEST_TOKEN", testEndpoint: "https://example.com/health" }, {}), /secret/);
    assert.match(validateIntegrationTestSetup({ credentialRef: "ERP_TEST_TOKEN", testEndpoint: "http://example.com/health" }, { ERP_TEST_TOKEN: "secret" }), /HTTPS/);
    assert.equal(validateIntegrationTestSetup({ credentialRef: "ERP_TEST_TOKEN", testEndpoint: "https://example.com/health" }, { ERP_TEST_TOKEN: "secret" }), "");
  });
});
