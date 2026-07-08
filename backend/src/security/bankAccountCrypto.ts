import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const defaultBankAccountSecret = "dev-bank-account-secret-change-in-production";

function activeBankAccountSecret() {
  return process.env.BANK_ACCOUNT_SECRET || (process.env.NODE_ENV === "production" ? "" : defaultBankAccountSecret);
}

function bankAccountKey() {
  const secret = activeBankAccountSecret();
  if (secret.length < 32) throw new Error("BANK_ACCOUNT_SECRET_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

export function isDefaultBankAccountSecret() {
  return activeBankAccountSecret() === defaultBankAccountSecret;
}

export function encryptBankAccount(accountNumber: string) {
  const normalized = accountNumber.trim();
  if (!normalized) return "";

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bankAccountKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptBankAccount(value: string) {
  if (!value.startsWith("v1:")) return null;
  const [, ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", bankAccountKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskBankAccount(accountNumber: string) {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  const prefix = digits.length >= 7 ? digits.slice(0, 3) : "";
  return `${prefix ? `${prefix}-` : ""}****-${digits.slice(-4)}`;
}
