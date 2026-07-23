import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { recordFailureSecurityEvent } from "../security/securityEvents.js";
import { fail } from "../utils/response.js";

const csrfCookieName = "erp_csrf";
const csrfHeaderName = "x-csrf-token";
const defaultCsrfSecret = "dev-csrf-secret-change-in-production";

function csrfSecret() {
  return process.env.CSRF_SECRET || process.env.FILE_URL_SECRET || defaultCsrfSecret;
}

function signToken(nonce: string) {
  return createHmac("sha256", csrfSecret()).update(nonce).digest("base64url");
}

function createSignedToken() {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signToken(nonce)}`;
}

function isValidSignedToken(token: string | undefined) {
  if (!token) return false;
  const [nonce, signature] = token.split(".");
  if (!nonce || !signature) return false;
  const expected = signToken(nonce);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function getHeaderToken(request: FastifyRequest) {
  const value = request.headers[csrfHeaderName];
  return Array.isArray(value) ? value[0] : value;
}

export function getCsrfCookieOptions() {
  return {
    httpOnly: false,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function isProtectedMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isCsrfExempt(request: FastifyRequest) {
  const path = request.url.split("?")[0] ?? "";
  if (request.method.toUpperCase() === "POST" && path === "/api/auth/login") return true;
  if (request.method.toUpperCase() === "PUT" && /^\/api\/files\/[^/]+\/content$/.test(path)) return true;
  return false;
}

export function issueCsrfCookie(reply: FastifyReply) {
  const token = createSignedToken();
  reply.setCookie(csrfCookieName, token, getCsrfCookieOptions());
}

export function clearCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(csrfCookieName, { path: "/" });
}

export function enforceCsrfProtection(request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) {
  if (!isProtectedMethod(request.method) || isCsrfExempt(request)) {
    done();
    return;
  }

  const cookieToken = request.cookies[csrfCookieName];
  const headerToken = getHeaderToken(request);
  if (!cookieToken || !headerToken || cookieToken !== headerToken || !isValidSignedToken(cookieToken)) {
    void recordFailureSecurityEvent({
      request,
      errorCode: "CSRF_TOKEN_INVALID",
      message: "요청 보안 토큰이 유효하지 않습니다.",
      statusCode: 403,
      metadata: {
        hasCookieToken: Boolean(cookieToken),
        hasHeaderToken: Boolean(headerToken),
        tokenMatched: Boolean(cookieToken && headerToken && cookieToken === headerToken),
      },
    });
    fail(reply, "CSRF_TOKEN_INVALID", "요청 보안 토큰이 유효하지 않습니다.", 403);
    return;
  }

  done();
}
