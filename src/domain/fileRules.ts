import type { AttachmentDraft } from "../types";

export const allowedAttachmentExtensions = ["pdf", "jpg", "jpeg", "png", "xlsx", "txt", "log", "md", "csv", "json"] as const;
export const maxAttachmentBytes = 10 * 1024 * 1024;
export const attachmentSecurityPolicy = {
  virusScanRequired: true,
  pdfPreviewEnabled: true,
  taxInvoiceRetentionYears: 5,
  taxInvoiceRequiredKeywords: ["세금계산서", "tax-invoice", "invoice"],
} as const;

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function createAttachmentId(file: File, index: number) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${file.name}-${file.lastModified}-${index}`;
}

export function formatFileSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

export function validateAttachmentFile(file: File) {
  const extension = getExtension(file.name);
  if (!allowedAttachmentExtensions.includes(extension as (typeof allowedAttachmentExtensions)[number])) {
    return `${file.name}: 허용되지 않는 파일 형식입니다.`;
  }
  if (file.size > maxAttachmentBytes) {
    return `${file.name}: 최대 10MB까지 업로드할 수 있습니다.`;
  }
  return "";
}

export function shouldVirusScanAttachment(fileName: string) {
  return attachmentSecurityPolicy.virusScanRequired && allowedAttachmentExtensions.includes(getExtension(fileName) as (typeof allowedAttachmentExtensions)[number]);
}

export function canPreviewAttachment(fileName: string) {
  return attachmentSecurityPolicy.pdfPreviewEnabled && getExtension(fileName) === "pdf";
}

export function classifyAttachmentFile(fileName: string) {
  const normalizedName = fileName.toLowerCase();
  if (attachmentSecurityPolicy.taxInvoiceRequiredKeywords.some((keyword) => normalizedName.includes(keyword.toLowerCase()))) {
    return "tax-invoice";
  }
  if (normalizedName.includes("견적") || normalizedName.includes("quote")) return "quote";
  if (normalizedName.includes("계약") || normalizedName.includes("contract")) return "contract";
  if (normalizedName.includes("영수") || normalizedName.includes("receipt")) return "receipt";
  return "evidence";
}

export function prepareAttachmentDrafts(files: File[]) {
  const accepted: AttachmentDraft[] = [];
  const rejected: string[] = [];

  files.forEach((file, index) => {
    const error = validateAttachmentFile(file);
    if (error) {
      rejected.push(error);
      return;
    }

    accepted.push({
      id: createAttachmentId(file, index),
      fileName: file.name,
      byteSize: file.size,
      status: "ready",
    });
  });

  return { accepted, rejected };
}
