import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { clearCsrfCookie, issueCsrfCookie } from "../auth/csrf.js";
import { createSession, clearSession, getAuthUserById, getCurrentUser, refreshSession } from "../auth/session.js";
import { verifyPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { failWithFailureSecurityEvent } from "../security/securityEvents.js";
import { success } from "../utils/response.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const logoutSchema = z.object({
  allSessions: z.boolean().optional(),
}).optional();

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
      select: { id: true, isActive: true, passwordHash: true },
    });

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
    // 세션 조회는 로그인 여부 확인 용도이므로 미로그인도 오류가 아니라 null 세션으로 응답한다
    // (401을 반환하면 로그인 화면 최초 진입마다 브라우저 콘솔 오류가 남는다).
    const user = await getCurrentUser(request);
    return reply.send(success(request, user ?? null));
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
};
