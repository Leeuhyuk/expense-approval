import type { FastifyReply, FastifyRequest } from "fastify";

function replyRequestId(reply: FastifyReply) {
  const request = (reply as FastifyReply & { request?: FastifyRequest }).request;
  if (!request) return undefined;
  return typeof request.id === "string" ? request.id : String(request.id);
}

export function success<T>(request: FastifyRequest, data: T, meta: Record<string, unknown> = {}) {
  return {
    status: "success" as const,
    data,
    meta: {
      requestId: request.id,
      ...meta,
    },
  };
}

export function fail(reply: FastifyReply, code: string, message: string, statusCode = 400) {
  const requestId = replyRequestId(reply);
  return reply.status(statusCode).send({
    status: "error",
    error: {
      code,
      message,
    },
    ...(requestId ? { meta: { requestId } } : {}),
  });
}
