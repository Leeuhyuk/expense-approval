type EnvMap = Record<string, string | undefined>;

function normalize(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function isProductionLikeSeedEnvironment(env: EnvMap = process.env) {
  return normalize(env.NODE_ENV) === "production" || normalize(env.RELEASE_TARGET) === "production";
}

export function isProductionSeedExplicitlyAllowed(env: EnvMap = process.env) {
  return normalize(env.ALLOW_PRODUCTION_SEED) === "true";
}

export function getSeedSafetyError(env: EnvMap = process.env) {
  if (!isProductionLikeSeedEnvironment(env) || isProductionSeedExplicitlyAllowed(env)) {
    return null;
  }

  const nodeEnv = env.NODE_ENV?.trim() || "unset";
  const releaseTarget = env.RELEASE_TARGET?.trim() || "unset";
  return [
    "Refusing to run Prisma seed in a production-like environment.",
    `NODE_ENV=${nodeEnv}, RELEASE_TARGET=${releaseTarget}.`,
    "Set ALLOW_PRODUCTION_SEED=true only for an approved, temporary migration rehearsal.",
  ].join(" ");
}

export function assertSeedAllowed(env: EnvMap = process.env) {
  const error = getSeedSafetyError(env);
  if (error) {
    throw new Error(error);
  }
}
