export const notificationRetentionDays = 90;

export function notificationExpiresAt(from = new Date()) {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + notificationRetentionDays);
  return expiresAt;
}
