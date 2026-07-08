import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPreviewAttachment,
  classifyAttachmentFile,
  formatFileSize,
  maxAttachmentBytes,
  prepareAttachmentDrafts,
  shouldVirusScanAttachment,
  validateAttachmentFile,
} from "../../src/domain/fileRules";

function fileLike(name: string, size: number) {
  return { name, size, lastModified: 1 } as File;
}

describe("file rules", () => {
  it("accepts configured evidence file extensions", () => {
    assert.equal(validateAttachmentFile(fileLike("invoice.pdf", 1024)), "");
    assert.equal(validateAttachmentFile(fileLike("receipt.JPG", 1024)), "");
    assert.equal(validateAttachmentFile(fileLike("statement.xlsx", 1024)), "");
  });

  it("rejects blocked extensions and files over 10MB", () => {
    assert.match(validateAttachmentFile(fileLike("malware.exe", 1024)), /허용되지 않는 파일 형식/);
    assert.match(validateAttachmentFile(fileLike("huge.pdf", maxAttachmentBytes + 1)), /최대 10MB/);
  });

  it("separates accepted and rejected draft attachments", () => {
    const result = prepareAttachmentDrafts([fileLike("ok.pdf", 2048), fileLike("blocked.bat", 128)]);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.accepted[0].fileName, "ok.pdf");
    assert.equal(result.rejected.length, 1);
  });

  it("formats file sizes for UI display", () => {
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(2048), "2 KB");
    assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
  });

  it("defines scan, preview, and tax invoice attachment policies", () => {
    assert.equal(shouldVirusScanAttachment("invoice.pdf"), true);
    assert.equal(shouldVirusScanAttachment("blocked.exe"), false);
    assert.equal(canPreviewAttachment("invoice.pdf"), true);
    assert.equal(canPreviewAttachment("receipt.JPG"), true);
    assert.equal(canPreviewAttachment("statement.png"), true);
    assert.equal(canPreviewAttachment("statement.xlsx"), false);
    assert.equal(classifyAttachmentFile("세금계산서_클라우드존.pdf"), "tax-invoice");
    assert.equal(classifyAttachmentFile("contract_vendor.pdf"), "contract");
  });
});
