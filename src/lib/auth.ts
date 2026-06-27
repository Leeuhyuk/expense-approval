import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "./types";

/** Firebase Hosting/App Hosting이 그대로 전달하는 쿠키 이름 규칙 */
export const SESSION_COOKIE = "__session";

export interface Session {
  uid: string;
  email: string | null;
  name: string | null;
  role: UserRole;
}

/** 세션 쿠키를 검증해 현재 사용자 반환 (없거나 무효면 null) */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const { adminAuth } = await import("./firebaseAdmin");
    const decoded = await adminAuth.verifySessionCookie(cookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: (decoded.name as string | undefined) ?? null,
      role: ((decoded.role as UserRole | undefined) ?? "employee") as UserRole,
    };
  } catch {
    return null;
  }
}

/** 로그인 필수 — 없으면 /login 으로 리다이렉트 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
