import { extname } from "node:path";

export const maxAttachmentBytes = 10 * 1024 * 1024;

// 텍스트 계열은 OS/브라우저마다 Content-Type을 다르게(또는 비워서) 보내므로 관용적으로 허용한다.
const textContentTypes = ["text/plain", "application/octet-stream", ""];

export const allowedAttachmentContentTypesByExtension = new Map<string, string[]>([
  [".pdf", ["application/pdf"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  [".txt", textContentTypes],
  [".log", textContentTypes],
  [".md", ["text/markdown", ...textContentTypes]],
  [".csv", ["text/csv", "application/vnd.ms-excel", ...textContentTypes]],
  [".json", ["application/json", ...textContentTypes]],
]);

export function attachmentExtension(fileName: string) {
  return extname(fileName).toLowerCase();
}

function normalizeContentType(contentType: string) {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isAllowedAttachmentContentType(fileName: string, contentType: string) {
  const allowedTypes = allowedAttachmentContentTypesByExtension.get(attachmentExtension(fileName));
  if (!allowedTypes) return false;
  return allowedTypes.includes(normalizeContentType(contentType));
}

export function validateAttachmentUploadPolicy(input: { fileName: string; byteSize: number; contentType: string }) {
  if (!allowedAttachmentContentTypesByExtension.has(attachmentExtension(input.fileName))) {
    return "허용되지 않는 파일 형식입니다.";
  }
  if (!isAllowedAttachmentContentType(input.fileName, input.contentType)) {
    return "파일 Content-Type이 확장자와 일치하지 않습니다.";
  }
  if (input.byteSize > maxAttachmentBytes) {
    return "파일은 최대 10MB까지 업로드할 수 있습니다.";
  }
  return "";
}

export function isBlockedAttachmentChecksum(checksum: string) {
  return checksum.startsWith("blocked:");
}

export function attachmentScanStatus(checksum: string) {
  if (checksum === "pending") return "pending";
  if (isBlockedAttachmentChecksum(checksum)) return "blocked";
  return "clean";
}
