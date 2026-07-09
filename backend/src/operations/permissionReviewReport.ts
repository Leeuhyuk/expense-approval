import type { Prisma, PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";

export type PermissionReviewSeverity = "info" | "warning" | "critical";

export type PermissionReviewException = {
  id: string;
  severity: PermissionReviewSeverity;
  status: "expiry_missing" | "expired" | "expiring" | "current";
  userId: string;
  userName: string;
  departmentName: string;
  roleId: string;
  roleName: string;
  permission: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  action: string;
  evidence: string;
};

export type PermissionReviewPrivilegedUser = {
  userId: string;
  userName: string;
  departmentName: string;
  active: boolean;
  lastLoginAt: string | null;
  roles: string[];
  highRiskPermissions: string[];
  missingExpiryCount: number;
  expiredExceptionCount: number;
  expiringExceptionCount: number;
  reviewStatus: "ok" | "review" | "blocked";
};

export type PermissionReviewChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  owner: string;
  detail: string;
  evidence: string;
};

type PermissionReviewDb = PrismaClient;

const highRiskPermissionLabels: Record<string, string> = {
  "*": "전체 권한",
  "system:manage": "시스템 설정 관리",
  "disbursement:execute": "지급 실행",
  "disbursement:hold": "지급 보류",
  "payment_request:read_all": "전체 결제 요청 조회",
  "audit:read": "감사 로그 조회",
};

const highRiskPermissionCodes = Object.keys(highRiskPermissionLabels);
const exceptionPattern = /^exception:(.+):(\d{4}-\d{2}-\d{2})$/;

function permissionStrings(value: Prisma.JsonValue): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return Array.isArray(record.permissions) ? record.permissions.filter((item): item is string => typeof item === "string") : [];
  }
  return [];
}

function regularPermissions(permissions: string[]) {
  return permissions.filter((permission) => !permission.startsWith("exception:"));
}

function exceptionExpiryByPermission(permissions: string[]) {
  const expiries = new Map<string, Date>();
  for (const permission of permissions) {
    const match = permission.match(exceptionPattern);
    if (!match) continue;
    const expiresAt = new Date(`${match[2]}T23:59:59.999Z`);
    if (!Number.isNaN(expiresAt.getTime())) expiries.set(match[1], expiresAt);
  }
  return expiries;
}

function highRiskPermissionsFor(permissions: string[]) {
  const regular = regularPermissions(permissions);
  if (regular.includes("*")) return highRiskPermissionCodes;
  return highRiskPermissionCodes.filter((permission) => regular.includes(permission));
}

function daysUntil(expiresAt: Date, now: Date) {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

function nextQuarterReviewDue(now: Date) {
  const quarter = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), quarter * 3 + 3, 1));
}

function reviewWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, label: start.toISOString().slice(0, 7) };
}

export async function getPermissionReviewReport(db: PermissionReviewDb = prisma, now = new Date()) {
  const period = reviewWindow(now);
  const expiringThresholdDays = 30;
  const [users, reviewLogs] = await Promise.all([
    db.user.findMany({
      include: {
        department: true,
        roles: { include: { role: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.auditLog.findMany({
      where: {
        entityType: "permission_review",
        action: { in: ["review", "approve_exception", "expire_exception"] },
        createdAt: { gte: period.start, lt: period.end },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, createdAt: true, reason: true },
    }),
  ]);

  const exceptions: PermissionReviewException[] = [];
  const privilegedUsers: PermissionReviewPrivilegedUser[] = [];

  for (const user of users) {
    const userHighRisk = new Set<string>();
    const roleNames: string[] = [];
    let missingExpiryCount = 0;
    let expiredExceptionCount = 0;
    let expiringExceptionCount = 0;

    for (const userRole of user.roles) {
      const role = userRole.role;
      if (!role.isActive) continue;
      const permissions = permissionStrings(role.permissions);
      const expiries = exceptionExpiryByPermission(permissions);
      const highRiskPermissions = highRiskPermissionsFor(permissions);
      if (highRiskPermissions.length === 0) continue;
      roleNames.push(role.name);

      for (const permission of highRiskPermissions) {
        userHighRisk.add(permission);
        const expiresAt = expiries.get(permission) ?? expiries.get("*") ?? null;
        let status: PermissionReviewException["status"] = "expiry_missing";
        let severity: PermissionReviewSeverity = "warning";
        let dayCount: number | null = null;
        let action = "예외 권한 만료일을 지정하고 정기 검토 승인 로그를 남기세요.";
        if (expiresAt) {
          dayCount = daysUntil(expiresAt, now);
          if (dayCount < 0) {
            status = "expired";
            severity = "critical";
            action = "만료된 예외 권한을 회수하거나 재승인 후 새 만료일을 기록하세요.";
            expiredExceptionCount += 1;
          } else if (dayCount <= expiringThresholdDays) {
            status = "expiring";
            severity = "warning";
            action = "만료 전 재검토하고 유지/회수 결정을 기록하세요.";
            expiringExceptionCount += 1;
          } else {
            status = "current";
            severity = "info";
            action = "다음 정기 검토 시 유지 필요성을 재확인하세요.";
          }
        } else {
          missingExpiryCount += 1;
        }

        exceptions.push({
          id: `${user.id}-${role.id}-${permission}`,
          severity,
          status,
          userId: user.id,
          userName: user.name,
          departmentName: user.department.name,
          roleId: role.id,
          roleName: role.name,
          permission,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          daysUntilExpiry: dayCount,
          action,
          evidence: expiresAt ? `Role.permissions exception:${permission}:${expiresAt.toISOString().slice(0, 10)}` : "Role.permissions expiry marker missing",
        });
      }
    }

    if (userHighRisk.size > 0) {
      privilegedUsers.push({
        userId: user.id,
        userName: user.name,
        departmentName: user.department.name,
        active: user.isActive,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        roles: [...new Set(roleNames)].sort(),
        highRiskPermissions: [...userHighRisk].sort(),
        missingExpiryCount,
        expiredExceptionCount,
        expiringExceptionCount,
        reviewStatus: !user.isActive || expiredExceptionCount > 0 ? "blocked" : missingExpiryCount > 0 || expiringExceptionCount > 0 ? "review" : "ok",
      });
    }
  }

  const inactivePrivilegedUsers = privilegedUsers.filter((user) => !user.active).length;
  const expiredExceptions = exceptions.filter((item) => item.status === "expired").length;
  const expiringExceptions = exceptions.filter((item) => item.status === "expiring").length;
  const missingExpiryExceptions = exceptions.filter((item) => item.status === "expiry_missing").length;
  const checklist: PermissionReviewChecklistItem[] = [
    {
      id: "monthly_review_log_present",
      label: "정기 권한 검토 로그",
      ok: reviewLogs.length > 0,
      owner: "시스템 관리자",
      detail: `${period.label} 권한 검토 감사 로그 ${reviewLogs.length}건`,
      evidence: "AuditLog entityType=permission_review",
    },
    {
      id: "inactive_privileged_users_clear",
      label: "비활성 특권 계정 회수",
      ok: inactivePrivilegedUsers === 0,
      owner: "보안 운영",
      detail: `비활성 특권 계정 ${inactivePrivilegedUsers}명`,
      evidence: "User.isActive + Role.permissions",
    },
    {
      id: "exception_expiry_current",
      label: "예외 권한 만료일 관리",
      ok: expiredExceptions === 0 && missingExpiryExceptions === 0,
      owner: "시스템 관리자",
      detail: `만료 ${expiredExceptions}건, 만료일 없음 ${missingExpiryExceptions}건, 30일 이내 ${expiringExceptions}건`,
      evidence: "Role.permissions exception:<permission>:YYYY-MM-DD",
    },
  ];

  return {
    ok: inactivePrivilegedUsers === 0 && expiredExceptions === 0 && missingExpiryExceptions === 0 && checklist.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    period: {
      month: period.label,
      start: period.start.toISOString(),
      endExclusive: period.end.toISOString(),
      reviewDueAt: nextQuarterReviewDue(now).toISOString(),
      expiringThresholdDays,
    },
    summary: {
      totalUsers: users.length,
      activeUsers: users.filter((user) => user.isActive).length,
      privilegedUsers: privilegedUsers.length,
      inactivePrivilegedUsers,
      exceptions: exceptions.length,
      expiredExceptions,
      expiringExceptions,
      missingExpiryExceptions,
      reviewLogs: reviewLogs.length,
      checklistPassed: checklist.filter((item) => item.ok).length,
      checklistTotal: checklist.length,
    },
    privilegedUsers,
    exceptions,
    checklist,
  };
}
