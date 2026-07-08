import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/index.js";
import { clearCsrfCookie, issueCsrfCookie } from "../auth/csrf.js";
import {
  dormantAccountDays,
  getLoginLockStatus,
  getPasswordAgeStatus,
  isDormantAccount,
  passwordMaxAgeDays,
  passwordMinLength,
  passwordPolicyRequirements,
  passwordExpiresAt,
  validatePasswordPolicy,
} from "../auth/loginPolicy.js";
import { createSession, clearSession, getAuthUserById, getCurrentUser, refreshSession } from "../auth/session.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { failWithFailureSecurityEvent } from "../security/securityEvents.js";
import { auditRequestContext } from "./rowUtils.js";
import { success } from "../utils/response.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const logoutSchema = z.object({
  allSessions: z.boolean().optional(),
}).optional();

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

const expiredPasswordChangeSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

function passwordPolicyPayload() {
  return {
    minLength: passwordMinLength,
    maxAgeDays: passwordMaxAgeDays,
    requirements: passwordPolicyRequirements(),
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.safeParse(request.body);
    if (!input.success) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "login_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "이메일과 비밀번호를 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: input.data.email },
      select: { id: true, isActive: true, passwordHash: true, createdAt: true, lastLoginAt: true },
    });

    if (user?.isActive) {
      const lockStatus = await getLoginLockStatus(user.id);
      if (lockStatus.locked) {
        return failWithFailureSecurityEvent(reply, {
          request,
          eventType: "login_rejected",
          errorCode: "ACCOUNT_LOCKED",
          message: "로그인 실패가 반복되어 계정이 잠겼습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.",
          statusCode: 423,
          targetType: "USER",
          targetId: user.id,
          metadata: {
            reason: "login_failure_lock",
            failureCount: lockStatus.failureCount,
            threshold: lockStatus.threshold,
            windowMinutes: lockStatus.windowMinutes,
            lockedUntil: lockStatus.lockedUntil?.toISOString() ?? null,
          },
        });
      }
    }

    const passwordMatches = user?.isActive ? await verifyPassword(input.data.password, user.passwordHash) : false;
    if (!user || !user.isActive || !passwordMatches) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "login_rejected",
        errorCode: "UNAUTHORIZED",
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
        statusCode: 401,
        targetType: user ? "USER" : null,
        targetId: user?.id ?? null,
        metadata: {
          reason: !user ? "unknown_email" : !user.isActive ? "inactive_user" : "invalid_password",
          emailProvided: true,
        },
      });
    }

    if (isDormantAccount(user)) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "login_rejected",
        errorCode: "DORMANT_ACCOUNT",
        message: "휴면 계정입니다. 관리자에게 계정 재활성화를 요청하세요.",
        statusCode: 403,
        targetType: "USER",
        targetId: user.id,
        metadata: {
          reason: "dormant_account",
          dormantAccountDays,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        },
      });
    }

    const passwordAge = await getPasswordAgeStatus(user);
    if (passwordAge.expired) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "login_rejected",
        errorCode: "PASSWORD_EXPIRED",
        message: "비밀번호가 만료되었습니다. 현재 비밀번호로 새 비밀번호를 설정한 뒤 다시 로그인하세요.",
        statusCode: 403,
        targetType: "USER",
        targetId: user.id,
        metadata: {
          reason: "password_expired",
          passwordChangedAt: passwordAge.changedAt.toISOString(),
          passwordExpiresAt: passwordAge.expiresAt.toISOString(),
          passwordMaxAgeDays: passwordAge.maxAgeDays,
        },
      });
    }

    const authUser = await getAuthUserById(user.id);
    if (!authUser) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "login_rejected",
        errorCode: "UNAUTHORIZED",
        message: "활성 사용자 정보를 찾을 수 없습니다.",
        statusCode: 401,
        targetType: "USER",
        targetId: user.id,
        metadata: { reason: "auth_user_unavailable" },
      });
    }

    await createSession(request, reply, user.id);
    issueCsrfCookie(reply);
    return reply.send(success(request, authUser));
  });

  app.get("/auth/password-policy", async (request, reply) => {
    return reply.send(success(request, passwordPolicyPayload()));
  });

  app.post("/auth/password/change-expired", async (request, reply) => {
    const input = expiredPasswordChangeSchema.safeParse(request.body);
    if (!input.success) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "비밀번호 변경 요청을 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: input.data.email },
      select: { id: true, email: true, isActive: true, passwordHash: true, createdAt: true },
    });
    const currentMatches = user?.isActive ? await verifyPassword(input.data.currentPassword, user.passwordHash) : false;
    if (!user || !user.isActive || !currentMatches) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "password_change_rejected",
        errorCode: "UNAUTHORIZED",
        message: "현재 비밀번호를 확인해주세요.",
        statusCode: 401,
        targetType: user ? "USER" : null,
        targetId: user?.id ?? null,
        metadata: { reason: !user ? "unknown_email" : !user.isActive ? "inactive_user" : "invalid_current_password", emailProvided: true },
      });
    }

    const policy = validatePasswordPolicy(input.data.newPassword);
    if (!policy.ok) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: policy.fieldErrors.newPassword ?? "비밀번호 정책을 확인해주세요.",
        statusCode: 400,
        targetType: "USER",
        targetId: user.id,
        metadata: { reason: "password_policy_violation", policy: passwordPolicyPayload() },
      });
    }
    if (await verifyPassword(input.data.newPassword, user.passwordHash)) {
      return failWithFailureSecurityEvent(reply, {
        request,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "새 비밀번호는 현재 비밀번호와 달라야 합니다.",
        statusCode: 400,
        targetType: "USER",
        targetId: user.id,
        metadata: { reason: "password_reuse_current" },
      });
    }

    const newPasswordHash = await hashPassword(input.data.newPassword);
    const changedAt = new Date();
    const expiresAt = passwordExpiresAt(changedAt);
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash, rowVersion: { increment: 1 } },
      });
      const revoked = await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: changedAt },
      });
      const afterValue = {
        changedAt: changedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        sessionsRevoked: revoked.count,
        policy: passwordPolicyPayload(),
      };
      await tx.auditLog.create({
        data: {
          entityType: "user",
          entityId: user.id,
          actorId: user.id,
          action: "password_change",
          beforeValue: { expiredChange: true } as Prisma.InputJsonObject,
          afterValue: afterValue as Prisma.InputJsonObject,
          reason: "password_expired_change",
          ...auditRequestContext(request),
        },
      });
      return afterValue;
    });

    return reply.send(success(request, result));
  });

  app.post("/auth/logout", async (request, reply) => {
    const input = logoutSchema.safeParse(request.body);
    if (!input.success) {
      return failWithFailureSecurityEvent(reply, {
        request,
        errorCode: "VALIDATION_ERROR",
        message: "로그아웃 요청을 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }
    await clearSession(request, reply, input.data?.allSessions === true);
    clearCsrfCookie(reply);
    return reply.send(success(request, { ok: true }));
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) {
      return failWithFailureSecurityEvent(reply, {
        request,
        errorCode: "UNAUTHORIZED",
        message: "로그인이 필요합니다.",
        statusCode: 401,
        metadata: { route: "auth/me" },
      });
    }
    return reply.send(success(request, user));
  });

  app.post("/auth/refresh", async (request, reply) => {
    const user = await refreshSession(request, reply);
    if (!user) {
      return failWithFailureSecurityEvent(reply, {
        request,
        errorCode: "UNAUTHORIZED",
        message: "세션을 연장할 수 없습니다.",
        statusCode: 401,
        metadata: { route: "auth/refresh" },
      });
    }
    issueCsrfCookie(reply);
    return reply.send(success(request, user));
  });

  app.post("/auth/password/change", async (request, reply) => {
    const authUser = await getCurrentUser(request);
    if (!authUser) {
      return failWithFailureSecurityEvent(reply, {
        request,
        errorCode: "UNAUTHORIZED",
        message: "로그인이 필요합니다.",
        statusCode: 401,
        metadata: { route: "auth/password/change" },
      });
    }

    const input = passwordChangeSchema.safeParse(request.body);
    if (!input.success) {
      return failWithFailureSecurityEvent(reply, {
        request,
        actorId: authUser.id,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "비밀번호 변경 요청을 확인해주세요.",
        statusCode: 400,
        targetType: "USER",
        targetId: authUser.id,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, passwordHash: true, createdAt: true },
    });
    if (!user || !(await verifyPassword(input.data.currentPassword, user.passwordHash))) {
      return failWithFailureSecurityEvent(reply, {
        request,
        actorId: authUser.id,
        eventType: "password_change_rejected",
        errorCode: "UNAUTHORIZED",
        message: "현재 비밀번호를 확인해주세요.",
        statusCode: 401,
        targetType: "USER",
        targetId: authUser.id,
        metadata: { reason: "invalid_current_password" },
      });
    }

    const policy = validatePasswordPolicy(input.data.newPassword);
    if (!policy.ok) {
      return failWithFailureSecurityEvent(reply, {
        request,
        actorId: authUser.id,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: policy.fieldErrors.newPassword ?? "비밀번호 정책을 확인해주세요.",
        statusCode: 400,
        targetType: "USER",
        targetId: authUser.id,
        metadata: { reason: "password_policy_violation", policy: passwordPolicyPayload() },
      });
    }
    if (await verifyPassword(input.data.newPassword, user.passwordHash)) {
      return failWithFailureSecurityEvent(reply, {
        request,
        actorId: authUser.id,
        eventType: "password_change_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "새 비밀번호는 현재 비밀번호와 달라야 합니다.",
        statusCode: 400,
        targetType: "USER",
        targetId: authUser.id,
        metadata: { reason: "password_reuse_current" },
      });
    }

    const sessionId = request.cookies.erp_session;
    const newPasswordHash = await hashPassword(input.data.newPassword);
    const previousAge = await getPasswordAgeStatus(user);
    const changedAt = new Date();
    const expiresAt = passwordExpiresAt(changedAt);
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: authUser.id },
        data: { passwordHash: newPasswordHash, rowVersion: { increment: 1 } },
      });
      const revoked = await tx.authSession.updateMany({
        where: {
          userId: authUser.id,
          revokedAt: null,
          ...(sessionId ? { id: { not: sessionId } } : {}),
        },
        data: { revokedAt: changedAt },
      });
      const afterValue = {
        changedAt: changedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        sessionsRevoked: revoked.count,
        policy: passwordPolicyPayload(),
      };
      await tx.auditLog.create({
        data: {
          entityType: "user",
          entityId: authUser.id,
          actorId: authUser.id,
          action: "password_change",
          beforeValue: {
            changedAt: previousAge.changedAt.toISOString(),
            expiresAt: previousAge.expiresAt.toISOString(),
          } as Prisma.InputJsonObject,
          afterValue: afterValue as Prisma.InputJsonObject,
          reason: "user_password_change",
          ...auditRequestContext(request),
        },
      });
      return afterValue;
    });

    return reply.send(success(request, result));
  });
};
