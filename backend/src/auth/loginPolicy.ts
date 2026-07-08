import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";

function positiveIntegerFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const loginFailureLockThreshold = positiveIntegerFromEnv("LOGIN_FAILURE_LOCK_THRESHOLD", 5);
export const loginFailureWindowMinutes = positiveIntegerFromEnv("LOGIN_FAILURE_WINDOW_MINUTES", 15);
export const dormantAccountDays = positiveIntegerFromEnv("DORMANT_ACCOUNT_DAYS", 90);
export const passwordMinLength = positiveIntegerFromEnv("PASSWORD_MIN_LENGTH", 12);
export const passwordMaxAgeDays = positiveIntegerFromEnv("PASSWORD_MAX_AGE_DAYS", 90);

export type LoginLockStatus = {
  locked: boolean;
  failureCount: number;
  threshold: number;
  windowMinutes: number;
  lockedUntil: Date | null;
};

export type PasswordAgeStatus = {
  expired: boolean;
  changedAt: Date;
  expiresAt: Date;
  maxAgeDays: number;
};

export type PasswordPolicyValidation = {
  ok: boolean;
  fieldErrors: Record<string, string>;
};

export function dormantAccountCutoff(now = new Date()) {
  return new Date(now.getTime() - dormantAccountDays * 24 * 60 * 60 * 1000);
}

export function isDormantAccount(user: { createdAt: Date; lastLoginAt: Date | null }, now = new Date()) {
  const referenceDate = user.lastLoginAt ?? user.createdAt;
  return referenceDate <= dormantAccountCutoff(now);
}

export function passwordExpiresAt(changedAt: Date) {
  return new Date(changedAt.getTime() + passwordMaxAgeDays * 24 * 60 * 60 * 1000);
}

export function passwordPolicyRequirements() {
  return [
    `최소 ${passwordMinLength}자`,
    "대문자 1자 이상",
    "소문자 1자 이상",
    "숫자 1자 이상",
    "특수문자 1자 이상",
  ];
}

export function validatePasswordPolicy(password: string): PasswordPolicyValidation {
  const fieldErrors: Record<string, string> = {};
  if (password.length < passwordMinLength) fieldErrors.newPassword = `비밀번호는 최소 ${passwordMinLength}자 이상이어야 합니다.`;
  else if (!/[A-Z]/.test(password)) fieldErrors.newPassword = "비밀번호에는 대문자가 1자 이상 필요합니다.";
  else if (!/[a-z]/.test(password)) fieldErrors.newPassword = "비밀번호에는 소문자가 1자 이상 필요합니다.";
  else if (!/\d/.test(password)) fieldErrors.newPassword = "비밀번호에는 숫자가 1자 이상 필요합니다.";
  else if (!/[^A-Za-z0-9]/.test(password)) fieldErrors.newPassword = "비밀번호에는 특수문자가 1자 이상 필요합니다.";
  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export async function getPasswordAgeStatus(
  user: { id: string; createdAt: Date },
  db: Pick<PrismaClient, "auditLog"> = prisma,
  now = new Date(),
): Promise<PasswordAgeStatus> {
  const latestPasswordChange = await db.auditLog.findFirst({
    where: {
      entityType: "user",
      entityId: user.id,
      action: "password_change",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const changedAt = latestPasswordChange?.createdAt ?? user.createdAt;
  const expiresAt = passwordExpiresAt(changedAt);
  return {
    expired: expiresAt <= now,
    changedAt,
    expiresAt,
    maxAgeDays: passwordMaxAgeDays,
  };
}

export async function getLoginLockStatus(
  userId: string,
  db: Pick<PrismaClient, "securityEvent"> = prisma,
  now = new Date(),
): Promise<LoginLockStatus> {
  const windowMs = loginFailureWindowMinutes * 60 * 1000;
  const since = new Date(now.getTime() - windowMs);
  const failures = await db.securityEvent.findMany({
    where: {
      eventType: "login_rejected",
      errorCode: "UNAUTHORIZED",
      targetType: "USER",
      targetId: userId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: loginFailureLockThreshold,
    select: { createdAt: true },
  });

  if (failures.length < loginFailureLockThreshold) {
    return {
      locked: false,
      failureCount: failures.length,
      threshold: loginFailureLockThreshold,
      windowMinutes: loginFailureWindowMinutes,
      lockedUntil: null,
    };
  }

  const lockedUntil = new Date(failures[0].createdAt.getTime() + windowMs);
  return {
    locked: lockedUntil > now,
    failureCount: failures.length,
    threshold: loginFailureLockThreshold,
    windowMinutes: loginFailureWindowMinutes,
    lockedUntil: lockedUntil > now ? lockedUntil : null,
  };
}
