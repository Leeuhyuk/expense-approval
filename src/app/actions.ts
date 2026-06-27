"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ApprovalStep, Person } from "@/lib/types";

export type DecisionResult =
  | { ok: true; decision: "approved" | "rejected"; message: string }
  | { ok: false; message: string };

const APPROVER_ROLES = new Set(["approver", "finance", "admin"]);

function today(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 결재 결정(승인/반려)을 Firestore 트랜잭션으로 처리.
 * - 로그인 + 결재 권한(role) 확인
 * - 현재 'current' 단계의 지정 결재자(approverUid) 본인인지 확인
 * - 승인: 현재 단계 done → 다음 단계 current 로 승격 (마지막이면 보고서 승인)
 * - 반려: 보고서 반려 처리(진행 중단)
 */
export async function submitDecision(
  docNo: string,
  decision: "approved" | "rejected",
  comment: string,
): Promise<DecisionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  if (!APPROVER_ROLES.has(session.role)) {
    return { ok: false, message: "결재 권한이 없습니다." };
  }

  const { getAdminDb } = await import("@/lib/firebaseAdmin");
  const adminDb = getAdminDb();
  const reportRef = adminDb.collection("reports").doc(docNo);
  const approvalsCol = reportRef.collection("approvals");

  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const reportSnap = await tx.get(reportRef);
      if (!reportSnap.exists) throw new Error("NOT_FOUND");
      const author = reportSnap.get("author") as Person;

      const apprSnap = await tx.get(approvalsCol.orderBy("order"));
      const steps = apprSnap.docs.map((d) => ({ ref: d.ref, data: d.data() as ApprovalStep & { order: number } }));

      const currentIdx = steps.findIndex((s) => s.data.tone === "current");
      if (currentIdx === -1) throw new Error("ALREADY_DONE");
      const current = steps[currentIdx];

      // 권한: 지정 결재자가 있으면 본인만, 없으면 결재 role 허용(admin은 항상 허용)
      if (session.role !== "admin" && current.data.approverUid && current.data.approverUid !== session.uid) {
        throw new Error("NOT_APPROVER");
      }

      if (decision === "rejected") {
        tx.update(current.ref, { state: "반려", comment: comment || "" });
        tx.update(reportRef, { status: "반려", decision: "rejected" });
        return { message: `반려되었습니다 · 작성자(${author?.name ?? "기안자"})에게 반송되었습니다.` };
      }

      // 승인
      tx.update(current.ref, { state: "완료", tone: "done", at: today(), comment: comment || "" });
      const next = steps[currentIdx + 1];
      if (next) {
        tx.update(next.ref, { state: "검토 중", tone: "current", at: "지금" });
        tx.update(reportRef, { status: "검토 대기" });
        return {
          message: `승인 처리되었습니다 · ${next.data.person.name} ${next.data.person.role}에게 전달되었습니다.`,
        };
      }
      tx.update(reportRef, { status: "승인", decision: "approved" });
      return { message: "승인 처리되었습니다 · 결재가 완료되었습니다." };
    });

    revalidatePath(`/a`);
    return { ok: true, decision, message: result.message };
  } catch (e) {
    const code = e instanceof Error ? e.message : "ERROR";
    const map: Record<string, string> = {
      NOT_FOUND: "보고서를 찾을 수 없습니다.",
      ALREADY_DONE: "이미 결재가 완료된 단계입니다.",
      NOT_APPROVER: "현재 단계의 지정 결재자가 아닙니다.",
    };
    return { ok: false, message: map[code] ?? "결재 처리 중 오류가 발생했습니다." };
  }
}
