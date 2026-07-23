import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

export type StorageWriteResult = {
  checksum: string;
  byteSize: number;
};

type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function storageRoot() {
  return resolve(process.env.FILE_STORAGE_DIR ?? join(process.cwd(), ".local-file-storage"));
}

export function activeStorageDriver() {
  return (process.env.FILE_STORAGE_DRIVER ?? "local").trim().toLowerCase();
}

export function isObjectStorageDriver() {
  return ["s3", "object-storage", "object_storage"].includes(activeStorageDriver());
}

function extensionOf(fileName: string) {
  return extname(fileName).toLowerCase();
}

export function storageKeyFor(fileId: string, fileName: string) {
  const extension = extensionOf(fileName) || ".bin";
  return `attachments/${fileId}${extension}`;
}

function localStoragePath(storageKey: string) {
  const root = storageRoot();
  const path = resolve(root, storageKey);
  if (!path.startsWith(root)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return path;
}

function normalizeBody(body: unknown) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from([]);
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function s3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT ?? process.env.FILE_STORAGE_ENDPOINT ?? "";
  const bucket = process.env.S3_BUCKET ?? process.env.FILE_STORAGE_BUCKET ?? "";
  const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";
  const sessionToken = process.env.S3_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3_STORAGE_CONFIG_MISSING");
  }

  return { endpoint, bucket, region, accessKeyId, secretAccessKey, sessionToken };
}

function encodePath(value: string) {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function s3Url(config: S3Config, storageKey = "") {
  const base = new URL(config.endpoint.endsWith("/") ? config.endpoint : `${config.endpoint}/`);
  const rootPath = base.pathname.replace(/\/$/, "");
  const bucketPath = encodeURIComponent(config.bucket);
  const keyPath = encodePath(storageKey);
  base.pathname = `${rootPath}/${bucketPath}${keyPath ? `/${keyPath}` : ""}`;
  return base;
}

function amzTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function amzDate(date: Date) {
  return amzTimestamp(date).slice(0, 8);
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secretAccessKey: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function signedS3Headers(method: string, url: URL, config: S3Config, payloadHash: string, contentType?: string) {
  const now = new Date();
  const date = amzDate(now);
  const timestamp = amzTimestamp(now);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
  };
  if (contentType) headers["content-type"] = contentType;
  if (config.sessionToken) headers["x-amz-security-token"] = config.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}`).join("\n");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, date, config.region)).update(stringToSign).digest("hex");

  const fetchHeaders: Record<string, string> = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
  };
  if (contentType) fetchHeaders["Content-Type"] = contentType;
  if (config.sessionToken) fetchHeaders["x-amz-security-token"] = config.sessionToken;
  return fetchHeaders;
}

async function s3Request(method: string, storageKey = "", body?: Buffer, contentType?: string) {
  const config = s3Config();
  const url = s3Url(config, storageKey);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const response = await fetch(url, {
    method,
    headers: signedS3Headers(method, url, config, payloadHash, contentType),
    body: method === "PUT" ? new Uint8Array(payload) : undefined,
  });

  if (!response.ok) {
    throw new Error(`S3_${method}_FAILED:${response.status}`);
  }
  return response;
}

export async function writeStoredFile(storageKey: string, body: unknown, contentType = "application/octet-stream"): Promise<StorageWriteResult> {
  const buffer = normalizeBody(body);
  if (isObjectStorageDriver()) {
    await s3Request("PUT", storageKey, buffer, contentType);
  } else {
    await mkdir(resolve(storageRoot(), "attachments"), { recursive: true });
    await writeFile(localStoragePath(storageKey), buffer);
  }
  return {
    checksum: sha256Hex(buffer),
    byteSize: buffer.length,
  };
}

export async function readStoredFile(storageKey: string) {
  if (isObjectStorageDriver()) {
    const response = await s3Request("GET", storageKey);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(localStoragePath(storageKey));
}

export async function storedByteSize(storageKey: string) {
  try {
    if (isObjectStorageDriver()) {
      const response = await s3Request("HEAD", storageKey);
      return Number(response.headers.get("content-length") ?? 0);
    }
    return (await stat(localStoragePath(storageKey))).size;
  } catch {
    return 0;
  }
}

export async function deleteStoredFile(storageKey: string) {
  if (isObjectStorageDriver()) {
    try {
      await s3Request("DELETE", storageKey);
    } catch (error) {
      if (!String(error).includes("S3_DELETE_FAILED:404")) throw error;
    }
    return;
  }
  await unlink(localStoragePath(storageKey));
}

export async function checkStorageHealth() {
  const startedAt = Date.now();
  if (isObjectStorageDriver()) {
    await s3Request("HEAD");
    return {
      ok: true,
      driver: "s3",
      bucket: s3Config().bucket,
      latencyMs: Date.now() - startedAt,
    };
  }

  await mkdir(resolve(storageRoot(), "attachments"), { recursive: true });
  return {
    ok: true,
    driver: "local",
    root: storageRoot(),
    latencyMs: Date.now() - startedAt,
  };
}
