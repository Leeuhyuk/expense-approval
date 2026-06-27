import type { Report } from "@/lib/types";
import { TONE_STYLE } from "@/lib/types";
import { won } from "@/lib/format";
import { Avatar, CategoryChip, StatusPill } from "@/components/primitives";
import { ApprovalActions } from "@/components/ApprovalActions";

/** 모바일 · 빠른 결재 (width 390px) */
export function MobileView({ report }: { report: Report }) {
  const top = report.items.slice(0, 4);
  const rest = report.itemCount - top.length;
  return (
    <div
      className="mx-auto overflow-hidden bg-white"
      style={{ width: 390, borderRadius: 30, boxShadow: "var(--shadow-phone)" }}
    >
      {/* 노치 바 */}
      <div className="flex justify-center py-2.5" style={{ background: "#1A1D23" }}>
        <span className="rounded-full" style={{ width: 80, height: 5, background: "#3A3F49" }} />
      </div>

      <div className="px-5 pb-5 pt-4">
        {/* 문서번호 + 상태 */}
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-accent-soft px-2 py-1 font-mono text-[11px] font-semibold text-accent">
            {report.docNo}
          </span>
          <StatusPill status={report.status} />
        </div>

        {/* 제목 */}
        <div className="mt-3 text-[18px] font-extrabold leading-snug tracking-[-0.01em]">{report.title}</div>

        {/* 작성자 */}
        <div className="mt-3 flex items-center gap-2.5">
          <Avatar initial={report.author.initial} size={28} />
          <div className="text-[12.5px]">
            <span className="font-bold">{report.author.name}</span>
            <span className="ml-1.5 text-label-2">{report.author.team} · {report.author.role}</span>
          </div>
        </div>

        {/* 총 청구액 강조 */}
        <div className="mt-4 rounded-[14px] bg-surface-2 py-5 text-center">
          <div className="text-[11.5px] font-semibold text-label">총 청구액</div>
          <div className="mt-1 font-mono text-[30px] font-extrabold tnum">{won(report.total)}</div>
        </div>

        {/* 미니 결재선 */}
        <div className="relative mt-5">
          <div
            className="pointer-events-none absolute"
            style={{ top: 13, left: "12.5%", right: "12.5%", height: 2, background: "#DEE0E5" }}
          />
          <div
            className="pointer-events-none absolute"
            style={{
              top: 13,
              left: "12.5%",
              width: `${(report.approvalChain.filter((s) => s.tone === "done").length - 0.5) * (100 / report.approvalChain.length)}%`,
              height: 2,
              background: "#1F8A5B",
            }}
          />
          <div className="relative flex">
            {report.approvalChain.map((s) => {
              const t = TONE_STYLE[s.tone];
              return (
                <div key={s.step} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                  <Avatar
                    initial={s.person.initial}
                    size={26}
                    bg={t.avatarBg}
                    color={t.avatarText}
                    border={s.tone === "wait" ? "#DEE0E5" : undefined}
                  />
                  <span className="text-[10px] text-label-2">{s.step}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 청구 내역 */}
        <div className="mt-5">
          <div className="mb-2 text-[12.5px] font-bold">청구 내역</div>
          <div className="flex flex-col">
            {top.map((i) => (
              <div key={i.id} className="flex items-center justify-between border-b border-line-faint py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <CategoryChip category={i.category} />
                  <span className="text-ink-soft">{i.desc}</span>
                </span>
                <span className="font-mono text-[12.5px] font-semibold tnum">{won(i.amount)}</span>
              </div>
            ))}
          </div>
          {rest > 0 && (
            <div className="mt-2 text-[12.5px] font-semibold text-accent">+{rest}건 더보기</div>
          )}
        </div>

        {/* 앰버 콜아웃 */}
        <div className="mt-4 rounded-[12px] border border-amber-border bg-flag-row px-3.5 py-3 text-[12.5px] font-semibold text-amber-text">
          ⚠ 검토 필요 {report.flagCount}건 — 식대·접대 한도 확인
        </div>

        {/* 하단 액션 */}
        <div className="mt-5">
          <ApprovalActions docNo={report.docNo} variant="mobile" />
        </div>
      </div>
    </div>
  );
}
