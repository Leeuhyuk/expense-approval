import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, verifyPassword } from "../../backend/src/auth/password";

describe("backend password hashing", () => {
  it("verifies scrypt password hashes and rejects wrong passwords", async () => {
    const passwordHash = await hashPassword("StrongPass#2026", Buffer.from("unit-test-salt"));

    assert.equal(await verifyPassword("StrongPass#2026", passwordHash), true);
    assert.equal(await verifyPassword("wrong-password", passwordHash), false);
  });

  it("rejects unsupported legacy or malformed password hashes", async () => {
    assert.equal(await verifyPassword("password", "$2b$10$seed-only-password-hash"), false);
    assert.equal(await verifyPassword("password", "scrypt$bad"), false);
  });
});
