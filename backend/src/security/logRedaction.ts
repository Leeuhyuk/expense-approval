const sensitiveKeyPattern = /(authorization|cookie|password|secret|signature|token|checksum|credential|csrf|bankaccount|bank_account|accountnumber|account_number|fileurl|signedurl|signed_url|계좌)/i;
const sensitiveQueryPattern = /([?&](?:token|signature|x-amz-signature|x-amz-credential|authorization|credential|secret|cookie|csrf)=)[^&\s"')]+/gi;
const sensitiveAssignmentPattern = /\b(authorization|cookie|password|secret|signature|token|checksum|credential|csrf|bankaccount|bank_account|accountnumber|account_number|fileurl|signedurl|signed_url)(\s*[:=]\s*)("?)\S+/gi;
const signedFileContentPattern = /(\/api\/files\/[^/\s?]+\/content)\?[^ \t\r\n"')]+/gi;
const dashedAccountPattern = /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,12}(?![\d-])/g;
const compactAccountPattern = /(?<![\d-])\d{10,16}(?![\d-])/g;

function truncate(value: string, maxLength = 1000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function maskSensitiveLogText(value: string) {
  return truncate(value)
    .replace(signedFileContentPattern, "$1?[redacted]")
    .replace(sensitiveQueryPattern, "$1[redacted]")
    .replace(sensitiveAssignmentPattern, "$1$2$3[redacted]")
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

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function serializeRequest(input: unknown) {
  const request = objectRecord(input);
  return {
    method: optionalString(request.method),
    url: typeof request.url === "string" ? maskSensitiveLogText(request.url) : undefined,
    hostname: optionalString(request.hostname),
    remoteAddress: optionalString(request.remoteAddress),
    remotePort: optionalNumber(request.remotePort),
    headers: sanitizeLogValue(request.headers),
  };
}

function serializeResponse(input: unknown) {
  const response = objectRecord(input);
  return {
    statusCode: optionalNumber(response.statusCode),
  };
}

function serializeError(input: unknown) {
  const error = objectRecord(input);
  return {
    type: optionalString(error.name) ?? optionalString(error.type) ?? "Error",
    code: optionalString(error.code),
    message: typeof error.message === "string" ? maskSensitiveLogText(error.message) : "Unknown error",
    stack: typeof error.stack === "string" ? maskSensitiveLogText(error.stack) : "",
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
