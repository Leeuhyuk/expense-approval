import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { retentionPolicyFor } from "../domain/retentionPolicy.js";

export type PrivacyAccessChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  owner: string;
  detail: string;
  evidence: string;
};

export type PrivacyInventoryItem = {
  id: string;
  label: string;
  count: number;
  storage: string;
  protection: string;
  retention: string;
  accessControl: string;
};

export type PrivacyAccessEvent = {
  id: string;
  time: string;
  actorName: string;
  actorDepartment: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string;
  requestId: string;
  scope: "file_download" | "external_auditor" | "privacy_review";
  rawValuePolicy: string;
};

type PrivacyAccessDb = PrismaClient;

function monthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { label: start.toISOString().slice(0, 7), start, end };
}

function retentionLabel(entityType: string) {
  const policy = retentionPolicyFor(entityType);
  if (!policy) return "운영 보관 정책";
  return `${policy.retentionDays}일 · ${policy.disposition}`;
}

function isExternalAuditor(log: { actor?: { roles?: Array<{ role: { code: string; permissions: unknown } }> } | null }) {
  return log.actor?.roles?.some(({ role }) => role.code === "AUDITOR") ?? false;
}

export async function getPrivacyAccessReport(db: PrivacyAccessDb = prisma, now = new Date()) {
  const period = monthRange(now);
  const [activeUsers, inactiveUsers, vendors, encryptedVendors, attachments, reportRuns, downloadLogs, auditorLogs] = await Promise.all([
    db.user.count({ where: { isActive: true } }),
    db.user.count({ where: { isActive: false } }),
    db.vendor.count(),
    db.vendor.count({ where: { bankAccountEncrypted: { not: "" }, bankAccountMasked: { not: "" } } }),
    db.attachment.count(),
    db.reportRun.count({ where: { createdAt: { gte: period.start, lt: period.end } } }),
    db.auditLog.findMany({
      where: {
        action: "download_request",
        createdAt: { gte: period.start, lt: period.end },
      },
      include: {
        actor: {
          include: {
            department: true,
            roles: { include: { role: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.auditLog.findMany({
      where: {
        createdAt: { gte: period.start, lt: period.end },
        actor: { roles: { some: { role: { code: "AUDITOR" } } } },
      },
      include: {
        actor: {
          include: {
            department: true,
            roles: { include: { role: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const inventory: PrivacyInventoryItem[] = [
    {
      id: "users",
      label: "사용자 계정/부서/권한",
      count: activeUsers + inactiveUsers,
      storage: "PostgreSQL users, departments, user_roles",
      protection: "세션 기반 접근 제어와 권한 변경 시 세션 revoke",
      retention: retentionLabel("audit_log"),
      accessControl: "system:manage 관리자만 설정 변경",
    },
    {
      id: "vendors",
      label: "거래처와 계좌 metadata",
      count: vendors,
      storage: "PostgreSQL vendors",
      protection: "계좌번호 AES-GCM 암호화, 목록/감사 요약 maskedAccountNumber 사용",
      retention: "거래처 지급 이력 보관 정책",
      accessControl: "vendor:read, disbursement:execute 통제",
    },
    {
      id: "attachments",
      label: "첨부 metadata와 증빙 파일",
      count: attachments,
      storage: "Attachment metadata + private object storage",
      protection: "signed API path, malware scan, object storage 직접 URL 미노출",
      retention: retentionLabel("attachment"),
      accessControl: "업무 owner별 파일 권한 검증",
    },
    {
      id: "report_runs",
      label: "보고서 산출물과 다운로드",
      count: reportRuns,
      storage: "ReportRun summary/artifact metadata",
      protection: "보고서 다운로드 row/size 제한과 감사 로그",
      retention: retentionLabel("report_run"),
      accessControl: "report:read 또는 감사 read-only 권한",
    },
  ];

  const accessEvents: PrivacyAccessEvent[] = downloadLogs.map((log) => ({
    id: log.id,
    time: log.createdAt.toISOString(),
    actorName: log.actor?.name ?? "unknown",
    actorDepartment: log.actor?.department.name ?? "-",
    entityType: log.entityType,
    entityId: log.entityId,
    action: log.action,
    reason: log.reason ?? "",
    requestId: log.requestId,
    scope: isExternalAuditor(log) ? "external_auditor" : "file_download",
    rawValuePolicy: "beforeValue/afterValue 원문과 signed URL token은 접근 리포트 응답에 포함하지 않습니다.",
  }));
  const externalAuditorEvents: PrivacyAccessEvent[] = auditorLogs.map((log) => ({
    id: log.id,
    time: log.createdAt.toISOString(),
    actorName: log.actor?.name ?? "unknown",
    actorDepartment: log.actor?.department.name ?? "-",
    entityType: log.entityType,
    entityId: log.entityId,
    action: log.action,
    reason: log.reason ?? "",
    requestId: log.requestId,
    scope: "external_auditor",
    rawValuePolicy: "외부 감사 접근 리포트는 요약 필드만 제공하고 원문 JSON을 제외합니다.",
  }));
  const missingDownloadReasons = accessEvents.filter((event) => !event.reason.trim()).length;
  const checklist: PrivacyAccessChecklistItem[] = [
    {
      id: "inventory_present",
      label: "개인정보 처리 현황",
      ok: inventory.every((item) => item.count >= 0 && item.protection.length > 0),
      owner: "개인정보 보호 책임자",
      detail: `처리 항목 ${inventory.length}개, 활성 사용자 ${activeUsers}명, 거래처 ${vendors}건`,
      evidence: "User/Vendor/Attachment/ReportRun inventory",
    },
    {
      id: "vendor_bank_encrypted",
      label: "거래처 계좌 암호화/마스킹",
      ok: vendors === 0 || encryptedVendors === vendors,
      owner: "재무 보안",
      detail: `암호화/마스킹 계좌 ${encryptedVendors}/${vendors}건`,
      evidence: "Vendor.bankAccountEncrypted + bankAccountMasked",
    },
    {
      id: "download_reason_required",
      label: "파일 접근 사유 기록",
      ok: missingDownloadReasons === 0,
      owner: "감사 운영",
      detail: `${period.label} 다운로드 접근 ${accessEvents.length}건, 사유 누락 ${missingDownloadReasons}건`,
      evidence: "AuditLog action=download_request reason",
    },
    {
      id: "auditor_read_only",
      label: "외부 감사 접근 분리",
      ok: externalAuditorEvents.every((event) => !["create", "update", "delete", "execute", "approve", "reject"].includes(event.action)),
      owner: "보안 운영",
      detail: `${period.label} 외부 감사 접근 ${externalAuditorEvents.length}건`,
      evidence: "AuditLog actor role=AUDITOR",
    },
  ];

  return {
    ok: checklist.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    period: {
      month: period.label,
      start: period.start.toISOString(),
      endExclusive: period.end.toISOString(),
    },
    summary: {
      inventoryItems: inventory.length,
      activeUsers,
      inactiveUsers,
      vendors,
      encryptedVendors,
      attachments,
      reportRuns,
      downloadAccessEvents: accessEvents.length,
      externalAuditorEvents: externalAuditorEvents.length,
      missingDownloadReasons,
      checklistPassed: checklist.filter((item) => item.ok).length,
      checklistTotal: checklist.length,
    },
    inventory,
    accessEvents,
    externalAuditorEvents,
    checklist,
    rawValuePolicy: "개인정보 처리/외부 감사 접근 리포트는 beforeValue, afterValue, 계좌 원문, signed URL token을 반환하지 않습니다.",
  };
}
