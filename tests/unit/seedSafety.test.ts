import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSeedAllowed, getSeedSafetyError, isProductionLikeSeedEnvironment } from "../../prisma/seedSafety";

describe("Prisma seed production safety", () => {
  it("allows local seed runs", () => {
    const env = { NODE_ENV: "development", RELEASE_TARGET: "local" };

    assert.equal(isProductionLikeSeedEnvironment(env), false);
    assert.equal(getSeedSafetyError(env), null);
    assert.doesNotThrow(() => assertSeedAllowed(env));
  });

  it("blocks production-like seed runs by default", () => {
    const targetEnv = { RELEASE_TARGET: "production" };
    const nodeEnv = { NODE_ENV: "production" };

    assert.match(getSeedSafetyError(targetEnv) ?? "", /Refusing to run Prisma seed/);
    assert.throws(() => assertSeedAllowed(targetEnv), /ALLOW_PRODUCTION_SEED=true/);
    assert.throws(() => assertSeedAllowed(nodeEnv), /NODE_ENV=production/);
  });

  it("requires the exact temporary override value", () => {
    assert.doesNotThrow(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        ALLOW_PRODUCTION_SEED: "true",
      }),
    );
    assert.throws(
      () =>
        assertSeedAllowed({
          NODE_ENV: "production",
          ALLOW_PRODUCTION_SEED: "yes",
        }),
      /ALLOW_PRODUCTION_SEED=true/,
    );
  });
});
