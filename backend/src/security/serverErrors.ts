import type { FastifyReply, FastifyRequest } from "fastify";
import { failWithFailureSecurityEvent } from "./securityEvents.js";

export function createServerErrorHandler() {
  return async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err: error, requestId: request.id }, "unhandled server error");

    if (reply.sent) return;

    // Fastify 파서/검증 오류(4xx)는 클라이언트 잘못이므로 500으로 승격하지 않는다.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      await failWithFailureSecurityEvent(reply, {
        request,
        eventType: "request_rejected",
        errorCode: "BAD_REQUEST",
        message: "요청 형식이 올바르지 않습니다. 입력 값을 확인해주세요.",
        statusCode,
        metadata: {
          errorName: error.name,
        },
      });
      return;
    }

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
