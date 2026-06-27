// Firebase Admin SDK 초기화 (서버 전용)
// 서버 컴포넌트 / Server Action 에서 Firestore 쓰기·결재 트랜잭션·토큰 검증에 사용.
// 서비스 계정 키(.env.local의 FB_ADMIN_*)가 채워져 있어야 동작합니다.
import "server-only";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

/** Vercel/.env 등에서 들어온 private key 정규화 — 감싼 따옴표 제거 + \n 복원 */
function normalizeKey(raw?: string): string | undefined {
  if (!raw) return raw;
  let k = raw.trim();
  // 실수로 감싼 따옴표 제거
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // 리터럴 \n → 실제 줄바꿈
  return k.replace(/\\n/g, "\n");
}

function createAdminApp(): App {
  const projectId = process.env.FB_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FB_ADMIN_CLIENT_EMAIL;
  const privateKey = normalizeKey(process.env.FB_ADMIN_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin 자격증명이 없습니다. .env.local의 FB_ADMIN_CLIENT_EMAIL / FB_ADMIN_PRIVATE_KEY 를 채우세요.",
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const adminApp: App = getApps().length ? getApps()[0] : createAdminApp();

export const adminDb: Firestore = getFirestore(adminApp);
export const adminAuth: Auth = getAuth(adminApp);
