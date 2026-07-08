import { ReportRunStatus, type PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { notificationRetentionDays } from "./notificationRetention.js";

const dayMs = 24 * 60 * 60 * 1000;

export type RetentionEntityType = "audit_log" | "notification" | "attachment_metadata" | "report_artifact";
export type RetentionSeverity = "info" | "warning" | "critical";

export type RetentionPolicy = {
  entityType: RetentionEntityType;
  label: string;
  retentionDays: number | null;
  clockField: string;
  immutable: boolean;
  hardDeleteAllowed: boolean;
  legalHoldSupported: boolean;
  disposition: string;
  protectedFields: string[];
  operatorAction: string;
};

export type RetentionPolicyRow = RetentionPolicy & {
  retentionLabel: string;
  deletionPolicy: string;
};

export type RetentionCheck = {
  id: string;
  label: string;
  ok: boolean;
  severity: RetentionSeverity;
  count: number;
  detail: string;
  action: string;
};

export const retentionPolicyVersion = "2026-07-07";

export const retentionPolicies: RetentionPolicy[] = [
  {
    entityType: "audit_log",
    label: "감사 로그",
    retentionDays: 2555,
    clockField: "createdAt",
    immutable: true,
    hardDeleteAllowed: false,
    legalHoldSupported: true,
    disposition: "7년 보관 후 감사/법무 승인 기반 아카이브",
    protectedFields: ["entityType", "entityId", "actorId", "action", "beforeValue", "afterValue", "requestId", "createdAt"],
    operatorAction: "보관 만료 대상은 외부 WORM 또는 감사 저장소로 내보낸 뒤 운영 DB에서는 별도 승인 없이는 삭제하지 않습니다.",
  },
  {
    entityType: "notification",
    label: "알림",
    retentionDays: notificationRetentionDays,
    clockField: "expiresAt",
    immutable: false,
    hardDeleteAllowed: true,
    legalHoldSupported: false,
    disposition: `${notificationRetentionDays}일 후 만료, 읽음 상태는 업무 이력으로 보지 않음`,
    protectedFields: ["userId", "type", "entityType", "entityId", "createdAt"],
    operatorAction: "만료 알림은 정기 정리 작업으로 삭제할 수 있고, 원 업무 이력은 감사 로그와 업무 테이블에서 확인합니다.",
  },
  {
    entityType: "attachment_metadata",
    label: "첨부 파일 metadata",
    retentionDays: 2555,
    clockField: "createdAt",
    immutable: true,
    hardDeleteAllowed: false,
    legalHoldSupported: true,
    disposition: "제출 이후 업무 증빙 metadata 7년 보관, 초안 삭제/복구 예외는 감사 로그 필수",
    protectedFields: ["ownerType", "ownerId", "fileName", "contentType", "byteSize", "storageKey", "checksum", "uploadedBy", "createdAt"],
    operatorAction: "제출 이후 첨부는 업무 잠금 상태로 보고, 초안 삭제 또는 관리자 복구 삭제는 감사 로그와 보관 예외 사유를 남겨야 합니다.",
  },
  {
    entityType: "report_artifact",
    label: "보고서 산출물",
    retentionDays: 1095,
    clockField: "createdAt",
    immutable: true,
    hardDeleteAllowed: false,
    legalHoldSupported: true,
    disposition: "3년 보관 후 EXPIRED 상태 전환, 실행 기록은 삭제하지 않음",
    protectedFields: ["definitionId", "createdBy", "name", "type", "periodStart", "periodEnd", "artifactKey", "rowCount", "createdAt"],
    operatorAction: "사용자 삭제는 물리 삭제가 아니라 EXPIRED 상태 전환으로 처리하고 다운로드/수정 이력은 감사 로그에 보관합니다.",
  },
];

export function retentionPolicyFor(entityType: string) {
  return retentionPolicies.find((policy) => policy.entityType === entityType);
}

export function retentionCutoffDate(retentionDays: number | null, now = new Date()) {
  return retentionDays === null ? null : new Date(now.getTime() - retentionDays * dayMs);
}

export function retentionDeadline(createdAt: Date, retentionDays: number | null) {
  return retentionDays === null ? null : new Date(createdAt.getTime() + retentionDays * dayMs);
}

export function retentionPolicyRows(): RetentionPolicyRow[] {
  return retentionPolicies.map((policy) => ({
    ...policy,
    retentionLabel: policy.retentionDays === null ? "무기한" : `${policy.retentionDays}일`,
    deletionPolicy: policy.entityType === "attachment_metadata"
      ? "제출 이후 물리 삭제 금지"
      : policy.hardDeleteAllowed ? "만료 후 정리 가능" : "물리 삭제 금지",
  }));
}

function retentionCheck(input: Omit<RetentionCheck, "ok">): RetentionCheck {
  return { ...input, ok: input.count === 0 };
}

async function countOlderThan(
  db: Pick<PrismaClient, "auditLog" | "attachment" | "reportRun">,
  entityType: Exclude<RetentionEntityType, "notification">,
  now: Date,
) {
  const policy = retentionPolicyFor(entityType);
  const cutoff = retentionCutoffDate(policy?.retentionDays ?? null, now);
  if (!cutoff) return 0;
  if (entityType === "audit_log") return db.auditLog.count({ where: { createdAt: { lte: cutoff } } });
  if (entityType === "attachment_metadata") return db.attachment.count({ where: { createdAt: { lte: cutoff } } });
  return db.reportRun.count({
    where: {
      createdAt: { lte: cutoff },
      status: { not: ReportRunStatus.EXPIRED },
    },
  });
}

export async function getRetentionPolicySummary(
  db: Pick<PrismaClient, "auditLog" | "notification" | "attachment" | "reportRun"> = prisma,
  now = new Date(),
) {
  const [auditDue, expiredNotifications, attachmentDue, reportDue, auditLogs, notifications, attachments, reportRuns] = await Promise.all([
    countOlderThan(db, "audit_log", now),
    db.notification.count({ where: { expiresAt: { lte: now } } }),
    countOlderThan(db, "attachment_metadata", now),
    countOlderThan(db, "report_artifact", now),
    db.auditLog.count(),
    db.notification.count(),
    db.attachment.count(),
    db.reportRun.count(),
  ]);

  const checks: RetentionCheck[] = [
    retentionCheck({
      id: "audit_log_archive_due",
      label: "감사 로그 아카이브 대상",
      severity: "warning",
      count: auditDue,
      detail: "7년 보관 기한을 넘긴 감사 로그는 삭제가 아니라 감사 저장소 이관 검토 대상입니다.",
      action: "아카이브 완료 증적과 법무/감사 승인 번호를 남깁니다.",
    }),
    retentionCheck({
      id: "expired_notifications",
      label: "만료 알림 정리 대상",
      severity: "info",
      count: expiredNotifications,
      detail: "expiresAt이 지난 알림은 사용자 목록에서 제외되며 정기 정리 작업으로 삭제할 수 있습니다.",
      action: "야간 배치 또는 운영 정리 작업에서 삭제합니다.",
    }),
    retentionCheck({
      id: "attachment_metadata_archive_due",
      label: "첨부 metadata 보관 검토 대상",
      severity: "warning",
      count: attachmentDue,
      detail: "7년을 넘긴 첨부 metadata는 증빙 보관 대상이며 원본 삭제와 분리해 관리해야 합니다.",
      action: "소유 업무, checksum, storageKey를 외부 보관 목록과 대사합니다.",
    }),
    retentionCheck({
      id: "report_artifact_expire_due",
      label: "보고서 산출물 만료 전환 대상",
      severity: "warning",
      count: reportDue,
      detail: "3년을 넘긴 활성 보고서 산출물은 물리 삭제가 아니라 EXPIRED 상태로 전환해야 합니다.",
      action: "보고서 예약/공유 사용자에게 영향 여부를 확인한 뒤 상태 전환합니다.",
    }),
  ];
  const triggered = checks.filter((check) => !check.ok);

  return {
    ok: triggered.every((check) => check.severity !== "critical"),
    actionRequired: triggered.length > 0,
    generatedAt: now.toISOString(),
    policyVersion: retentionPolicyVersion,
    summary: {
      auditLogs,
      notifications,
      attachments,
      reportRuns,
      immutablePolicies: retentionPolicies.filter((policy) => policy.immutable).length,
      hardDeleteAllowedPolicies: retentionPolicies.filter((policy) => policy.hardDeleteAllowed).length,
      triggeredChecks: triggered.length,
    },
    policies: retentionPolicyRows(),
    checks,
    triggered,
  };
}
