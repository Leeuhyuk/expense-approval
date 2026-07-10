import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../../src/main.tsx", import.meta.url), "utf8");

test("server-synced vendor documents replace transient copies with the same file fingerprint", () => {
  assert.match(
    mainSource,
    /function mergeSyncedVendorDocuments\([\s\S]*syncedFingerprints[\s\S]*!syncedFingerprints\.has\(fingerprint\)/,
  );
});
test("completed vendor uploads replace local and server-synced copies of the same file", () => {
  assert.match(
    mainSource,
    /function mergeCompletedVendorUploads\([\s\S]*uploadedRemoteIds[\s\S]*uploadingIds\.has\(document\.id\)[\s\S]*!uploadedRemoteIds\.has\(remoteId\)/,
  );
  assert.match(
    mainSource,
    /\[vendorName\]: mergeCompletedVendorUploads\(uploadedDocuments, current\[vendorName\] \?\? \[\], uploadingIds\)/,
  );
});