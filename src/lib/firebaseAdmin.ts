// Firebase Admin SDK 초기화 (서버 전용)
// 서버 컴포넌트 / Server Action 에서 Firestore 쓰기·결재 트랜잭션·토큰 검증에 사용.
// 서비스 계정 키(.env.local의 FB_ADMIN_*)가 채워져 있어야 동작합니다.
import "server-only";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

function createAdminApp(): App {
  const projectId = process.env.FB_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FB_ADMIN_CLIENT_EMAIL;
  // private key는 .env에서 \n 이스케이프로 저장 → 실제 줄바꿈으로 복원
  const privateKey = process.env.FB_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
