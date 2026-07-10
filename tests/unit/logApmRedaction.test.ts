import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createSafeLoggerOptions, sanitizeLogValue } from "../../backend/src/security/logRedaction";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("log and APM redaction release gate", () => {
  it("redacts sensitive values from telemetry-shaped payloads before export", () => {
    const tracePayload = {
      traceId: "trace-001",
      spanId: "span-001",
      name: "GET /api/files/:id/content",
      attributes: {
        "http.url": "/api/files/20000000-0000-4000-8000-000000000001/content?download=1&token=signed-token",
        "http.request.header.cookie": "erp_session=session-secret; erp_csrf=csrf-secret",
        authorization: "Bearer secret-token",
        accountNumber: "110-555-777777",
        checksum: "raw-checksum",
        note: "payer account 123456789012 and url /api/files/20000000-0000-4000-8000-000000000001/content?token=secret",
      },
      events: [
        {
          name: "exception",
          attributes: {
            stack: "Error: failed for account 110-555-777777 with token=secret",
            fileUrl: "https://storage.example.com/private/file.pdf?signature=raw-signature",
          },
        },
      ],
    };

    const sanitized = sanitizeLogValue(tracePayload) as typeof tracePayload;
    const attributes = sanitized.attributes;
    const eventAttributes = sanitized.events[0].attributes;

    assert.equal(attributes["http.url"], "/api/files/20000000-0000-4000-8000-000000000001/content?[redacted]");
    assert.equal(attributes["http.request.header.cookie"], "[redacted]");
    assert.equal(attributes.authorization, "[redacted]");
    assert.equal(attributes.accountNumber, "[redacted]");
    assert.equal(attributes.checksum, "[redacted]");
    assert.equal(attributes.note, "payer account [redacted-account] and url /api/files/20000000-0000-4000-8000-000000000001/content?[redacted]");
    assert.equal(eventAttributes.stack, "Error: failed for account [redacted-account] with token=[redacted]");
    assert.equal(eventAttributes.fileUrl, "[redacted]");
  });

  it("keeps logger, release script, docs, and checklist wired to the same redaction gate", () => {
    const packageJson = read("package.json");
    const deploymentOperations = read("docs/deployment-operations.md");
    const adminManual = read("docs/admin-manual.md");
    const checklist = read("erp-system-checklist.md");
    const manifest = read("scripts/generate-release-manifest.mjs");
    const loggerOptions = createSafeLoggerOptions();

    assert.match(packageJson, /"release:log-apm-redaction": "tsx --test tests\/unit\/logApmRedaction\.test\.ts"/);
    assert.match(deploymentOperations, /release:log-apm-redaction/);
    assert.match(adminManual, /release:log-apm-redaction/);
    assert.match(checklist, /\[x\] P1: 운영 로그와 APM trace/);
    assert.match(manifest, /tests\/unit\/logApmRedaction\.test\.ts/);
    assert.match(JSON.stringify(loggerOptions.redact.paths), /authorization/);
    assert.match(JSON.stringify(loggerOptions.redact.paths), /signedUrl/);
  });
});
