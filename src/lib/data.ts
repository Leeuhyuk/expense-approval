import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import type { Report, ExpenseItem, ApprovalStep } from "./types";
import { SAMPLE_REPORT } from "./sample-data";

/** 데모용 기본 문서번호 */
export const DEFAULT_DOC_NO = SAMPLE_REPORT.docNo;

/**
 * 보고서 상세 조회 (Firestore Admin SDK).
 *   reports/{docNo}                  헤더 + author + categories
 *   reports/{docNo}/items/{id}       경비 항목
 *   reports/{docNo}/approvals/{idx}  결재선
 */
export async function getReport(docNo: string): Promise<Report | null> {
  const { adminDb } = await import("./firebaseAdmin");
  const ref = adminDb.collection("reports").doc(docNo);

  const snap = await ref.get();
  if (!snap.exists) return null;
  const header = snap.data()!;

  const [itemsSnap, apprSnap] = await Promise.all([
    ref.collection("items").orderBy(FieldPath.documentId()).get(),
    ref.collection("approvals").orderBy("order").get(),
  ]);

  const items = itemsSnap.docs.map((d) => d.data() as ExpenseItem);
  const approvalChain = apprSnap.docs.map((d) => {
    const { order: _order, ...step } = d.data() as ApprovalStep & { order: number };
    return step as ApprovalStep;
  });

  return { ...header, items, approvalChain } as Report;
}
