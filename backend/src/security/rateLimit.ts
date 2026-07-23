import type { FastifyReply, FastifyRequest } from "fastify";
import { recordFailureSecurityEvent } from "./securityEvents.js";
import { fail } from "../utils/response.js";

export type RateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  maxKeys: number;
};

type Bucket = {
  windowStart: number;
  count: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const defaultBodyLimitBytes = 11 * 1024 * 1024;
const defaultWindowMs = 60 * 1000;
const defaultMaxRequests = 600;
const defaultMaxKeys = 10_000;

function numberFromEnv(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function booleanFromEnv(name: string, fallback: boolean) {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function apiBodyLimitBytes() {
  return numberFromEnv("API_BODY_LIMIT_BYTES", defaultBodyLimitBytes, 1024 * 1024);
}

export function rateLimitConfigFromEnv(): RateLimitConfig {
  return {
    enabled: !booleanFromEnv("RATE_LIMIT_DISABLED", false),
    windowMs: numberFromEnv("RATE_LIMIT_WINDOW_MS", defaultWindowMs, 1000),
    maxRequests: numberFromEnv("RATE_LIMIT_MAX", defaultMaxRequests, 1),
    maxKeys: numberFromEnv("RATE_LIMIT_MAX_KEYS", defaultMaxKeys, 100),
  };
}

export function createFixedWindowRateLimiter(config: RateLimitConfig) {
  const buckets = new Map<string, Bucket>();

  function cleanup(now: number) {
    if (buckets.size <= config.maxKeys) return;
    for (const [key, bucket] of buckets.entries()) {
      if (now - bucket.windowStart >= config.windowMs) buckets.delete(key);
      if (buckets.size <= config.maxKeys) break;
    }
  }

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      if (!config.enabled) {
        return { allowed: true, limit: config.maxRequests, remaining: config.maxRequests, retryAfterSeconds: 0 };
      }

      const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
      const bucket = buckets.get(key);
      const current = bucket && bucket.windowStart === windowStart ? bucket : { windowStart, count: 0 };
      current.count += 1;
      buckets.set(key, current);
      cleanup(now);

      const remaining = Math.max(0, config.maxRequests - current.count);
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + config.windowMs - now) / 1000));
      return {
        allowed: current.count <= config.maxRequests,
        limit: config.maxRequests,
        remaining,
        retryAfterSeconds,
      };
    },
  };
}

export function isRateLimitExempt(method: string, url: string) {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "OPTIONS") return true;
  const path = url.split("?")[0] ?? "";
  return path === "/api/health" || path.startsWith("/api/health/");
}

function clientKey(request: FastifyRequest) {
  return request.ip || "unknown";
}

export function createRateLimitHook(config = rateLimitConfigFromEnv()) {
  const limiter = createFixedWindowRateLimiter(config);

  return (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) => {
    if (isRateLimitExempt(request.method, request.url)) {
      done();
      return;
    }

    const result = limiter.check(clientKey(request));
    reply.header("X-RateLimit-Limit", result.limit);
    reply.header("X-RateLimit-Remaining", result.remaining);

    if (!result.allowed) {
      reply.header("Retry-After", result.retryAfterSeconds);
      void recordFailureSecurityEvent({
        request,
        errorCode: "RATE_LIMITED",
        message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        statusCode: 429,
        metadata: {
          limit: result.limit,
          remaining: result.remaining,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
      fail(reply, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
      return;
    }

    done();
  };
}
