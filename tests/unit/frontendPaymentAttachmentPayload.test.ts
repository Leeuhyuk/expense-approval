import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("payment request frontend attachment payload", () => {
  it("sends ready backend attachment ids when saving or submitting a payment request", () => {
    const source = readFileSync(resolve("src/main.tsx"), "utf8");

    assert.match(source, /function withPaymentAttachmentIds/, "payment request saves must decorate payloads with attachment ids");
    assert.match(source, /attachment\.status === "ready" && attachment\.remoteId/, "only completed remote uploads should be sent to the backend");
    assert.match(source, /첨부파일ID: attachmentIds\.join\(","\)/, "attachment ids must be serialized into the table payload");
    assert.match(source, /withPaymentAttachmentIds\(\{ \.\.\.buildPaymentRequestPatch\(draft, "임시 저장"/, "draft saves must include attachment ids");
    assert.match(source, /withPaymentAttachmentIds\(\{ \.\.\.buildPaymentRequestPatch\(draft, "제출"/, "submits must include attachment ids");
    assert.match(source, /function fileMutationKey/, "file upload and delete actions must build stable idempotency keys");
    assert.match(source, /idempotencyKey: `\$\{uploadKey\}:presign`/, "file presign must send an idempotency key");
    assert.match(source, /completeFileUpload\(ticket\.data\.file\.id, \{ idempotencyKey: `\$\{uploadKey\}:complete` \}\)/, "file complete must send an idempotency key");
    assert.match(source, /deleteFile\(attachment\.remoteId, \{[\s\S]*idempotencyKey: fileMutationKey\("delete", "PAYMENT_REQUEST"/, "payment attachment deletes must send idempotency keys");
    assert.match(source, /deleteFile\(document\.remoteId, \{[\s\S]*idempotencyKey: fileMutationKey\("delete", "VENDOR"/, "vendor document deletes must send idempotency keys");
  });
});
