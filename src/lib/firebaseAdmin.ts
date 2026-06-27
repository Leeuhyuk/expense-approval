// Firebase Admin SDK 초기화 (서버 전용) — 지연(lazy) 초기화.
// 모듈 import 시점이 아니라 실제 사용 시점에 초기화하여, 자격증명 오류가
// 라우트 핸들러의 try/catch로 전달되도록 한다.
import "server-only";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

/** Vercel/.env 등에서 들어온 private key 정규화 — 감싼 따옴표 제거 + \n 복원 */
function normalizeKey(raw?: string): string | undefined {
  if (!raw) return raw;
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, "\n");
}

let cached: App | undefined;

function adminApp(): App {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApps()[0];
    return cached;
  }
  const projectId = process.env.FB_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FB_ADMIN_CLIENT_EMAIL;
  const privateKey = normalizeKey(process.env.FB_ADMIN_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase Admin 자격증명 누락 — projectId:${!!projectId} clientEmail:${!!clientEmail} privateKey:${!!privateKey}`,
    );
  }
  cached = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return cached;
}

export function getAdminAuth(): Auth {
  return getAuth(adminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(adminApp());
}
