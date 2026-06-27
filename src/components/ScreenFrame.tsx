import Link from "next/link";
import type { Session } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

/** 화면 공통 셸 — 상단 브레드크럼 + 사용자 칩 + 로그아웃 */
export function ScreenFrame({
  code,
  title,
  session,
  width,
  children,
}: {
  code: string;
  title: string;
  session: Session;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <main className="px-6 py-10">
      <div className="mx-auto mb-5 flex items-center gap-3" style={{ maxWidth: width }}>
        <Link href="/" className="text-[13px] font-semibold text-accent hover:underline">
          ← 레이아웃 선택
        </Link>
        <span className="font-mono text-xs text-label-2">
          {code} · {title}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12.5px] text-muted">
            {session.name ?? session.email} · <span className="font-semibold text-ink">{session.role}</span>
          </span>
          <LogoutButton />
        </div>
      </div>
      {children}
    </main>
  );
}
