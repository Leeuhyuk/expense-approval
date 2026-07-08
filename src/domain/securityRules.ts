export const passwordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
  maxAgeDays: 90,
  lockoutThreshold: 5,
  sessionIdleMinutes: 30,
} as const;

export const unsavedChangePolicy = {
  blockNavigationWhileSaving: true,
  confirmWhenDirty: true,
  autosaveDraftIntervalSeconds: 30,
} as const;

export const adminRecoveryPolicy = {
  allowedRoles: ["ADMIN", "FINANCE"],
  requireReason: true,
  requireAuditLog: true,
  requireSecondReviewForPaidItems: true,
} as const;

export const dataIntegrityPolicy = {
  requireRowVersion: true,
  requireIdempotencyKeyForActions: true,
  reconcilePaymentsWithApprovals: true,
  reconcileBudgetUsageDaily: true,
} as const;

export function validatePasswordPolicy(password: string) {
  const errors: string[] = [];
  if (password.length < passwordPolicy.minLength) errors.push(`최소 ${passwordPolicy.minLength}자 이상이어야 합니다.`);
  if (passwordPolicy.requireUppercase && !/[A-Z]/.test(password)) errors.push("영문 대문자를 포함해야 합니다.");
  if (passwordPolicy.requireLowercase && !/[a-z]/.test(password)) errors.push("영문 소문자를 포함해야 합니다.");
  if (passwordPolicy.requireNumber && !/\d/.test(password)) errors.push("숫자를 포함해야 합니다.");
  if (passwordPolicy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) errors.push("특수문자를 포함해야 합니다.");
  return errors;
}
