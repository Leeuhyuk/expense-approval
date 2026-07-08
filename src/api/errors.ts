import type { ApiResponse } from "./contracts";

export class ApiRequestError extends Error {
  code: string;
  requestId?: string;

  constructor(code: string, message: string, requestId?: string) {
    super(requestId ? `${code}: ${message} (requestId: ${requestId})` : `${code}: ${message}`);
    this.name = "ApiRequestError";
    this.code = code;
    this.requestId = requestId;
  }
}

export function errorFromApiResponse(payload: ApiResponse<unknown>) {
  if (payload.status !== "error") return null;
  return new ApiRequestError(payload.error.code, payload.error.message, payload.meta?.requestId);
}
