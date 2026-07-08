const sensitiveKeyPattern = /(authorization|cookie|password|secret|signature|token|checksum|credential|csrf|bankaccount|bank_account|accountnumber|account_number|fileurl|signedurl|signed_url|계좌)/i;
const sensitiveQueryPattern = /([?&](?:token|signature|x-amz-signature|x-amz-credential|authorization|credential|secret|cookie|csrf)=)[^&\s"')]+/gi;
const signedFileContentPattern = /(\/api\/files\/[^/\s?]+\/content)\?[^ \t\r\n"')]+/gi;
const dashedAccountPattern = /\b\d{2,6}-\d{2,6}-\d{2,12}\b/g;
const compactAccountPattern = /\b\d{10,16}\b/g;

function truncate(value: string, maxLength = 1000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function maskSensitiveLogText(value: string) {
  return truncate(value)
    .replace(signedFileContentPattern, "$1?[redacted]")
    .replace(sensitiveQueryPattern, "$1[redacted]")
    .replace(dashedAccountPattern, "[redacted-account]")
    .replace(compactAccountPattern, "[redacted-account]");
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskSensitiveLogText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth >= 4 ? "[truncated]" : value.slice(0, 30).map((item) => sanitizeLogValue(item, depth + 1));
  if (typeof value !== "object") return maskSensitiveLogText(String(value));
  if (depth >= 4) return "[truncated]";

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    result[key] = sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeLogValue(item, depth + 1);
  }
  return result;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function serializeRequest(input: unknown) {
  const request = objectRecord(input);
  return {
    method: request.method,
    url: typeof request.url === "string" ? maskSensitiveLogText(request.url) : request.url,
    hostname: request.hostname,
    remoteAddress: request.remoteAddress,
    remotePort: request.remotePort,
    headers: sanitizeLogValue(request.headers),
  };
}

function serializeResponse(input: unknown) {
  const response = objectRecord(input);
  return {
    statusCode: response.statusCode,
  };
}

function serializeError(input: unknown) {
  const error = objectRecord(input);
  return {
    type: error.name ?? error.type,
    code: error.code,
    message: typeof error.message === "string" ? maskSensitiveLogText(error.message) : error.message,
    stack: typeof error.stack === "string" ? maskSensitiveLogText(error.stack) : error.stack,
  };
}

export function createSafeLoggerOptions() {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      censor: "[redacted]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-csrf-token']",
        "req.headers['set-cookie']",
        "request.headers.authorization",
        "request.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "headers['x-csrf-token']",
        "cookies",
        "*.password",
        "*.secret",
        "*.token",
        "*.authorization",
        "*.credential",
        "*.checksum",
        "*.bankAccount",
        "*.bankAccountEncrypted",
        "*.accountNumber",
        "*.signedUrl",
        "*.fileUrl",
      ],
    },
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
      err: serializeError,
    },
  };
}
