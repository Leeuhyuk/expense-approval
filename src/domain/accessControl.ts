import type { AuthUser, PageKey, PermissionCode } from "../types";

const pagePermissions: Record<PageKey, PermissionCode> = {
  dashboard: "dashboard:read",
  "payment-request": "payment_request:read_own",
  approval: "approval:read_assigned",
  disbursement: "disbursement:read",
  budget: "budget:read",
  vendors: "vendor:read",
  reports: "report:read",
  settings: "system:manage",
  favorites: "favorite:read",
};

export function hasPermission(user: AuthUser, permission: PermissionCode) {
  return user.permissions.includes("*") || user.permissions.includes(permission);
}

export function canAccessPage(user: AuthUser, pageKey: PageKey) {
  const permission = pagePermissions[pageKey];
  if (pageKey === "payment-request") {
    return hasPermission(user, permission) || hasPermission(user, "payment_request:read_all");
  }
  return hasPermission(user, permission);
}

export function canUseAction(user: AuthUser, permission: PermissionCode) {
  return hasPermission(user, permission);
}

export function getDefaultPage(user: AuthUser): PageKey {
  const fallbackOrder: PageKey[] = [
    "dashboard",
    "payment-request",
    "approval",
    "disbursement",
    "budget",
    "vendors",
    "reports",
    "settings",
    "favorites",
  ];
  return fallbackOrder.find((pageKey) => canAccessPage(user, pageKey)) ?? "dashboard";
}
