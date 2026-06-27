// 테스트 계정 생성 + 역할(Custom Claims) + 결재선 연결.
// 실행: npm run setup-users   (= node --env-file=.env.local scripts/setup-users.ts)
//
// - Firebase Auth 사용자 생성(이미 있으면 재사용) + role 클레임 부여
// - users/{uid} 문서 기록
// - reports/EXP-2026-0612 의 approvals 단계에 approverUid 연결
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const DOC_NO = "EXP-2026-0612";

const privateKey = process.env.FB_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: process.env.FB_ADMIN_PROJECT_ID,
        clientEmail: process.env.FB_ADMIN_CLIENT_EMAIL,
        privateKey,
      }),
    });

const auth = getAuth(app);
const db = getFirestore(app);

async function ensureUser(email: string, password: string, name: string, role: string) {
  let uid: string;
  try {
    const u = await auth.getUserByEmail(email);
    uid = u.uid;
  } catch {
    const u = await auth.createUser({ email, password, displayName: name });
    uid = u.uid;
  }
  // role 클레임 + displayName(name) — 세션 토큰에 포함됨
  await auth.setCustomUserClaims(uid, { role });
  await auth.updateUser(uid, { displayName: name });
  await db.collection("users").doc(uid).set({ email, name, role }, { merge: true });
  return uid;
}

async function main() {
  // 기안자(작성자) — 역할 employee
  const authorUid = await ensureUser("kim.minjun@company.test", "Approval123!", "김민준", "employee");
  // 1차 결재자(현재 단계) — 역할 approver
  const approverUid = await ensureUser("lee.seoyeon@company.test", "Approval123!", "이서연", "approver");

  // 결재선 연결: approvals/0 = 기안(작성자), approvals/1 = 1차 결재(현재 결재자)
  const approvals = db.collection("reports").doc(DOC_NO).collection("approvals");
  await approvals.doc("0").set({ approverUid: authorUid }, { merge: true });
  await approvals.doc("1").set({ approverUid: approverUid }, { merge: true });

  console.log("✓ 계정/권한/결재자 연결 완료");
  console.log("  기안자  김민준  kim.minjun@company.test  / Approval123!  (employee)");
  console.log("  결재자  이서연  lee.seoyeon@company.test / Approval123!  (approver) ← 현재 결재 단계");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗ 실패:", e);
    process.exit(1);
  });
