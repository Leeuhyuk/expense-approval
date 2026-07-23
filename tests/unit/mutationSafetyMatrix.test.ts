import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const matrix = read("docs/mutation-safety-matrix.md");
const filesRoute = read("backend/src/routes/files.ts");
const main = read("src/main.tsx");

describe("mutation safety matrix", () => {
  it("documents standard controls and approved exception routes", () => {
    const requiredSnippets = [
      "POST /files/presign-upload",
      "POST /files/complete",
      "DELETE /files/{id}",
      "PUT /files/{id}/content",
      "PATCH /notifications/{id}/read",
      "POST /notifications/read-all",
      "POST /auth/login",
      "/auth/logout",
      "/auth/refresh",
      "POST /operations/business-failure-alerts/notify",
      "PATCH /settings/config/{key}",
      "staging DB",
    ];

    for (const snippet of requiredSnippets) {
      assert.ok(matrix.includes(snippet), `mutation safety matrix must mention ${snippet}`);
    }
  });

  it("keeps file metadata mutations wired to stable idempotency keys", () => {
    assert.match(filesRoute, /presignUploadSchema[\s\S]*idempotencyKey/, "file presign schema must accept idempotency keys");
    assert.match(filesRoute, /completeSchema[\s\S]*idempotencyKey/, "file complete schema must accept idempotency keys");
    assert.match(filesRoute, /readStringValue\(bodyRecord\(request\.body\), "idempotencyKey"\)/, "file delete route must read idempotency keys from request bodies");
    assert.match(filesRoute, /IDEMPOTENCY_CONFLICT/, "file routes must reject key reuse from conflicting operations");
    assert.match(filesRoute, /idempotencyReplay: true/, "file routes must replay duplicate safe requests");

    assert.match(main, /function fileMutationKey/, "frontend must build stable file mutation keys");
    assert.match(main, /idempotencyKey: `\$\{uploadKey\}:presign`/, "frontend presign calls must send idempotency keys");
    assert.match(main, /completeFileUpload\(ticket\.data\.file\.id, \{ idempotencyKey: `\$\{uploadKey\}:complete` \}\)/, "frontend complete calls must send idempotency keys");
    assert.match(main, /deleteFile\(attachment\.remoteId, \{[\s\S]*fileMutationKey\("delete", "PAYMENT_REQUEST"/, "payment attachment delete must send idempotency keys");
    assert.match(main, /deleteFile\(document\.remoteId, \{[\s\S]*fileMutationKey\("delete", "VENDOR"/, "vendor document delete must send idempotency keys");
  });
});
