import type { FastifyReply, FastifyRequest } from "fastify";
import { fail } from "../utils/response.js";

export type OperationMode = "normal" | "read_only" | "payments_paused" | "uploads_paused" | "maintenance";
export type OperationCapability = "business_mutations" | "payments" | "file_uploads";

export type OperationModeRestriction = {
  capability: OperationCapability;
  label: string;
  summary: string;
};

export type OperationModeStatus = {
  mode: OperationMode;
  label: string;
  active: boolean;
  readOnly: boolean;
  disabledCapabilities: OperationCapability[];
  restrictions: OperationModeRestriction[];
  source: {
    operationMode: string;
    disabledCapabilities: string;
  };
  generatedAt: string;
};

type RequestRestriction = OperationModeRestriction & {
  status: OperationModeStatus;
};

const modeLabels: Record<OperationMode, string> = {
  normal: "정상 운영",
  read_only: "읽기 전용 운영",
  payments_paused: "지급 일시 중지",
  uploads_paused: "파일 업로드 중지",
  maintenance: "점검 모드",
};

const restrictionDetails: Record<OperationCapability, OperationModeRestriction> = {
  business_mutations: {
    capability: "business_mutations",
    label: "업무 변경 차단",
    summary: "조회와 인증 유지 route를 제외한 생성/수정/삭제/상태 변경 API를 차단합니다.",
  },
  payments: {
    capability: "payments",
    label: "지급 변경 차단",
    summary: "지급 실행, 보류, 재처리, 계좌 재확인, 지급 예정일 변경, 은행 결과 대사를 차단합니다.",
  },
  file_uploads: {
    capability: "file_uploads",
    label: "파일 업로드 차단",
    summary: "업로드 presign, signed content PUT, 업로드 완료 처리를 차단합니다. 기존 파일 조회/다운로드는 유지됩니다.",
  },
};

function normalizeMode(value: string | undefined): OperationMode {
  const normalized = (value ?? "normal").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "readonly") return "read_only";
  if (normalized === "read_only") return "read_only";
  if (normalized === "payments_paused" || normalized === "payment_paused") return "payments_paused";
  if (normalized === "uploads_paused" || normalized === "upload_paused" || normalized === "file_uploads_paused") return "uploads_paused";
  if (normalized === "maintenance") return "maintenance";
  return "normal";
}

function addDisabledCapability(disabled: Set<OperationCapability>, value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "business_mutations" || normalized === "mutations" || normalized === "read_only") disabled.add("business_mutations");
  if (normalized === "payments" || normalized === "disbursements" || normalized === "payments_paused") disabled.add("payments");
  if (normalized === "file_uploads" || normalized === "uploads" || normalized === "files" || normalized === "uploads_paused") disabled.add("file_uploads");
}

function disabledCapabilitiesFor(mode: OperationMode, rawDisabled: string | undefined) {
  const disabled = new Set<OperationCapability>();
  if (mode === "read_only" || mode === "maintenance") {
    disabled.add("business_mutations");
    disabled.add("payments");
    disabled.add("file_uploads");
  }
  if (mode === "payments_paused") disabled.add("payments");
  if (mode === "uploads_paused") disabled.add("file_uploads");
  for (const item of (rawDisabled ?? "").split(",")) addDisabledCapability(disabled, item);
  return Array.from(disabled);
}

export function getOperationModeStatus(now = new Date()): OperationModeStatus {
  const mode = normalizeMode(process.env.ERP_OPERATION_MODE);
  const disabledCapabilities = disabledCapabilitiesFor(mode, process.env.ERP_DISABLED_CAPABILITIES);
  return {
    mode,
    label: modeLabels[mode],
    active: mode !== "normal" || disabledCapabilities.length > 0,
    readOnly: disabledCapabilities.includes("business_mutations"),
    disabledCapabilities,
    restrictions: disabledCapabilities.map((capability) => restrictionDetails[capability]),
    source: {
      operationMode: "ERP_OPERATION_MODE",
      disabledCapabilities: "ERP_DISABLED_CAPABILITIES",
    },
    generatedAt: now.toISOString(),
  };
}

function requestPath(request: FastifyRequest) {
  return request.url.split("?")[0] || "/";
}

function isSafeMethod(method: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isAuthPath(path: string) {
  return path.startsWith("/api/auth/");
}

function isModeEndpoint(path: string) {
  return path === "/api/operations/mode";
}

function isFileUploadMutation(path: string, method: string) {
  const upperMethod = method.toUpperCase();
  if (upperMethod === "POST" && (path === "/api/files/presign-upload" || path === "/api/files/complete")) return true;
  return upperMethod === "PUT" && /^\/api\/files\/[^/]+\/content$/.test(path);
}

function isPaymentMutation(path: string, method: string) {
  return !isSafeMethod(method) && path.startsWith("/api/disbursements");
}

export function operationRestrictionForRequest(request: FastifyRequest, status = getOperationModeStatus()): RequestRestriction | null {
  if (!status.active || isSafeMethod(request.method)) return null;
  const path = requestPath(request);
  if (isAuthPath(path) || isModeEndpoint(path)) return null;

  if (status.disabledCapabilities.includes("business_mutations") && path.startsWith("/api/")) {
    return { ...restrictionDetails.business_mutations, status };
  }

  if (status.disabledCapabilities.includes("payments") && isPaymentMutation(path, request.method)) {
    return { ...restrictionDetails.payments, status };
  }

  if (status.disabledCapabilities.includes("file_uploads") && isFileUploadMutation(path, request.method)) {
    return { ...restrictionDetails.file_uploads, status };
  }

  return null;
}

export async function enforceOperationModeRestriction(request: FastifyRequest, reply: FastifyReply) {
  const restriction = operationRestrictionForRequest(request);
  if (!restriction) return;
  return fail(
    reply,
    "OPERATION_MODE_RESTRICTED",
    `${restriction.status.label}: ${restriction.summary}`,
    restriction.status.mode === "maintenance" ? 503 : 423,
  );
}
