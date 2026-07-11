import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { isUuidIdentifier, makeSignedPath, signedUrlTtlMs, verifyToken } from "../../backend/src/routes/files";
import { attachmentScanStatus, maxAttachmentBytes, validateAttachmentUploadPolicy } from "../../backend/src/security/attachmentPolicy";
import { scanAttachmentBuffer } from "../../backend/src/security/malwareScan";
import { deleteStoredFile, readStoredFile, storedByteSize, storageKeyFor, writeStoredFile } from "../../backend/src/storage/attachmentStorage";

describe("backend file storage and scanning", () => {
  it("distinguishes UUID owner ids from request codes and vendor names", () => {
    assert.equal(isUuidIdentifier("80000000-0000-4000-8000-000000000001"), true);
    assert.equal(isUuidIdentifier("PR-2026-0058"), false);
    assert.equal(isUuidIdentifier("이노베이션(주)"), false);

    const routeSource = readFileSync(resolve("backend/src/routes/files.ts"), "utf8");
    assert.match(routeSource, /where: isUuidIdentifier\(ownerId\)/);
  });

  it("enforces extension, content-type, size, and quarantine status policy", () => {
    assert.equal(validateAttachmentUploadPolicy({ fileName: "invoice.pdf", contentType: "application/pdf", byteSize: 1024 }), "");
    assert.equal(validateAttachmentUploadPolicy({ fileName: "receipt.JPG", contentType: "image/jpeg", byteSize: 1024 }), "");
    assert.match(
      validateAttachmentUploadPolicy({ fileName: "invoice.pdf", contentType: "application/octet-stream", byteSize: 1024 }),
      /Content-Type/,
    );
    assert.match(validateAttachmentUploadPolicy({ fileName: "malware.exe", contentType: "application/pdf", byteSize: 1024 }), /허용되지 않는 파일 형식/);
    assert.match(
      validateAttachmentUploadPolicy({ fileName: "huge.pdf", contentType: "application/pdf", byteSize: maxAttachmentBytes + 1 }),
      /최대 10MB/,
    );
    assert.equal(attachmentScanStatus("pending"), "pending");
    assert.equal(attachmentScanStatus("blocked:scan-hash"), "blocked");
    assert.equal(attachmentScanStatus("clean-hash"), "clean");
  });

  it("stores, reads, sizes, and deletes local attachment objects", async () => {
    const previousDriver = process.env.FILE_STORAGE_DRIVER;
    const previousDir = process.env.FILE_STORAGE_DIR;
    const storageDir = await mkdtemp(join(tmpdir(), "erp-file-storage-"));
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_DIR = storageDir;

    try {
      const storageKey = storageKeyFor("80000000-0000-4000-8000-000000000001", "invoice.pdf");
      const body = Buffer.from("invoice evidence");
      const stored = await writeStoredFile(storageKey, body, "application/pdf");

      assert.equal(stored.byteSize, body.length);
      assert.equal(await storedByteSize(storageKey), body.length);
      assert.equal((await readStoredFile(storageKey)).toString(), "invoice evidence");

      await deleteStoredFile(storageKey);
      assert.equal(await storedByteSize(storageKey), 0);
    } finally {
      if (previousDriver === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = previousDriver;
      if (previousDir === undefined) delete process.env.FILE_STORAGE_DIR;
      else process.env.FILE_STORAGE_DIR = previousDir;
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  it("blocks EICAR test content in local scan mode", async () => {
    const previousMode = process.env.FILE_SCAN_MODE;
    process.env.FILE_SCAN_MODE = "local";
    try {
      const result = await scanAttachmentBuffer(
        Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!"),
        "eicar.txt",
        "text/plain",
      );
      assert.equal(result.status, "blocked");
    } finally {
      if (previousMode === undefined) delete process.env.FILE_SCAN_MODE;
      else process.env.FILE_SCAN_MODE = previousMode;
    }
  });

  it("issues short-lived API signed paths and rejects wrong-purpose or expired tokens", () => {
    const previousSecret = process.env.FILE_URL_SECRET;
    process.env.FILE_URL_SECRET = "unit-test-file-url-secret-000000000000";
    const fileId = "80000000-0000-4000-8000-000000000002";
    const originalNow = Date.now;

    try {
      const upload = makeSignedPath(fileId, "upload");
      const uploadUrl = new URL(upload.url, "https://erp.example.com");
      const uploadToken = uploadUrl.searchParams.get("token");
      const uploadExpiresAt = new Date(upload.expiresAt).getTime();

      assert.equal(uploadUrl.pathname, `/api/files/${fileId}/content`);
      assert.equal(uploadUrl.searchParams.has("download"), false);
      assert.ok(uploadToken, "upload signed path must carry a token");
      assert.ok(uploadExpiresAt - originalNow() <= signedUrlTtlMs);
      assert.ok(uploadExpiresAt - originalNow() > signedUrlTtlMs - 2_000);
      assert.equal(verifyToken(fileId, "upload", uploadToken), true);
      assert.equal(verifyToken(fileId, "download", uploadToken), false);
      assert.equal(verifyToken("80000000-0000-4000-8000-000000000999", "upload", uploadToken), false);

      Date.now = () => uploadExpiresAt + 1;
      assert.equal(verifyToken(fileId, "upload", uploadToken), false);

      Date.now = originalNow;
      const download = makeSignedPath(fileId, "download");
      const downloadUrl = new URL(download.url, "https://erp.example.com");
      const downloadToken = downloadUrl.searchParams.get("token");
      assert.equal(downloadUrl.pathname, `/api/files/${fileId}/content`);
      assert.equal(downloadUrl.searchParams.get("download"), "1");
      assert.ok(downloadToken, "download signed path must carry a token");
      assert.equal(verifyToken(fileId, "download", downloadToken), true);

      const preview = makeSignedPath(fileId, "download", "inline");
      const previewUrl = new URL(preview.url, "https://erp.example.com");
      const previewToken = previewUrl.searchParams.get("token");
      assert.equal(previewUrl.pathname, `/api/files/${fileId}/content`);
      assert.equal(previewUrl.searchParams.get("preview"), "1");
      assert.equal(previewUrl.searchParams.has("download"), false);
      assert.ok(previewToken, "preview signed path must carry a token");
      assert.equal(verifyToken(fileId, "download", previewToken), true);
      assert.equal(verifyToken(fileId, "upload", downloadToken), false);
      assert.doesNotMatch(upload.url + download.url, /S3|s3\.|amazonaws|storage\.googleapis|blob\.core/i);
    } finally {
      Date.now = originalNow;
      if (previousSecret === undefined) delete process.env.FILE_URL_SECRET;
      else process.env.FILE_URL_SECRET = previousSecret;
    }
  });

  it("keeps route metadata changes tied to storage object lifecycle", () => {
    const routeSource = readFileSync(resolve("backend/src/routes/files.ts"), "utf8");
    const presignBlock = routeSource.slice(routeSource.indexOf('app.post("/files/presign-upload"'), routeSource.indexOf('app.put("/files/:id/content"'));
    const uploadBlock = routeSource.slice(routeSource.indexOf('app.put("/files/:id/content"'), routeSource.indexOf('app.post("/files/complete"'));
    const completeBlock = routeSource.slice(routeSource.indexOf('app.post("/files/complete"'), routeSource.indexOf('app.get("/files"'));
    const deleteBlock = routeSource.slice(routeSource.indexOf('app.delete("/files/:id"'));

    assert.match(presignBlock, /prisma\.\$transaction/, "presign must create DB metadata and audit in one transaction");
    assert.match(presignBlock, /validateAttachmentUploadPolicy\(input\.data\)/, "presign must enforce extension, Content-Type, and declared size policy before metadata is created");
    assert.match(presignBlock, /canWriteAttachment\(user, owner\)/, "presign must verify per-owner write permission before issuing an upload URL");
    assert.match(presignBlock, /storageKeyFor\(fileId, input\.data\.fileName\)/, "presign must derive the object key from the attachment id");
    assert.match(presignBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "presign must replay or reject duplicate idempotency keys");
    assert.match(presignBlock, /idempotencyKey,\s*[\s\S]*\.\.\.auditRequestContext\(request\)/, "presign audit must persist idempotency keys");
    assert.match(uploadBlock, /writeStoredFile\(item\.storageKey, body, item\.contentType\)/, "signed upload must write the object by DB storageKey");
    assert.match(uploadBlock, /verifyToken\(params\.id, "upload", query\.token\)[\s\S]*writeStoredFile\(item\.storageKey, body, item\.contentType\)/, "signed upload must reject direct content writes without a valid upload token");
    assert.match(uploadBlock, /isAllowedAttachmentContentType\(item\.fileName, uploadContentType\)/, "signed upload must reject Content-Type changes after presign");
    assert.match(uploadBlock, /action: "scan_blocked"/, "blocked malware scans must leave an audit marker");
    assert.match(uploadBlock, /checksum: blockedChecksum\(scanResult\.reason, body\)/, "blocked malware scans must quarantine metadata with a blocked checksum marker");
    assert.match(uploadBlock, /checksum: stored\.checksum/, "signed upload must persist the storage checksum to Attachment metadata");
    assert.match(uploadBlock, /await deleteStoredFile\(item\.storageKey\)/, "oversized signed uploads must clean up the rejected storage object");
    assert.match(completeBlock, /storedByteSize\(item\.storageKey\)/, "complete must reconcile DB byteSize from the stored object");
    assert.match(completeBlock, /action: "complete_upload"/, "complete must audit the metadata reconciliation");
    assert.match(completeBlock, /findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "complete must replay or reject duplicate idempotency keys");
    assert.match(completeBlock, /idempotencyKey,\s*[\s\S]*\.\.\.auditRequestContext\(request\)/, "complete audit must persist idempotency keys");
    assert.match(deleteBlock, /tx\.attachment\.delete\(\{ where: \{ id: item\.id \} \}\)/, "delete must remove Attachment metadata");
    assert.match(deleteBlock, /deleteStoredFile\(item\.storageKey\)/, "delete must remove the storage object for the deleted metadata");
    assert.match(deleteBlock, /readStringValue\(bodyRecord\(request\.body\), "idempotencyKey"\)/, "delete must read idempotency keys");
    assert.match(deleteBlock, /idempotencyKey: idempotencyKey \|\| undefined/, "delete audit must persist idempotency keys when provided");
  });

  it("keeps downloads behind permission-checked API signed paths instead of public storage URLs", () => {
    const routeSource = readFileSync(resolve("backend/src/routes/files.ts"), "utf8");
    const storageSource = readFileSync(resolve("backend/src/storage/attachmentStorage.ts"), "utf8");
    const dtoBlock = routeSource.slice(routeSource.indexOf("function toFileDto"), routeSource.indexOf("function failFileSecurity"));
    const issueDownloadBlock = routeSource.slice(routeSource.indexOf('app.get("/files/:id/download"'), routeSource.indexOf('app.get("/files/:id/content"'));
    const contentDownloadBlock = routeSource.slice(routeSource.indexOf('app.get("/files/:id/content"'), routeSource.indexOf('app.delete("/files/:id"'));

    assert.doesNotMatch(dtoBlock, /publicUrl|downloadUrl|storageUrl|S3_ENDPOINT|FILE_STORAGE_ENDPOINT/, "file DTOs must not expose direct object storage URLs");
    assert.match(issueDownloadBlock, /requireAuth\(/, "download URL issuance must authenticate the caller");
    assert.match(issueDownloadBlock, /canReadAttachment\(user, item\)/, "download URL issuance must verify per-file read permission");
    assert.match(issueDownloadBlock, /downloadQuerySchema\.safeParse\(request\.query\)/, "download URL issuance must require a business reason");
    assert.match(issueDownloadBlock, /disposition: input\.data\.disposition/, "download access audits must preserve attachment vs inline preview disposition");
    assert.match(issueDownloadBlock, /action: "download_request"/, "download URL issuance must audit access before issuing a signed path");
    assert.match(issueDownloadBlock, /reason: input\.data\.reason/, "download access audits must preserve the user-provided reason");
    assert.match(issueDownloadBlock, /const download = makeSignedPath\(item\.id, "download", input\.data\.disposition\)/, "download route must issue an API signed path");
    assert.doesNotMatch(issueDownloadBlock, /readStoredFile|s3Url|S3_ENDPOINT|FILE_STORAGE_ENDPOINT/, "download URL issuance must not read storage or expose direct object storage details");
    assert.match(contentDownloadBlock, /verifyToken\(params\.id, "download", query\.token\)[\s\S]*readStoredFile\(item\.storageKey\)/, "content download must require a valid download token before reading storage");
    assert.match(contentDownloadBlock, /attachmentScanStatus\(item\.checksum\) === "blocked"/, "content download must reject quarantined files");
    assert.match(contentDownloadBlock, /query\.preview === "1" && canPreviewAttachmentFile\(item\.fileName\) \? "inline" : "attachment"/, "content download must support inline preview disposition only for previewable files");
    assert.match(storageSource, /Authorization: `AWS4-HMAC-SHA256 Credential=/, "S3 access must be server-side signed with Authorization headers");
    assert.doesNotMatch(storageSource, /X-Amz-Signature|publicUrl|signedUrl|presignedUrl/, "storage adapter must not generate public or presigned direct object URLs");
  });
});
