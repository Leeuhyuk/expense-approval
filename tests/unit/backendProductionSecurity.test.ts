import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCsrfCookieOptions } from "../../backend/src/auth/csrf";
import { getSessionCookieOptions } from "../../backend/src/auth/session";
import { buildApp } from "../../backend/src/app";

async function withEnv<T>(env: NodeJS.ProcessEnv, action: () => T | Promise<T>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("backend production security controls", () => {
  it("uses production-safe session and CSRF cookie flags", async () => {
    await withEnv({ NODE_ENV: "production" }, () => {
      const sessionCookie = getSessionCookieOptions(30 * 60 * 1000);
      const csrfCookie = getCsrfCookieOptions();

      assert.equal(sessionCookie.httpOnly, true);
      assert.equal(sessionCookie.secure, true);
      assert.equal(sessionCookie.sameSite, "lax");
      assert.equal(sessionCookie.path, "/");
      assert.equal(sessionCookie.maxAge, 30 * 60);

      assert.equal(csrfCookie.httpOnly, false);
      assert.equal(csrfCookie.secure, true);
      assert.equal(csrfCookie.sameSite, "lax");
      assert.equal(csrfCookie.path, "/");
    });
  });

  it("rejects local, wildcard, or non-HTTPS CORS origins in production", async () => {
    for (const FRONTEND_ORIGIN of ["*", "http://127.0.0.1:5173", "http://erp.example.com"]) {
      await assert.rejects(
        withEnv({ NODE_ENV: "production", FRONTEND_ORIGIN }, () => buildApp({ logger: false })),
        /FRONTEND_ORIGIN must be an explicit HTTPS non-local allowlist/,
      );
    }

    const app = await withEnv({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://erp.example.com" }, () => buildApp({ logger: false }));
    await app.close();
  });
});
