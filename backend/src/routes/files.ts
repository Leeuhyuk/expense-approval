import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { hasPermission, requireAuth, type AuthUser } from "../auth/session.js";
import { prisma } from "../db/prisma.js";
import { retentionPolicyFor } from "../domain/retentionPolicy.js";
import { attachmentExtension, attachmentScanStatus, isAllowedAttachmentContentType, maxAttachmentBytes, validateAttachmentUploadPolicy } from "../security/attachmentPolicy.js";
import { scanAttachmentBuffer } from "../security/malwareScan.js";
import { failWithSecurityEvent } from "../security/securityEvents.js";
import { deleteStoredFile, readStoredFile, storageKeyFor, storedByteSize, writeStoredFile } from "../storage/attachmentStorage.js";
import { success } from "../utils/response.js";
import { auditRequestContext } from "./rowUtils.js";

export const signedUrlTtlMs = 10 * 60 * 1000;

const presignUploadSchema = z.object({
  ownerType: z.string().min(1),
  ownerId: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  byteSize: z.coerce.number().int().positive().max(maxAttachmentBytes),
  checksum: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

const completeSchema = z.object({
  fileId: z.string().uuid(),
  checksum: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

const listFilesQuerySchema = z.object({
  ownerType: z.string().min(1),
  ownerId: z.string().min(1),
});

const downloadQuerySchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

function signingSecret() {
  return process.env.FILE_URL_SECRET || "dev-file-url-secret-change-in-production";
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function readStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function requestContentType(request: FastifyRequest) {
  const value = request.headers["content-type"];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function comparableContentType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isPrismaCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function tokenPayload(fileId: string, purpose: "upload" | "download", expiresAt: number) {
  return `${fileId}:${purpose}:${expiresAt}`;
}

function signToken(fileId: string, purpose: "upload" | "download", expiresAt: number) {
  const signature = createHmac("sha256", signingSecret()).update(tokenPayload(fileId, purpose, expiresAt)).digest("hex");
  return `${expiresAt}.${signature}`;
}

export function verifyToken(fileId: string, purpose: "upload" | "download", token: unknown) {
  if (typeof token !== "string") return false;
  const [expiresAtText, signature] = token.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) return false;

  const expected = signToken(fileId, purpose, expiresAt).split(".")[1];
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function makeSignedPath(fileId: string, purpose: "upload" | "download") {
  const expiresAt = Date.now() + signedUrlTtlMs;
  const token = signToken(fileId, purpose, expiresAt);
  const path = purpose === "upload" ? `/api/files/${fileId}/content?token=${encodeURIComponent(token)}` : `/api/files/${fileId}/content?download=1&token=${encodeURIComponent(token)}`;
  return {
    url: path,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function bodyToBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from([]);
}

function blockedChecksum(reason: string, buffer: Buffer) {
  return `blocked:${createHash("sha256").update(reason).update(buffer.subarray(0, 1024)).digest("hex")}`;
}

async function resolveOwner(ownerType: string, ownerId: string) {
  const normalizedType = ownerType.trim().toUpperCase();
  if (normalizedType === "PAYMENT_REQUEST") {
    const item = await prisma.paymentRequest.findFirst({
      where: {
        OR: [{ id: ownerId }, { requestCode: ownerId }],
      },
      include: {
        approvalSteps: true,
      },
    });
    return item ? { ownerType: "PAYMENT_REQUEST", ownerId: item.id, paymentRequest: item } : null;
  }

  if (normalizedType === "VENDOR") {
    const item = await prisma.vendor.findFirst({
      where: {
        OR: [{ id: ownerId }, { name: ownerId }, { businessNumber: ownerId }],
      },
    });
    return item ? { ownerType: "VENDOR", ownerId: item.id, vendor: item } : null;
  }

  return null;
}

async function canReadAttachment(user: AuthUser, attachment: { ownerType: string; ownerId: string; uploadedBy: string }) {
  if (user.id === attachment.uploadedBy || hasPermission(user, "*") || hasPermission(user, "system:manage")) return true;

  if (attachment.ownerType === "PAYMENT_REQUEST") {
    const item = await prisma.paymentRequest.findUnique({
      where: { id: attachment.ownerId },
      include: { approvalSteps: true },
    });
    if (!item) return false;
    return item.requesterId === user.id || hasPermission(user, "payment_request:read_all") || item.approvalSteps.some((step) => step.approverId === user.id);
  }

  if (attachment.ownerType === "VENDOR") {
    return hasPermission(user, "vendor:read") || hasPermission(user, "payment_request:read_all");
  }

  return false;
}

async function canWriteAttachment(user: AuthUser, owner: NonNullable<Awaited<ReturnType<typeof resolveOwner>>>) {
  if (hasPermission(user, "*") || hasPermission(user, "system:manage")) return true;

  if ("paymentRequest" in owner && owner.paymentRequest) {
    const item = owner.paymentRequest;
    return item.requesterId === user.id && (item.status === "DRAFT" || item.status === "REJECTED");
  }

  if ("vendor" in owner && owner.vendor) {
    return hasPermission(user, "vendor:read") || hasPermission(user, "payment_request:read_all");
  }

  return false;
}

function toFileDto(item: {
  id: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  byteSize: bigint | number;
  storageKey: string;
  checksum: string;
  uploadedBy: string;
  createdAt: Date;
}) {
  return {
    id: item.id,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    fileName: item.fileName,
    contentType: item.contentType,
    byteSize: Number(item.byteSize),
    storageKey: item.storageKey,
    checksum: item.checksum,
    scanStatus: attachmentScanStatus(item.checksum),
    canPreview: attachmentExtension(item.fileName) === ".pdf",
    createdAt: item.createdAt.toISOString(),
  };
}

function failFileSecurity(
  reply: FastifyReply,
  request: FastifyRequest,
  input: {
    eventType: string;
    errorCode: string;
    message: string;
    statusCode: number;
    user?: AuthUser | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  return failWithSecurityEvent(reply, {
    request,
    actorId: input.user?.id ?? null,
    eventType: input.eventType,
    errorCode: input.errorCode,
    message: input.message,
    statusCode: input.statusCode,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("image/png", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.post("/files/presign-upload", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const input = presignUploadSchema.safeParse(request.body);
    if (!input.success) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_upload_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "파일 업로드 정보를 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const fileError = validateAttachmentUploadPolicy(input.data);
    if (fileError) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_upload_rejected",
        errorCode: "VALIDATION_ERROR",
        message: fileError,
        statusCode: 400,
        targetType: input.data.ownerType,
        targetId: input.data.ownerId,
        metadata: {
          extension: attachmentExtension(input.data.fileName),
          contentType: input.data.contentType,
          byteSize: input.data.byteSize,
        },
      });
    }

    const owner = await resolveOwner(input.data.ownerType, input.data.ownerId);
    if (!owner) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_upload_rejected",
        errorCode: "NOT_FOUND",
        message: "파일 소유 업무 대상을 찾을 수 없습니다.",
        statusCode: 404,
        targetType: input.data.ownerType,
        targetId: input.data.ownerId,
      });
    }
    if (!(await canWriteAttachment(user, owner))) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "FORBIDDEN",
        message: "파일 업로드 권한이 없습니다.",
        statusCode: 403,
        targetType: owner.ownerType,
        targetId: owner.ownerId,
      });
    }

    const idempotencyKey = input.data.idempotencyKey;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.attachment.findUnique({ where: { id: existingRequest.entityId } });
        if (existingRequest.entityType === "attachment" && existingRequest.action === "presign_upload" && existingRequest.actorId === user.id && replay) {
          return reply.send(success(request, { file: toFileDto(replay), upload: makeSignedPath(replay.id, "upload") }, { idempotencyReplay: true }));
        }
        return failFileSecurity(reply, request, {
          user,
          eventType: "file_upload_rejected",
          errorCode: "IDEMPOTENCY_CONFLICT",
          message: "이미 다른 처리에 사용된 idempotencyKey입니다.",
          statusCode: 409,
          targetType: input.data.ownerType,
          targetId: input.data.ownerId,
          metadata: { idempotencyConflict: true },
        });
      }
    }

    const fileId = randomUUID();
    const storageKey = storageKeyFor(fileId, input.data.fileName);
    const item = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          id: fileId,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          fileName: input.data.fileName,
          contentType: input.data.contentType,
          byteSize: BigInt(input.data.byteSize),
          storageKey,
          checksum: input.data.checksum ?? "pending",
          uploadedBy: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "attachment",
          entityId: attachment.id,
          actorId: user.id,
          action: "presign_upload",
          afterValue: {
            fileName: attachment.fileName,
            ownerType: attachment.ownerType,
            ownerId: attachment.ownerId,
            byteSize: Number(attachment.byteSize),
          },
          idempotencyKey,
          ...auditRequestContext(request),
        },
      });
      return attachment;
    }).catch(async (error) => {
      if (idempotencyKey && isPrismaCode(error, "P2002")) {
        const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
        const replay = existingRequest ? await prisma.attachment.findUnique({ where: { id: existingRequest.entityId } }) : null;
        if (existingRequest?.entityType === "attachment" && existingRequest.action === "presign_upload" && existingRequest.actorId === user.id && replay) {
          return replay;
        }
      }
      throw error;
    });

    return reply.send(
      success(request, {
        file: toFileDto(item),
        upload: makeSignedPath(item.id, "upload"),
      }),
    );
  });

  app.put("/files/:id/content", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { token?: string };
    if (!verifyToken(params.id, "upload", query.token)) {
      return failFileSecurity(reply, request, {
        eventType: "file_signed_url_rejected",
        errorCode: "FORBIDDEN",
        message: "업로드 URL이 만료되었거나 올바르지 않습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: params.id,
        metadata: { purpose: "upload" },
      });
    }

    const item = await prisma.attachment.findUnique({ where: { id: params.id } });
    if (!item) {
      return failFileSecurity(reply, request, {
        eventType: "file_upload_rejected",
        errorCode: "NOT_FOUND",
        message: "파일 정보를 찾을 수 없습니다.",
        statusCode: 404,
        targetType: "ATTACHMENT",
        targetId: params.id,
      });
    }

    const uploadContentType = requestContentType(request);
    if (!isAllowedAttachmentContentType(item.fileName, uploadContentType) || comparableContentType(uploadContentType) !== comparableContentType(item.contentType)) {
      return failFileSecurity(reply, request, {
        eventType: "file_upload_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "업로드 본문 Content-Type이 사전 등록 정보와 일치하지 않습니다.",
        statusCode: 400,
        targetType: "ATTACHMENT",
        targetId: item.id,
        metadata: { registeredContentType: item.contentType, uploadContentType },
      });
    }

    const body = bodyToBuffer(request.body);
    let scanResult;
    try {
      scanResult = await scanAttachmentBuffer(body, item.fileName, item.contentType);
    } catch {
      return failFileSecurity(reply, request, {
        eventType: "file_scan_unavailable",
        errorCode: "SCAN_UNAVAILABLE",
        message: "파일 보안 검사를 완료하지 못했습니다.",
        statusCode: 502,
        targetType: "ATTACHMENT",
        targetId: item.id,
        metadata: { contentType: item.contentType, byteSize: body.length },
      });
    }
    if (scanResult.status === "blocked") {
      await prisma.$transaction(async (tx) => {
        const attachment = await tx.attachment.update({
          where: { id: item.id },
          data: {
            byteSize: BigInt(body.length),
            checksum: blockedChecksum(scanResult.reason, body),
          },
        });
        await tx.auditLog.create({
          data: {
            entityType: "attachment",
            entityId: item.id,
            actorId: item.uploadedBy,
            action: "scan_blocked",
            afterValue: {
              fileName: item.fileName,
              scanEngine: scanResult.engine,
              reason: scanResult.reason,
            },
            ...auditRequestContext(request),
          },
        });
        return attachment;
      });
      return failFileSecurity(reply, request, {
        eventType: "file_malware_blocked",
        errorCode: "MALWARE_BLOCKED",
        message: "파일이 보안 검사에서 차단되었습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
        metadata: { scanEngine: scanResult.engine, reason: scanResult.reason },
      });
    }

    const stored = await writeStoredFile(item.storageKey, body, item.contentType);
    const byteSize = stored.byteSize || (await storedByteSize(item.storageKey));
    if (byteSize > maxAttachmentBytes) {
      try {
        await deleteStoredFile(item.storageKey);
      } catch {
        // The upload is rejected; storage cleanup failures are captured by storage health/monitoring.
      }
      return failFileSecurity(reply, request, {
        eventType: "file_upload_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "파일은 최대 10MB까지 업로드할 수 있습니다.",
        statusCode: 400,
        targetType: "ATTACHMENT",
        targetId: item.id,
        metadata: { byteSize, maxAttachmentBytes },
      });
    }

    const updated = await prisma.attachment.update({
      where: { id: item.id },
      data: {
        byteSize: BigInt(byteSize),
        checksum: stored.checksum,
      },
    });

    return reply.send(success(request, toFileDto(updated)));
  });

  app.post("/files/complete", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const input = completeSchema.safeParse(request.body);
    if (!input.success) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_upload_rejected",
        errorCode: "VALIDATION_ERROR",
        message: "업로드 완료 정보를 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const item = await prisma.attachment.findUnique({ where: { id: input.data.fileId } });
    if (!item) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_upload_rejected",
        errorCode: "NOT_FOUND",
        message: "파일 정보를 찾을 수 없습니다.",
        statusCode: 404,
        targetType: "ATTACHMENT",
        targetId: input.data.fileId,
      });
    }
    if (!(await canReadAttachment(user, item))) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "FORBIDDEN",
        message: "파일 완료 처리 권한이 없습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }
    if (attachmentScanStatus(item.checksum) === "blocked") {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_malware_blocked",
        errorCode: "MALWARE_BLOCKED",
        message: "보안 검사에서 차단된 파일은 완료 처리할 수 없습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }

    const idempotencyKey = input.data.idempotencyKey;
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        const replay = await prisma.attachment.findUnique({ where: { id: existingRequest.entityId } });
        if (existingRequest.entityType === "attachment" && existingRequest.action === "complete_upload" && existingRequest.actorId === user.id && replay) {
          return reply.send(success(request, toFileDto(replay), { idempotencyReplay: true }));
        }
        return failFileSecurity(reply, request, {
          user,
          eventType: "file_upload_rejected",
          errorCode: "IDEMPOTENCY_CONFLICT",
          message: "이미 다른 처리에 사용된 idempotencyKey입니다.",
          statusCode: 409,
          targetType: "ATTACHMENT",
          targetId: item.id,
          metadata: { idempotencyConflict: true },
        });
      }
    }

    const byteSize = await storedByteSize(item.storageKey);
    const updated = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.update({
        where: { id: item.id },
        data: {
          checksum: input.data.checksum ?? item.checksum,
          byteSize: BigInt(byteSize || Number(item.byteSize)),
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "attachment",
          entityId: item.id,
          actorId: user.id,
          action: "complete_upload",
          afterValue: {
            fileName: attachment.fileName,
            checksum: attachment.checksum,
            byteSize: Number(attachment.byteSize),
          },
          idempotencyKey,
          ...auditRequestContext(request),
        },
      });
      return attachment;
    }).catch(async (error) => {
      if (idempotencyKey && isPrismaCode(error, "P2002")) {
        const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
        const replay = existingRequest ? await prisma.attachment.findUnique({ where: { id: existingRequest.entityId } }) : null;
        if (existingRequest?.entityType === "attachment" && existingRequest.action === "complete_upload" && existingRequest.actorId === user.id && replay) {
          return replay;
        }
      }
      throw error;
    });

    return reply.send(success(request, toFileDto(updated)));
  });

  app.get("/files", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const input = listFilesQuerySchema.safeParse(request.query);
    if (!input.success) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "VALIDATION_ERROR",
        message: "파일 조회 대상을 확인해주세요.",
        statusCode: 400,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const owner = await resolveOwner(input.data.ownerType, input.data.ownerId);
    if (!owner) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "NOT_FOUND",
        message: "파일 소유 업무 대상을 찾을 수 없습니다.",
        statusCode: 404,
        targetType: input.data.ownerType,
        targetId: input.data.ownerId,
      });
    }

    const items = await prisma.attachment.findMany({
      where: {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
      },
      orderBy: { createdAt: "desc" },
    });
    const visibleItems = [];
    for (const item of items) {
      if (await canReadAttachment(user, item)) visibleItems.push(toFileDto(item));
    }

    return reply.send(success(request, visibleItems));
  });

  app.get("/files/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const item = await prisma.attachment.findUnique({ where: { id: (request.params as { id: string }).id } });
    if (!item) return reply.send(success(request, null));
    if (!(await canReadAttachment(user, item))) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "FORBIDDEN",
        message: "파일 조회 권한이 없습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }
    return reply.send(success(request, toFileDto(item)));
  });

  app.get("/files/:id/download", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const input = downloadQuerySchema.safeParse(request.query);
    if (!input.success) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "VALIDATION_ERROR",
        message: "파일 다운로드 사유가 필요합니다.",
        statusCode: 400,
        targetType: "ATTACHMENT",
        targetId: (request.params as { id: string }).id,
        metadata: { issueCount: input.error.issues.length },
      });
    }

    const item = await prisma.attachment.findUnique({ where: { id: (request.params as { id: string }).id } });
    if (!item) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "NOT_FOUND",
        message: "파일 정보를 찾을 수 없습니다.",
        statusCode: 404,
        targetType: "ATTACHMENT",
        targetId: (request.params as { id: string }).id,
      });
    }
    if (!(await canReadAttachment(user, item))) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "FORBIDDEN",
        message: "파일 다운로드 권한이 없습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }
    if (attachmentScanStatus(item.checksum) === "blocked") {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_malware_blocked",
        errorCode: "FORBIDDEN",
        message: "보안 검사에서 차단된 파일입니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }

    const download = makeSignedPath(item.id, "download");
    const retentionPolicy = retentionPolicyFor("attachment_metadata");
    await prisma.auditLog.create({
      data: {
        entityType: "attachment",
        entityId: item.id,
        actorId: user.id,
        action: "download_request",
        afterValue: {
          fileName: item.fileName,
          ownerType: item.ownerType,
          ownerId: item.ownerId,
          byteSize: Number(item.byteSize),
          downloadUrlExpiresAt: download.expiresAt,
          retentionPolicy: retentionPolicy?.disposition ?? "첨부 metadata 보관 정책",
          accessLogRetention: retentionPolicyFor("audit_log")?.disposition ?? "감사 로그 보관 정책",
        },
        reason: input.data.reason,
        ...auditRequestContext(request),
      },
    });

    return reply.send(
      success(request, {
        file: toFileDto(item),
        download,
      }),
    );
  });

  app.get("/files/:id/content", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { token?: string };
    if (!verifyToken(params.id, "download", query.token)) {
      return failFileSecurity(reply, request, {
        eventType: "file_signed_url_rejected",
        errorCode: "FORBIDDEN",
        message: "다운로드 URL이 만료되었거나 올바르지 않습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: params.id,
        metadata: { purpose: "download" },
      });
    }

    const item = await prisma.attachment.findUnique({ where: { id: params.id } });
    if (!item) {
      return failFileSecurity(reply, request, {
        eventType: "file_access_denied",
        errorCode: "NOT_FOUND",
        message: "파일 정보를 찾을 수 없습니다.",
        statusCode: 404,
        targetType: "ATTACHMENT",
        targetId: params.id,
      });
    }
    if (attachmentScanStatus(item.checksum) === "blocked") {
      return failFileSecurity(reply, request, {
        eventType: "file_malware_blocked",
        errorCode: "FORBIDDEN",
        message: "보안 검사에서 차단된 파일입니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
        metadata: { purpose: "download" },
      });
    }

    const body = await readStoredFile(item.storageKey);
    reply.header("Content-Type", item.contentType);
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(item.fileName)}"`);
    return reply.send(body);
  });

  app.delete("/files/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const params = request.params as { id: string };
    const idempotencyKey = readStringValue(bodyRecord(request.body), "idempotencyKey");
    if (idempotencyKey) {
      const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
      if (existingRequest) {
        if (existingRequest.entityType === "attachment" && existingRequest.action === "delete" && existingRequest.entityId === params.id && existingRequest.actorId === user.id) {
          return reply.send(success(request, null, { deleted: true, idempotencyReplay: true }));
        }
        return failFileSecurity(reply, request, {
          user,
          eventType: "file_access_denied",
          errorCode: "IDEMPOTENCY_CONFLICT",
          message: "이미 다른 처리에 사용된 idempotencyKey입니다.",
          statusCode: 409,
          targetType: "ATTACHMENT",
          targetId: params.id,
          metadata: { idempotencyConflict: true },
        });
      }
    }

    const item = await prisma.attachment.findUnique({ where: { id: params.id } });
    if (!item) return reply.send(success(request, null));
    if (!(await canReadAttachment(user, item))) {
      return failFileSecurity(reply, request, {
        user,
        eventType: "file_access_denied",
        errorCode: "FORBIDDEN",
        message: "파일 삭제 권한이 없습니다.",
        statusCode: 403,
        targetType: "ATTACHMENT",
        targetId: item.id,
      });
    }

    if (item.ownerType === "PAYMENT_REQUEST") {
      const paymentRequest = await prisma.paymentRequest.findUnique({ where: { id: item.ownerId } });
      if (paymentRequest && !["DRAFT", "REJECTED"].includes(paymentRequest.status) && !hasPermission(user, "system:manage")) {
        return failFileSecurity(reply, request, {
          user,
          eventType: "file_access_denied",
          errorCode: "WORKFLOW_LOCKED",
          message: "제출 이후 파일 삭제는 관리자 복구 절차가 필요합니다.",
          statusCode: 409,
          targetType: "ATTACHMENT",
          targetId: item.id,
          metadata: { ownerType: item.ownerType, ownerId: item.ownerId, paymentStatus: paymentRequest.status },
        });
      }
    }

    const retentionPolicy = retentionPolicyFor("attachment_metadata");
    const deletionReason = hasPermission(user, "system:manage") ? "관리자 보관 예외 삭제" : "초안/반려 첨부 삭제";
    const deleted = await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          entityType: "attachment",
          entityId: item.id,
          actorId: user.id,
          action: "delete",
          beforeValue: {
            fileName: item.fileName,
            ownerType: item.ownerType,
            ownerId: item.ownerId,
            byteSize: Number(item.byteSize),
          },
          afterValue: {
            deleted: true,
            fileName: item.fileName,
            ownerType: item.ownerType,
            ownerId: item.ownerId,
            retentionPolicy: retentionPolicy?.disposition ?? "첨부 metadata 보관 정책",
            hardDeleteAllowed: retentionPolicy?.hardDeleteAllowed ?? false,
          },
          reason: deletionReason,
          idempotencyKey: idempotencyKey || undefined,
          ...auditRequestContext(request),
        },
      });
      return tx.attachment.delete({ where: { id: item.id } });
    }).catch(async (error) => {
      if (idempotencyKey && isPrismaCode(error, "P2002")) {
        const existingRequest = await prisma.auditLog.findUnique({ where: { idempotencyKey } });
        if (existingRequest?.entityType === "attachment" && existingRequest.action === "delete" && existingRequest.entityId === item.id && existingRequest.actorId === user.id) {
          return item;
        }
      }
      throw error;
    });

    try {
      await deleteStoredFile(item.storageKey);
    } catch {
      // Metadata deletion is authoritative; missing local object is reported through audit/monitoring in production adapters.
    }

    return reply.send(success(request, toFileDto(deleted), { deleted: true }));
  });
};
