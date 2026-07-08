import {
  DisbursementStatus,
  NotificationType,
  PaymentRequestStatus,
  ReportRunStatus,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/index.js";
import { notificationExpiresAt } from "../domain/notificationRetention.js";
import { prisma } from "../db/prisma.js";

export type FinancialReconciliationSeverity = "warning" | "critical";

export type FinancialReconciliationCheck = {
  id: string;
  label: string;
  ok: boolean;
  severity: FinancialReconciliationSeverity;
  count: number;
  detail: string;
  action: string;
};

export type FinancialReconciliationMismatch = {
  id: string;
  type: string;
  severity: FinancialReconciliationSeverity;
  label: string;
  scope: string;
  expected: number;
  actual: number;
  diff: number;
  detail: string;
  linkPath: string;
};

export type FinancialReconciliationBucket = {
  period: string;
  departmentId: string;
  departmentName: string;
  approvedPaymentCount: number;
  approvedPaymentAmount: number;
  completedDisbursementCount: number;
  completedDisbursementAmount: number;
  diff: number;
};

type FinancialReconciliationDb = Pick<
  PrismaClient,
  "budget" | "budgetItem" | "paymentRequest" | "disbursement" | "reportRun" | "user" | "notification"
>;

type SnapshotRow = Record<string, string>;

type ReportDrilldownSnapshot = {
  generatedAt: string;
  source: string;
  sections: Record<string, { columns: string[]; rows: SnapshotRow[] }>;
};

const toleranceWon = 1;
const mismatchResponseLimit = 100;
const reportAccessPattern = /\s*\[공유권한:([^\]]+)\]\s*$/;
const reportDrilldownPattern = /\s*\[드릴다운:([^\]]+)\]\s*$/;

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWon(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountDiff(expected: number, actual: number) {
  return Math.round((actual - expected) * 100) / 100;
}

function outsideTolerance(expected: number, actual: number) {
  return Math.abs(amountDiff(expected, actual)) > toleranceWon;
}

function dateKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "미지정";
}

function monthKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 7) : "미지정";
}

function displayPaymentRequestStatus(status: PaymentRequestStatus) {
  const map: Record<PaymentRequestStatus, string> = {
    DRAFT: "임시 저장",
    SUBMITTED: "제출",
    APPROVAL_PENDING: "승인 대기",
    APPROVAL_IN_PROGRESS: "승인 진행 중",
    APPROVED: "승인 완료",
    REJECTED: "반려",
    HELD: "보류",
  };
  return map[status];
}

function displayDisbursementStatus(status: DisbursementStatus) {
  const map: Record<DisbursementStatus, string> = {
    SCHEDULED: "지급 예정",
    DUE_TODAY: "오늘 지급",
    COMPLETED: "지급 완료",
    ERROR: "오류",
    HELD: "보류",
  };
  return map[status];
}

function decodeReportDrilldownSnapshot(value: string | undefined): ReportDrilldownSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const sections = (parsed as { sections?: unknown }).sections;
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) return null;
    return parsed as ReportDrilldownSnapshot;
  } catch {
    return null;
  }
}

function readReportSummaryDrilldown(summary: string | null | undefined) {
  const raw = summary ?? "";
  const accessMatch = raw.match(reportAccessPattern);
  const withoutAccess = accessMatch ? raw.replace(reportAccessPattern, "") : raw;
  const drilldownMatch = withoutAccess.match(reportDrilldownPattern);
  return decodeReportDrilldownSnapshot(drilldownMatch?.[1]?.trim());
}

function snapshotSectionRows(snapshot: ReportDrilldownSnapshot, sectionKey: string) {
  const section = snapshot.sections[sectionKey];
  if (!section || !Array.isArray(section.rows)) return [];
  return section.rows.flatMap((row): SnapshotRow[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    return [Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")]))];
  });
}

function normalizePermissions(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function findOperationalOwnerIds(db: Pick<PrismaClient, "user">, permission = "system:manage") {
  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      roles: {
        select: {
          role: {
            select: {
              isActive: true,
              permissions: true,
            },
          },
        },
      },
    },
  });

  return users
    .filter((user) =>
      user.roles.some(({ role }) => {
        if (!role.isActive) return false;
        const permissions = normalizePermissions(role.permissions);
        return permissions.includes("*") || permissions.includes(permission);
      }),
    )
    .map((user) => user.id);
}

function bucketAdd(
  buckets: Map<string, FinancialReconciliationBucket>,
  period: string,
  departmentId: string,
  departmentName: string,
  field: "approved" | "completed",
  amount: number,
) {
  const key = `${period}:${departmentId}`;
  const current = buckets.get(key) ?? {
    period,
    departmentId,
    departmentName,
    approvedPaymentCount: 0,
    approvedPaymentAmount: 0,
    completedDisbursementCount: 0,
    completedDisbursementAmount: 0,
    diff: 0,
  };
  if (field === "approved") {
    current.approvedPaymentCount += 1;
    current.approvedPaymentAmount += amount;
  } else {
    current.completedDisbursementCount += 1;
    current.completedDisbursementAmount += amount;
  }
  current.diff = amountDiff(current.approvedPaymentAmount, current.completedDisbursementAmount);
  buckets.set(key, current);
}

function sortedBuckets(buckets: Map<string, FinancialReconciliationBucket>) {
  return Array.from(buckets.values()).sort((left, right) =>
    left.period.localeCompare(right.period) || left.departmentName.localeCompare(right.departmentName, "ko-KR"),
  );
}

function check(input: Omit<FinancialReconciliationCheck, "ok">): FinancialReconciliationCheck {
  return { ...input, ok: input.count === 0 };
}

export async function getFinancialReconciliationSummary(db: FinancialReconciliationDb = prisma) {
  const [budgets, budgetItems, paymentRequests, disbursements, reportRuns] = await Promise.all([
    db.budget.findMany({
      select: {
        id: true,
        fiscalYear: true,
        allocatedAmount: true,
        usedAmount: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    }),
    db.budgetItem.findMany({
      select: {
        id: true,
        budgetId: true,
        name: true,
        allocatedAmount: true,
        usedAmount: true,
        budget: {
          select: {
            fiscalYear: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
    }),
    db.paymentRequest.findMany({
      select: {
        id: true,
        requestCode: true,
        amount: true,
        status: true,
        requestedAt: true,
        departmentId: true,
        budgetItemId: true,
        department: { select: { name: true } },
        budgetItem: {
          select: {
            id: true,
            name: true,
            budgetId: true,
            budget: {
              select: {
                fiscalYear: true,
                departmentId: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    db.disbursement.findMany({
      select: {
        id: true,
        disbursementCode: true,
        amount: true,
        status: true,
        scheduledDate: true,
        executedAt: true,
        paymentRequestId: true,
        paymentRequest: {
          select: {
            id: true,
            requestCode: true,
            amount: true,
            status: true,
            requestedAt: true,
            departmentId: true,
            department: { select: { name: true } },
            budgetItemId: true,
            budgetItem: {
              select: {
                id: true,
                name: true,
                budgetId: true,
                budget: {
                  select: {
                    fiscalYear: true,
                    departmentId: true,
                    department: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.reportRun.findMany({
      where: { status: ReportRunStatus.READY },
      select: {
        id: true,
        name: true,
        type: true,
        periodStart: true,
        periodEnd: true,
        summary: true,
        artifactKey: true,
        rowCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const approvedRequests = paymentRequests.filter((request) => request.status === PaymentRequestStatus.APPROVED);
  const completedDisbursements = disbursements.filter((item) => item.status === DisbursementStatus.COMPLETED);
  const paymentByCode = new Map(paymentRequests.map((request) => [request.requestCode, request]));
  const disbursementByCode = new Map(disbursements.map((item) => [item.disbursementCode, item]));
  const budgetItemsByBudgetId = new Map<string, number>();
  const approvedByBudgetId = new Map<string, number>();
  const approvedByBudgetItemId = new Map<string, number>();
  const completedByPaymentRequestId = new Map<string, number>();
  const monthlyBuckets = new Map<string, FinancialReconciliationBucket>();
  const dailyBuckets = new Map<string, FinancialReconciliationBucket>();

  for (const item of budgetItems) {
    budgetItemsByBudgetId.set(item.budgetId, (budgetItemsByBudgetId.get(item.budgetId) ?? 0) + numberValue(item.usedAmount));
  }

  for (const request of approvedRequests) {
    const amount = numberValue(request.amount);
    if (request.budgetItem?.budgetId) {
      approvedByBudgetId.set(request.budgetItem.budgetId, (approvedByBudgetId.get(request.budgetItem.budgetId) ?? 0) + amount);
    }
    if (request.budgetItemId) {
      approvedByBudgetItemId.set(request.budgetItemId, (approvedByBudgetItemId.get(request.budgetItemId) ?? 0) + amount);
    }
    bucketAdd(monthlyBuckets, monthKey(request.requestedAt), request.departmentId, request.department.name, "approved", amount);
    bucketAdd(dailyBuckets, dateKey(request.requestedAt), request.departmentId, request.department.name, "approved", amount);
  }

  for (const item of completedDisbursements) {
    const amount = numberValue(item.amount);
    completedByPaymentRequestId.set(item.paymentRequestId, (completedByPaymentRequestId.get(item.paymentRequestId) ?? 0) + amount);
    const bucketDate = item.executedAt ?? item.scheduledDate;
    bucketAdd(monthlyBuckets, monthKey(bucketDate), item.paymentRequest.departmentId, item.paymentRequest.department.name, "completed", amount);
    bucketAdd(dailyBuckets, dateKey(bucketDate), item.paymentRequest.departmentId, item.paymentRequest.department.name, "completed", amount);
  }

  const mismatchTypeCounts = new Map<string, number>();
  const severityCounts: Record<FinancialReconciliationSeverity, number> = { warning: 0, critical: 0 };
  const mismatches: FinancialReconciliationMismatch[] = [];
  const addMismatch = (mismatch: FinancialReconciliationMismatch) => {
    mismatchTypeCounts.set(mismatch.type, (mismatchTypeCounts.get(mismatch.type) ?? 0) + 1);
    severityCounts[mismatch.severity] += 1;
    if (mismatches.length < mismatchResponseLimit) mismatches.push(mismatch);
  };

  for (const budget of budgets) {
    const usedAmount = numberValue(budget.usedAmount);
    const itemUsed = budgetItemsByBudgetId.get(budget.id) ?? 0;
    if (outsideTolerance(usedAmount, itemUsed)) {
      addMismatch({
        id: `budget-used-items-${budget.id}`,
        type: "budget_used_vs_items",
        severity: "critical",
        label: "예산 사용액과 항목 사용액 불일치",
        scope: `${budget.department.name}/${budget.fiscalYear}`,
        expected: usedAmount,
        actual: itemUsed,
        diff: amountDiff(usedAmount, itemUsed),
        detail: "Budget.usedAmount와 하위 BudgetItem.usedAmount 합계가 다릅니다.",
        linkPath: "#budget",
      });
    }

    const approvedAmount = approvedByBudgetId.get(budget.id) ?? 0;
    if (outsideTolerance(usedAmount, approvedAmount)) {
      addMismatch({
        id: `budget-used-approved-${budget.id}`,
        type: "budget_used_vs_approved_requests",
        severity: "critical",
        label: "예산 사용액과 승인 요청 금액 불일치",
        scope: `${budget.department.name}/${budget.fiscalYear}`,
        expected: usedAmount,
        actual: approvedAmount,
        diff: amountDiff(usedAmount, approvedAmount),
        detail: "승인 완료 결제 요청 합계가 예산 사용액과 다릅니다.",
        linkPath: "#budget",
      });
    }
  }

  for (const item of budgetItems) {
    const usedAmount = numberValue(item.usedAmount);
    const approvedAmount = approvedByBudgetItemId.get(item.id) ?? 0;
    if (outsideTolerance(usedAmount, approvedAmount)) {
      addMismatch({
        id: `budget-item-used-approved-${item.id}`,
        type: "budget_item_used_vs_approved_requests",
        severity: "critical",
        label: "예산 항목 사용액과 승인 요청 금액 불일치",
        scope: `${item.budget.department.name}/${item.budget.fiscalYear}/${item.name}`,
        expected: usedAmount,
        actual: approvedAmount,
        diff: amountDiff(usedAmount, approvedAmount),
        detail: "BudgetItem.usedAmount와 해당 항목 승인 완료 결제 요청 합계가 다릅니다.",
        linkPath: "#budget",
      });
    }
  }

  for (const request of paymentRequests) {
    const completedAmount = completedByPaymentRequestId.get(request.id) ?? 0;
    const approvedAmount = numberValue(request.amount);
    if (completedAmount > 0 && request.status !== PaymentRequestStatus.APPROVED) {
      addMismatch({
        id: `completed-non-approved-${request.id}`,
        type: "completed_disbursement_without_approved_request",
        severity: "critical",
        label: "승인 전 지급 완료",
        scope: request.requestCode,
        expected: 0,
        actual: completedAmount,
        diff: completedAmount,
        detail: "승인 완료 상태가 아닌 결제 요청에 지급 완료 금액이 연결되어 있습니다.",
        linkPath: "#disbursement",
      });
    }
    if (request.status === PaymentRequestStatus.APPROVED && completedAmount - approvedAmount > toleranceWon) {
      addMismatch({
        id: `request-over-disbursed-${request.id}`,
        type: "payment_request_over_disbursed",
        severity: "critical",
        label: "승인 금액 초과 지급",
        scope: request.requestCode,
        expected: approvedAmount,
        actual: completedAmount,
        diff: amountDiff(approvedAmount, completedAmount),
        detail: "지급 완료 합계가 승인된 결제 요청 금액을 초과했습니다.",
        linkPath: "#disbursement",
      });
    }
  }

  let reportSnapshotsReviewed = 0;
  let reportRowsReviewed = 0;
  for (const report of reportRuns) {
    const snapshot = readReportSummaryDrilldown(report.summary);
    if (!snapshot) {
      if (report.rowCount > 0) {
        addMismatch({
          id: `report-missing-snapshot-${report.id}`,
          type: "report_snapshot_missing",
          severity: "warning",
          label: "보고서 드릴다운 스냅샷 없음",
          scope: report.name,
          expected: report.rowCount,
          actual: 0,
          diff: -report.rowCount,
          detail: "저장된 보고서 행수는 있지만 원천 드릴다운 스냅샷이 없어 금액 대사가 제한됩니다.",
          linkPath: "#reports",
        });
      }
      continue;
    }

    reportSnapshotsReviewed += 1;
    const paymentRows = [...snapshotSectionRows(snapshot, "department"), ...snapshotSectionRows(snapshot, "approval")];
    const disbursementRows = snapshotSectionRows(snapshot, "monthly");
    reportRowsReviewed += paymentRows.length + disbursementRows.length;

    for (const row of paymentRows) {
      const requestCode = row.요청번호?.trim();
      if (!requestCode) continue;
      const current = paymentByCode.get(requestCode);
      if (!current) {
        addMismatch({
          id: `report-payment-missing-${report.id}-${requestCode}`,
          type: "report_snapshot_missing_payment_request",
          severity: "critical",
          label: "보고서 결제 요청 원천 없음",
          scope: `${report.name}/${requestCode}`,
          expected: parseWon(row.금액),
          actual: 0,
          diff: -parseWon(row.금액),
          detail: "보고서 스냅샷의 요청번호가 현재 결제 요청 원장에 없습니다.",
          linkPath: "#reports",
        });
        continue;
      }
      const snapshotAmount = parseWon(row.금액);
      const currentAmount = numberValue(current.amount);
      if (outsideTolerance(snapshotAmount, currentAmount)) {
        addMismatch({
          id: `report-payment-amount-${report.id}-${requestCode}`,
          type: "report_snapshot_payment_amount",
          severity: "critical",
          label: "보고서 결제 요청 금액 불일치",
          scope: `${report.name}/${requestCode}`,
          expected: snapshotAmount,
          actual: currentAmount,
          diff: amountDiff(snapshotAmount, currentAmount),
          detail: "보고서 스냅샷 금액과 현재 결제 요청 금액이 다릅니다.",
          linkPath: "#reports",
        });
      }
      const snapshotStatus = (row.상태 || row.결재상태 || "").trim();
      const currentStatus = displayPaymentRequestStatus(current.status);
      if (snapshotStatus && snapshotStatus !== currentStatus) {
        addMismatch({
          id: `report-payment-status-${report.id}-${requestCode}`,
          type: "report_snapshot_payment_status",
          severity: "warning",
          label: "보고서 결제 요청 상태 변경",
          scope: `${report.name}/${requestCode}`,
          expected: 0,
          actual: 1,
          diff: 1,
          detail: `보고서 스냅샷 상태는 ${snapshotStatus}, 현재 상태는 ${currentStatus}입니다.`,
          linkPath: "#reports",
        });
      }
    }

    for (const row of disbursementRows) {
      const disbursementCode = row.지급번호?.trim();
      if (!disbursementCode) continue;
      const current = disbursementByCode.get(disbursementCode);
      if (!current) {
        addMismatch({
          id: `report-disbursement-missing-${report.id}-${disbursementCode}`,
          type: "report_snapshot_missing_disbursement",
          severity: "critical",
          label: "보고서 지급 원천 없음",
          scope: `${report.name}/${disbursementCode}`,
          expected: parseWon(row.금액),
          actual: 0,
          diff: -parseWon(row.금액),
          detail: "보고서 스냅샷의 지급번호가 현재 지급 원장에 없습니다.",
          linkPath: "#reports",
        });
        continue;
      }
      const snapshotAmount = parseWon(row.금액);
      const currentAmount = numberValue(current.amount);
      if (outsideTolerance(snapshotAmount, currentAmount)) {
        addMismatch({
          id: `report-disbursement-amount-${report.id}-${disbursementCode}`,
          type: "report_snapshot_disbursement_amount",
          severity: "critical",
          label: "보고서 지급 금액 불일치",
          scope: `${report.name}/${disbursementCode}`,
          expected: snapshotAmount,
          actual: currentAmount,
          diff: amountDiff(snapshotAmount, currentAmount),
          detail: "보고서 스냅샷 금액과 현재 지급 원장 금액이 다릅니다.",
          linkPath: "#reports",
        });
      }
      const snapshotStatus = row.지급상태?.trim();
      const currentStatus = displayDisbursementStatus(current.status);
      if (snapshotStatus && snapshotStatus !== currentStatus) {
        addMismatch({
          id: `report-disbursement-status-${report.id}-${disbursementCode}`,
          type: "report_snapshot_disbursement_status",
          severity: "warning",
          label: "보고서 지급 상태 변경",
          scope: `${report.name}/${disbursementCode}`,
          expected: 0,
          actual: 1,
          diff: 1,
          detail: `보고서 스냅샷 상태는 ${snapshotStatus}, 현재 상태는 ${currentStatus}입니다.`,
          linkPath: "#reports",
        });
      }
    }
  }

  const countFor = (type: string) => mismatchTypeCounts.get(type) ?? 0;
  const checks: FinancialReconciliationCheck[] = [
    check({
      id: "budget_used_vs_items",
      label: "예산 사용액 대 항목 합계",
      severity: "critical",
      count: countFor("budget_used_vs_items"),
      detail: "Budget.usedAmount와 BudgetItem.usedAmount 합계를 비교합니다.",
      action: "예산 항목 원장과 예산 rowVersion, 최근 승인/조정 감사 로그를 확인합니다.",
    }),
    check({
      id: "budget_used_vs_approved_requests",
      label: "예산 사용액 대 승인 요청",
      severity: "critical",
      count: countFor("budget_used_vs_approved_requests") + countFor("budget_item_used_vs_approved_requests"),
      detail: "예산 및 예산 항목 사용액과 승인 완료 결제 요청 합계를 비교합니다.",
      action: "승인 완료 처리의 예산 사용액 반영 여부를 재대사합니다.",
    }),
    check({
      id: "completed_disbursement_vs_approved_requests",
      label: "지급 완료 대 승인 요청",
      severity: "critical",
      count: countFor("completed_disbursement_without_approved_request") + countFor("payment_request_over_disbursed"),
      detail: "승인 전 지급 완료와 승인 금액 초과 지급을 점검합니다.",
      action: "지급 완료 처리, 은행 결과 대사, 승인 상태 변경 이력을 확인합니다.",
    }),
    check({
      id: "report_snapshot_vs_current_sources",
      label: "보고서 스냅샷 대 현재 원천",
      severity: "warning",
      count:
        countFor("report_snapshot_missing") +
        countFor("report_snapshot_missing_payment_request") +
        countFor("report_snapshot_missing_disbursement") +
        countFor("report_snapshot_payment_amount") +
        countFor("report_snapshot_disbursement_amount") +
        countFor("report_snapshot_payment_status") +
        countFor("report_snapshot_disbursement_status"),
      detail: "저장된 보고서 드릴다운 행의 요청번호/지급번호/금액/상태를 현재 원천과 비교합니다.",
      action: "보고서가 오래된 snapshot인지, 원천 금액 변경이 정당한지 확인하고 필요 시 보고서를 재생성합니다.",
    }),
  ];
  const triggered = checks.filter((item) => !item.ok);
  const totalBudgetAllocated = budgets.reduce((sum, budget) => sum + numberValue(budget.allocatedAmount), 0);
  const totalBudgetUsed = budgets.reduce((sum, budget) => sum + numberValue(budget.usedAmount), 0);
  const approvedPaymentAmount = approvedRequests.reduce((sum, request) => sum + numberValue(request.amount), 0);
  const completedDisbursementAmount = completedDisbursements.reduce((sum, item) => sum + numberValue(item.amount), 0);
  const mismatchCount = severityCounts.warning + severityCounts.critical;

  return {
    ok: severityCounts.critical === 0,
    actionRequired: mismatchCount > 0,
    generatedAt: new Date().toISOString(),
    toleranceWon,
    summary: {
      budgets: budgets.length,
      budgetItems: budgetItems.length,
      paymentRequests: paymentRequests.length,
      approvedPaymentRequests: approvedRequests.length,
      disbursements: disbursements.length,
      completedDisbursements: completedDisbursements.length,
      reportRunsReviewed: reportRuns.length,
      reportSnapshotsReviewed,
      reportRowsReviewed,
      totalBudgetAllocated,
      totalBudgetUsed,
      approvedPaymentAmount,
      completedDisbursementAmount,
      criticalMismatchCount: severityCounts.critical,
      warningMismatchCount: severityCounts.warning,
      mismatchCount,
    },
    checks,
    triggered,
    mismatches,
    mismatchesTruncated: mismatchCount > mismatches.length,
    monthly: sortedBuckets(monthlyBuckets),
    daily: sortedBuckets(dailyBuckets).slice(-90),
  };
}

export async function notifyFinancialReconciliationOwners(db: FinancialReconciliationDb = prisma) {
  const summary = await getFinancialReconciliationSummary(db);
  const triggered = summary.triggered;
  if (triggered.length === 0) {
    return {
      summary,
      recipientCount: 0,
      notificationsCreated: 0,
    };
  }

  const recipientIds = await findOperationalOwnerIds(db);
  if (recipientIds.length === 0) {
    return {
      summary,
      recipientCount: 0,
      notificationsCreated: 0,
    };
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const triggeredIds = triggered.map((item) => item.id);
  const existing = await db.notification.findMany({
    where: {
      userId: { in: recipientIds },
      type: NotificationType.OPERATIONAL_ALERT,
      entityType: "FINANCIAL_RECONCILIATION",
      entityId: { in: triggeredIds },
      createdAt: { gte: today },
    },
    select: {
      userId: true,
      entityId: true,
    },
  });
  const existingKeys = new Set(existing.map((item) => `${item.userId}:${item.entityId}`));
  const expiresAt = notificationExpiresAt();
  const notificationRows: Prisma.NotificationCreateManyInput[] = [];
  for (const item of triggered) {
    for (const userId of recipientIds) {
      const key = `${userId}:${item.id}`;
      if (existingKeys.has(key)) continue;
      notificationRows.push({
        userId,
        type: NotificationType.OPERATIONAL_ALERT,
        title: `재무 대사 알림: ${item.label}`,
        message: `${item.count}건의 불일치가 감지되었습니다. 예산/지급/보고서 원장을 확인하세요.`,
        entityType: "FINANCIAL_RECONCILIATION",
        entityId: item.id,
        linkPath: "#settings",
        expiresAt,
      });
    }
  }

  const result = notificationRows.length > 0 ? await db.notification.createMany({ data: notificationRows }) : { count: 0 };
  return {
    summary,
    recipientCount: recipientIds.length,
    notificationsCreated: result.count,
  };
}
