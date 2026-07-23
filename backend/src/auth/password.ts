import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const scryptKeyLength = 64;
const defaultScryptParams = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function scrypt(password: string, salt: Buffer, keyLength: number, options: typeof defaultScryptParams) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string, salt = randomBytes(16)) {
  const key = await scrypt(password, salt, scryptKeyLength, defaultScryptParams);
  return ["scrypt", defaultScryptParams.N, defaultScryptParams.r, defaultScryptParams.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, expectedRaw] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltRaw || !expectedRaw) return false;

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) return false;

  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(expectedRaw, "base64url");
    const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
