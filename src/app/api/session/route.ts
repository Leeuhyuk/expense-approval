import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { SESSION_COOKIE } from "@/lib/auth";

// 세션 쿠키 유효기간: 5일
const EXPIRES_IN_MS = 60 * 60 * 24 * 5 * 1000;

/** 로그인: 클라이언트의 ID 토큰 → 세션 쿠키 발급 */
export async function POST(req: NextRequest) {
  const { idToken } = await req.json().catch(() => ({ idToken: null }));
  if (!idToken) {
    return NextResponse.json({ error: "ID 토큰이 필요합니다." }, { status: 400 });
  }
  try {
    const auth = getAdminAuth();
    await auth.verifyIdToken(idToken);
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: EXPIRES_IN_MS });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: EXPIRES_IN_MS / 1000,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "토큰 검증 실패";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}

/** 로그아웃: 세션 쿠키 제거 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
