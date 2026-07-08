import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/session.js";
import { prisma } from "../db/prisma.js";
import { success } from "../utils/response.js";

const notificationTypeMap = {
  APPROVAL_REQUESTED: "approval_requested",
  APPROVAL_REJECTED: "approval_rejected",
  APPROVAL_HELD: "approval_held",
  APPROVAL_COMPLETED: "approval_completed",
  DISBURSEMENT_SCHEDULED: "disbursement_scheduled",
  DISBURSEMENT_COMPLETED: "disbursement_completed",
  BUDGET_EXCEEDED: "budget_exceeded",
  APPROVAL_DELAYED: "approval_delayed",
  SYSTEM_SETTING_CHANGED: "system_setting_changed",
  OPERATIONAL_ALERT: "operational_alert",
} as const;

function toNotificationDto(item: {
  id: string;
  type: keyof typeof notificationTypeMap;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  linkPath: string | null;
  readAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: item.id,
    type: notificationTypeMap[item.type],
    title: item.title,
    message: item.message,
    createdAt: item.createdAt.toISOString(),
    readAt: item.readAt?.toISOString(),
    expiresAt: item.expiresAt?.toISOString(),
    linkPath: item.linkPath ?? undefined,
    entityType: item.entityType ?? undefined,
    entityId: item.entityId ?? undefined,
  };
}

function activeNotificationWhere(userId: string, now = new Date()) {
  return {
    userId,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/notifications", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const items = await prisma.notification.findMany({
      where: activeNotificationWhere(user.id),
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return reply.send(success(request, items.map(toNotificationDto)));
  });

  app.patch("/notifications/:id/read", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { id: string };
    const item = await prisma.notification.findFirst({
      where: {
        ...activeNotificationWhere(user.id),
        id: params.id,
      },
    });

    if (!item) {
      return reply.send(success(request, null));
    }

    const updated = await prisma.notification.update({
      where: { id: item.id },
      data: { readAt: item.readAt ?? new Date() },
    });

    return reply.send(success(request, toNotificationDto(updated)));
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const now = new Date();
    await prisma.notification.updateMany({
      where: {
        ...activeNotificationWhere(user.id, now),
        readAt: null,
      },
      data: { readAt: now },
    });

    const items = await prisma.notification.findMany({
      where: activeNotificationWhere(user.id, now),
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return reply.send(success(request, items.map(toNotificationDto)));
  });
};
