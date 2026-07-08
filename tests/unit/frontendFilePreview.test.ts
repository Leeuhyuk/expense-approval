import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend file preview controls", () => {
  it("requests inline signed URLs for payment and vendor attachment previews", () => {
    const source = readFileSync(resolve("src/main.tsx"), "utf8");
    assert.match(source, /import \{ canPreviewAttachment, formatFileSize, prepareAttachmentDrafts \} from "\.\/domain\/fileRules"/, "main screen must use shared preview eligibility policy");
    assert.match(source, /const previewAttachment = async \(attachment: AttachmentDraft\)/, "payment attachments need a preview action");
    assert.match(source, /reason: `결제 요청 \$\{requestId\} 증빙 미리보기`,\s*disposition: "inline"/, "payment preview must request an inline signed URL with an audit reason");
    assert.match(source, /const previewVendorDocument = async \(vendorDocument: VendorDocument\)/, "vendor documents need a preview action");
    assert.match(source, /reason: `거래처 \$\{selectedVendorKey \|\| "선택 거래처"\} \$\{vendorDocument\.category\} 증빙 미리보기`,\s*disposition: "inline"/, "vendor preview must request an inline signed URL with an audit reason");
    assert.match(source, /triggerUrlPreview\(ticket\.data\.download\.url\)/, "preview action must open the signed URL rather than downloading a local blob");
    assert.match(source, /ticket\.data\.download\.expiresAt\.slice\(0, 16\)/, "preview feedback must expose signed URL expiry to the user");
    assert.match(source, /<Eye size=\{16\} \/>/, "payment preview button must be visible as an icon control");
    assert.match(source, /<Eye size=\{14\} \/>/, "vendor preview button must be visible as an icon control");
  });
});