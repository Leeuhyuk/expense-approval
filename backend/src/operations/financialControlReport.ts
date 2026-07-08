import type { PrismaClient } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.js";
import { getFinancialReconciliationSummary } from "./financialReconciliation.js";
import { getManualRecoverySummary } from "./manualRecovery.js";

export type FinancialControlExceptionSeverity = "info" | "warning" | "critical";

export type FinancialControlException = {
  id: string;
  severity: FinancialControlExceptionSeverity;
  label: string;
  scope: string;
  detail: string;
  source: string;
  linkPath: string;
};

export type MonthEndChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  owner: string;
  detail: string;
  evidence: string;
};

type FinancialControlDb = PrismaClient;

function monthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    label: start.toISOString().slice(0, 7),
    start,
    end,
  };
}

function checklist(input: Omit<MonthEndChecklistItem, "ok"> & { ok: boolean }): MonthEndChecklistItem {
  return input;
}

export async function getFinancialControlReport(db: FinancialControlDb = prisma, now = new Date()) {
  const period = monthRange(now);
  const [reconciliation, manualRecoveries, bankReconcileLogs, disbursementAuditLogs] = await Promise.all([
    getFinancialReconciliationSummary(db),
    getManualRecoverySummary(db),
    db.auditLog.findMany({
      where: {
        action: "bank_result_reconcile",
        createdAt: { gte: period.start, lt: period.end },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, afterValue: true, reason: true },
    }),
    db.auditLog.findMany({
      where: {
        entityType: "disbursement",
        action: { in: ["execute", "hold", "retry", "verify", "reschedule"] },
        createdAt: { gte: period.start, lt: period.end },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, action: true, createdAt: true, reason: true },
    }),
  ]);

  const exceptions: FinancialControlException[] = [];
  for (const mismatch of reconciliation.mismatches.slice(0, 30)) {
    exceptions.push({
      id: `reconciliation-${mismatch.id}`,
      severity: mismatch.severity,
      label: mismatch.label,
      scope: mismatch.scope,
      detail: mismatch.detail,
      source: "financial_reconciliation",
      linkPath: mismatch.linkPath,
    });
  }
  for (const item of manualRecoveries.pending) {
    exceptions.push({
      id: `manual-recovery-pending-${item.id}`,
      severity: "warning",
      label: "수동 복구 승인 대기",
      scope: String(item.targetCode || item.id),
      detail: String(item.reason || "2차 승인 대기"),
      source: "manual_recovery",
      linkPath: "#settings",
    });
  }

  const bankReconcileCount = bankReconcileLogs.length;
  const manualRecoveryPending = manualRecoveries.summary.pending;
  const manualRecoveryClosed = manualRecoveries.summary.approved + manualRecoveries.summary.rejected;
  const criticalExceptions = exceptions.filter((item) => item.severity === "critical").length;
  const warningExceptions = exceptions.filter((item) => item.severity === "warning").length;
  const checklistItems: MonthEndChecklistItem[] = [
    checklist({
      id: "financial_reconciliation_clear",
      label: "예산/지급/보고서 대사",
      ok: reconciliation.summary.criticalMismatchCount === 0,
      owner: "재무 운영",
      detail: `critical ${reconciliation.summary.criticalMismatchCount}건, warning ${reconciliation.summary.warningMismatchCount}건`,
      evidence: "GET /api/operations/financial-reconciliation",
    }),
    checklist({
      id: "manual_recovery_closed",
      label: "수동 복구 대기 해소",
      ok: manualRecoveryPending === 0,
      owner: "관리자",
      detail: `대기 ${manualRecoveryPending}건, 처리 ${manualRecoveryClosed}건`,
      evidence: "GET /api/operations/manual-recoveries",
    }),
    checklist({
      id: "bank_result_reconcile_reviewed",
      label: "은행 결과 대사 검토",
      ok: bankReconcileCount > 0,
      owner: "재무팀",
      detail: `${period.label} 은행 결과 대사 감사 로그 ${bankReconcileCount}건`,
      evidence: "AuditLog action=bank_result_reconcile",
    }),
    checklist({
      id: "disbursement_audit_reviewed",
      label: "지급 변경 감사 로그 검토",
      ok: disbursementAuditLogs.length > 0,
      owner: "재무팀",
      detail: `${period.label} 지급 변경 감사 로그 ${disbursementAuditLogs.length}건`,
      evidence: "AuditLog entityType=disbursement",
    }),
    checklist({
      id: "report_snapshot_reviewed",
      label: "보고서 스냅샷 대사",
      ok: reconciliation.summary.reportSnapshotsReviewed > 0,
      owner: "보고서 운영",
      detail: `검토 보고서 ${reconciliation.summary.reportRunsReviewed}건, 스냅샷 ${reconciliation.summary.reportSnapshotsReviewed}건`,
      evidence: "ReportRun summary drilldown snapshot",
    }),
  ];

  return {
    ok: criticalExceptions === 0 && checklistItems.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    period: {
      month: period.label,
      start: period.start.toISOString(),
      endExclusive: period.end.toISOString(),
    },
    summary: {
      exceptions: exceptions.length,
      criticalExceptions,
      warningExceptions,
      manualRecoveryPending,
      manualRecoveryClosed,
      bankReconcileCount,
      disbursementAuditCount: disbursementAuditLogs.length,
      checklistPassed: checklistItems.filter((item) => item.ok).length,
      checklistTotal: checklistItems.length,
    },
    exceptions,
    checklist: checklistItems,
  };
}
