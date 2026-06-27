import Link from "next/link";
import { DEFAULT_DOC_NO } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

const VIEWS = [
  { href: "/a", code: "A", title: "정통 결재함", desc: "좌측 문서 + 우측 결재 레일. 가장 보수적·안정적.", ready: true },
  { href: "/b", code: "B", title: "워크플로우 중심", desc: "결재 파이프라인 + 통계 카드 + 검토필요 항목.", ready: true },
  { href: "/c", code: "C", title: "원장형 / 커맨드", desc: "다크 헤더 + 키보드 단축키 + 고밀도 원장 테이블.", ready: true },
  { href: "/m", code: "M", title: "모바일 빠른 결재", desc: "한 손으로 빠르게 결재하는 카드형.", ready: true },
];

export default async function Home() {
  const session = await requireSession();
  return (
    <main className="mx-auto max-w-[980px] px-6 py-14">
      <div className="flex items-start justify-between">
        <div className="text-[13px] font-semibold tracking-[0.14em] text-accent">내부 보고 시스템 · REPORTING</div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-muted">
            {session.name ?? session.email} · <span className="font-semibold text-ink">{session.role}</span>
          </span>
          <LogoutButton />
        </div>
      </div>
      <h1 className="mt-2 text-[30px] font-extrabold tracking-[-0.02em]">경비 보고서 결재 승인 화면</h1>
      <p className="mt-1.5 text-sm text-muted">
        결재자(이서연 팀장) 관점 · 데스크톱 3안 + 모바일. 구현할 레이아웃을 선택하세요.
      </p>

      <div className="mt-9 grid grid-cols-2 gap-4">
        {VIEWS.map((v) => {
          const card = (
            <div
              className={`h-full rounded-[14px] border bg-white p-6 transition ${
                v.ready
                  ? "border-line hover:border-accent hover:shadow-[var(--shadow-card)]"
                  : "border-line-soft opacity-60"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-soft font-mono text-base font-bold text-accent">
                  {v.code}
                </span>
                <span className="text-[17px] font-bold">{v.title}</span>
                {!v.ready && (
                  <span className="ml-auto rounded-md bg-line-faint px-2 py-1 text-[11px] font-semibold text-label-2">
                    곧 추가
                  </span>
                )}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">{v.desc}</p>
            </div>
          );
          return v.ready ? (
            <Link key={v.code} href={v.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={v.code}>{card}</div>
          );
        })}
      </div>

      <p className="mt-8 font-mono text-xs text-label-2 tnum">
        샘플 문서: {DEFAULT_DOC_NO} · 데이터 연결 전 단계(샘플 데이터로 렌더링 중)
      </p>
    </main>
  );
}
