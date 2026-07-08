import type { FastifyReply, FastifyRequest } from "fastify";
import { failWithFailureSecurityEvent } from "./securityEvents.js";

export function createServerErrorHandler() {
  return async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err: error, requestId: request.id }, "unhandled server error");

    if (reply.sent) return;

    await failWithFailureSecurityEvent(reply, {
      request,
      eventType: "server_failure",
      errorCode: "SERVER_ERROR",
      message: "서버 오류가 발생했습니다. requestId를 운영자에게 전달해주세요.",
      statusCode: 500,
      metadata: {
        errorName: error.name,
      },
    });
  };
}
