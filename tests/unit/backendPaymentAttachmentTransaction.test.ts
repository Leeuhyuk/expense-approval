import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function routeBlock(routeSignature: string) {
  const source = readFileSync(resolve("backend/src/routes/paymentRequests.ts"), "utf8");
  const start = source.indexOf(routeSignature);
  assert.notEqual(start, -1, `${routeSignature} route not found`);
  const nextRoute = source.indexOf("\n  app.", start + routeSignature.length);
  return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

describe("payment request attachment metadata transaction", () => {
  it("parses and validates attachment identifiers from payment request payloads", () => {
    const source = readFileSync(resolve("backend/src/routes/paymentRequests.ts"), "utf8");

    assert.match(source, /function readPaymentAttachmentIds/, "payment routes must read attachment ids explicitly");
    assert.match(source, /source\.attachmentIds/, "payment routes must support API-native attachmentIds");
    assert.match(source, /source\["첨부파일ID"\]/, "payment routes must support the Korean table payload field");
    assert.match(source, /z\.string\(\)\.uuid\(\)/, "attachment ids must be UUID validated");
  });

  it("links submitted attachment metadata before submit readiness checks in create and update transactions", () => {
    for (const routeSignature of ['app.post("/payment-requests"', 'app.patch("/payment-requests/:requestCode"']) {
      const block = routeBlock(routeSignature);
      const transactionIndex = block.indexOf("prisma.$transaction");
      const linkIndex = block.indexOf("await linkPaymentAttachments(tx, item, user.id, attachmentIds)");
      const submitReadyIndex = block.indexOf("await assertSubmitReady(tx, item)");
      const auditIndex = block.indexOf("toPaymentRequestAuditValue(item, attachmentIds, linkedAttachmentCount)");

      assert.notEqual(transactionIndex, -1, `${routeSignature} must keep the payment mutation in a transaction`);
      assert.notEqual(linkIndex, -1, `${routeSignature} must link attachments with the transaction client`);
      assert.notEqual(submitReadyIndex, -1, `${routeSignature} must still perform submit readiness checks`);
      assert.ok(transactionIndex < linkIndex, `${routeSignature} must link attachments inside the transaction`);
      assert.ok(linkIndex < submitReadyIndex, `${routeSignature} must link attachments before checking submit readiness`);
      assert.notEqual(auditIndex, -1, `${routeSignature} must include linked attachment ids in the audit snapshot`);
    }
  });

  it("prevents unrelated or unsafe attachment metadata from being linked to a payment request", () => {
    const source = readFileSync(resolve("backend/src/routes/paymentRequests.ts"), "utf8");

    assert.match(source, /uploadedBy: userId/, "only files uploaded by the requester should be attachable");
    assert.match(source, /checksum === "pending"/, "pending uploads must not be attached");
    assert.match(source, /checksum\.startsWith\("blocked:"\)/, "blocked uploads must not be attached");
    assert.match(source, /attachment\.ownerId !== item\.id/, "attachments from another request must not be attached");
  });
});
