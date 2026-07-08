import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiBodyLimitBytes, createFixedWindowRateLimiter, isRateLimitExempt, rateLimitConfigFromEnv } from "../../backend/src/security/rateLimit";

function withEnv(values: Record<string, string | undefined>, test: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    test();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("backend API rate limiting", () => {
  it("limits requests within a fixed window and resets on the next window", () => {
    const limiter = createFixedWindowRateLimiter({
      enabled: true,
      windowMs: 1000,
      maxRequests: 2,
      maxKeys: 100,
    });

    assert.equal(limiter.check("203.0.113.10", 0).allowed, true);
    assert.equal(limiter.check("203.0.113.10", 100).allowed, true);
    const rejected = limiter.check("203.0.113.10", 200);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.remaining, 0);
    assert.equal(rejected.retryAfterSeconds, 1);
    assert.equal(limiter.check("203.0.113.10", 1000).allowed, true);
  });

  it("keeps health checks and CORS preflight outside the limiter", () => {
    assert.equal(isRateLimitExempt("GET", "/api/health"), true);
    assert.equal(isRateLimitExempt("GET", "/api/health/db"), true);
    assert.equal(isRateLimitExempt("OPTIONS", "/api/payment-requests"), true);
    assert.equal(isRateLimitExempt("POST", "/api/auth/login"), false);
  });

  it("reads body and rate limit controls from environment with production-safe defaults", () => {
    withEnv(
      {
        API_BODY_LIMIT_BYTES: "12582912",
        RATE_LIMIT_WINDOW_MS: "30000",
        RATE_LIMIT_MAX: "50",
        RATE_LIMIT_DISABLED: undefined,
      },
      () => {
        assert.equal(apiBodyLimitBytes(), 12 * 1024 * 1024);
        assert.deepEqual(rateLimitConfigFromEnv(), {
          enabled: true,
          windowMs: 30000,
          maxRequests: 50,
          maxKeys: 10000,
        });
      },
    );
  });
});
