import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { failWithFailureSecurityEvent, setSecurityEventActor } from "../security/securityEvents.js";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
  roles: string[];
  permissions: string[];
};

const sessionCookieName = "erp_session";
const sessionIdleTtlMs = minutesFromEnv("SESSION_IDLE_MINUTES", 30) * 60 * 1000;
const sessionAbsoluteTtlMs = minutesFromEnv("SESSION_ABSOLUTE_MINUTES", 12 * 60) * 60 * 1000;

function minutesFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((permission): permission is string => typeof permission === "string");
}

export function getSessionCookieOptions(maxAgeMs = sessionAbsoluteTtlMs) {
  return {
    httpOnly: true,
    maxAge: Math.max(0, Math.floor(maxAgeMs / 1000)),
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function requestUserAgent(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return Array.isArray(userAgent) ? userAgent.join(" ") : userAgent;
}

function sessionExpiryDates(now = new Date()) {
  return {
    idleExpiresAt: new Date(now.getTime() + sessionIdleTtlMs),
    absoluteExpiresAt: new Date(now.getTime() + sessionAbsoluteTtlMs),
  };
}

function isSessionExpired(session: { idleExpiresAt: Date; absoluteExpiresAt: Date; revokedAt: Date | null }, now = new Date()) {
  return Boolean(session.revokedAt) || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now;
}

async function revokeSession(sessionId: string, now = new Date()) {
  await prisma.authSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });
}

async function readValidSession(sessionId: string) {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const now = new Date();
  if (isSessionExpired(session, now)) {
    if (!session.revokedAt) await revokeSession(session.id, now);
    return null;
  }

  return session;
}

export async function getAuthUserById(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      department: true,
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  const roles = user.roles.filter(({ role }) => role.isActive).map(({ role }) => role.code);
  const permissions = [
    ...new Set(user.roles.flatMap(({ role }) => (role.isActive ? normalizePermissions(role.permissions) : []))),
  ];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    departmentId: user.departmentId,
    departmentName: user.department.name,
    roles,
    permissions,
  };
}

export async function createSession(request: FastifyRequest, reply: FastifyReply, userId: string) {
  const now = new Date();
  const sessionId = randomUUID();
  const expiry = sessionExpiryDates(now);
  await prisma.$transaction([
    prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        userAgent: requestUserAgent(request),
        ipAddress: request.ip,
        idleExpiresAt: expiry.idleExpiresAt,
        absoluteExpiresAt: expiry.absoluteExpiresAt,
        lastSeenAt: now,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
    }),
  ]);
  reply.setCookie(sessionCookieName, sessionId, getSessionCookieOptions(sessionAbsoluteTtlMs));
}

export async function clearSession(request: FastifyRequest, reply: FastifyReply, allUserSessions = false) {
  const sessionId = request.cookies[sessionCookieName];
  if (sessionId) {
    const now = new Date();
    if (allUserSessions) {
      const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
      if (session) {
        await prisma.authSession.updateMany({
          where: {
            userId: session.userId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });
      }
    } else {
      await revokeSession(sessionId, now);
    }
  }
  reply.clearCookie(sessionCookieName, { path: "/" });
}

export async function getCurrentUser(request: FastifyRequest) {
  const sessionId = request.cookies[sessionCookieName];
  if (!sessionId) return null;

  const session = await readValidSession(sessionId);
  if (!session) return null;

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: new Date(),
      idleExpiresAt: new Date(Date.now() + sessionIdleTtlMs),
    },
  });

  return getAuthUserById(session.userId);
}

export async function refreshSession(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies[sessionCookieName];
  if (!sessionId) return null;

  const session = await readValidSession(sessionId);
  if (!session) return null;

  const authUser = await getAuthUserById(session.userId);
  if (!authUser) {
    await revokeSession(session.id);
    return null;
  }

  const now = new Date();
  const rotatedSessionId = randomUUID();
  const idleExpiresAt = new Date(now.getTime() + sessionIdleTtlMs);
  await prisma.$transaction([
    prisma.authSession.update({
      where: { id: session.id },
      data: {
        revokedAt: now,
        rotatedAt: now,
      },
    }),
    prisma.authSession.create({
      data: {
        id: rotatedSessionId,
        userId: session.userId,
        userAgent: requestUserAgent(request),
        ipAddress: request.ip,
        idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        lastSeenAt: now,
      },
    }),
  ]);

  reply.setCookie(sessionCookieName, rotatedSessionId, getSessionCookieOptions(session.absoluteExpiresAt.getTime() - now.getTime()));
  return authUser;
}

export function hasPermission(user: AuthUser, permission: string) {
  return user.permissions.includes("*") || user.permissions.includes(permission);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(request);
  if (!user) {
    await failWithFailureSecurityEvent(reply, {
      request,
      errorCode: "UNAUTHORIZED",
      message: "로그인이 필요합니다.",
      statusCode: 401,
      metadata: { route: "requireAuth" },
    });
    return null;
  }
  setSecurityEventActor(request, user.id);
  return user;
}

export async function requirePermission(request: FastifyRequest, reply: FastifyReply, permission: string) {
  const user = await requireAuth(request, reply);
  if (!user) return null;

  if (!hasPermission(user, permission)) {
    await failWithFailureSecurityEvent(reply, {
      request,
      actorId: user.id,
      errorCode: "FORBIDDEN",
      message: "해당 작업 권한이 없습니다.",
      statusCode: 403,
      metadata: { permission },
    });
    return null;
  }

  return user;
}
