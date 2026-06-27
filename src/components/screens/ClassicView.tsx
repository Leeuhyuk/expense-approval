import type { Report } from "@/lib/types";
import { TONE_STYLE } from "@/lib/types";
import { won } from "@/lib/format";
import { Avatar, CategoryChip, ReceiptPill, StatusPill, ProgressBar } from "@/components/primitives";
import { ApprovalActions } from "@/components/ApprovalActions";

/** A · 정통 결재함 — 좌측 문서 + 우측 결재 레일 (width 1180px) */
export function ClassicView({ report }: { report: Report }) {
  return (
    <div
      className="mx-auto overflow-hidden rounded-[14px] border border-line bg-white"
      style={{ width: 1180, boxShadow: "var(--shadow-card)" }}
    >
      {/* 헤더 바 */}
      <div className="flex items-center justify-between border-b border-line-soft px-6 py-[18px]">
        <div className="flex items-center gap-3.5">
          <span className="rounded-md bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent tnum font-mono">
            {report.docNo}
          </span>
          <span className="text-[18px] font-bold tracking-[-0.01em]">{report.title}</span>
        </div>
        <div className="flex items-center gap-3 text-[12.5px] text-label-2">
          <span>상신 {report.submittedAt}</span>
          <StatusPill status={report.status} />
        </div>
      </div>

      {/* 본문 */}
      <div className="flex">
        {/* 좌측 문서 */}
        <div className="min-w-0 flex-1 px-6 py-[22px]">
          {/* 메타 스트립 */}
          <div className="mb-5 flex overflow-hidden rounded-[10px] border border-line-soft">
            <MetaCell label="작성자">
              <div className="flex items-center gap-2.5">
                <Avatar initial={report.author.initial} />
                <div>
                  <div className="text-[13.5px] font-bold">{report.author.name}</div>
                  <div className="text-[11.5px] text-label-2">
                    {report.author.team} · {report.author.role}
                  </div>
                </div>
              </div>
            </MetaCell>
            <MetaCell label="정산 기간">
              <div className="text-[13.5px] font-semibold tnum font-mono">{report.period}</div>
              <div className="text-[11.5px] text-label-2">출장 12일</div>
            </MetaCell>
            <MetaCell label="청구 합계" last>
              <div className="text-[15px] font-extrabold tnum font-mono">{won(report.total)}</div>
              <div className="text-[11.5px] text-label-2">{report.itemCount}건 · 검토필요 {report.flagCount}건</div>
            </MetaCell>
          </div>

          {/* 경비 표 */}
          <div>
            {/* 헤더 행 */}
            <div className="flex items-center border-b-[1.5px] border-line-strong px-1 pb-2 text-[11px] font-bold text-label">
              <div style={{ width: 58 }}>날짜</div>
              <div style={{ width: 88 }}>분류</div>
              <div className="flex-1">내역</div>
              <div className="text-center" style={{ width: 96 }}>증빙</div>
              <div className="text-right" style={{ width: 124 }}>금액</div>
            </div>
            {/* 데이터 행 */}
            {report.items.map((it) => (
              <div
                key={it.id}
                className="flex items-center border-b border-line-faint px-1 py-[11px] text-[13px]"
                style={it.flagged ? { background: "var(--color-flag-row)" } : undefined}
              >
                <div className="tnum font-mono text-ink-soft" style={{ width: 58 }}>
                  {it.date}
                </div>
                <div style={{ width: 88 }}>
                  <CategoryChip category={it.category} />
                </div>
                <div className="flex-1 pr-3 text-ink-soft">
                  {it.flagged && <span className="mr-1 text-amber">⚠</span>}
                  {it.desc}
                </div>
                <div className="flex justify-center" style={{ width: 96 }}>
                  <ReceiptPill hasReceipt={it.hasReceipt} />
                </div>
                <div className="text-right font-mono font-semibold tnum" style={{ width: 124 }}>
                  {won(it.amount)}
                </div>
              </div>
            ))}
          </div>

          {/* 합계 바 */}
          <div className="mt-5 flex items-center justify-between rounded-[10px] bg-surface-2 px-5 py-4">
            <div className="text-[12.5px] text-muted">
              청구 한도 <span className="font-mono tnum">{won(report.limit)}</span> 중{" "}
              <span className="font-bold text-ink">{report.usage}%</span> 사용
            </div>
            <div className="flex items-center gap-3.5">
              <ProgressBar ratio={report.usage} />
              <span className="text-[20px] font-extrabold font-mono tnum">{won(report.total)}</span>
            </div>
          </div>
        </div>

        {/* 우측 결재 레일 */}
        <div className="flex w-[340px] flex-col border-l border-line-soft bg-surface px-5 py-[22px]">
          <div className="mb-4 text-[13px] font-bold">결재선</div>
          <div>
            {report.approvalChain.map((s, i) => {
              const t = TONE_STYLE[s.tone];
              const last = i === report.approvalChain.length - 1;
              return (
                <div key={s.step} className="flex gap-3">
                  {/* 아바타 + 연결선 */}
                  <div className="flex flex-col items-center">
                    <Avatar
                      initial={s.person.initial}
                      bg={t.avatarBg}
                      color={t.avatarText}
                      border={s.tone === "wait" ? "#DEE0E5" : undefined}
                    />
                    {!last && <span className="my-1 w-px flex-1" style={{ background: "#E4E6EA", minHeight: 22 }} />}
                  </div>
                  {/* 내용 */}
                  <div className="pb-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-label">{s.step}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10.5px] font-bold"
                        style={{ background: t.badgeBg, color: t.badgeText }}
                      >
                        {s.state}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[13px] font-bold">{s.person.name}</div>
                    <div className="text-[11.5px] text-label-2">
                      {s.person.team} · {s.person.role}
                      {s.at !== "—" && <span className="ml-1.5 font-mono tnum text-faint">{s.at}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 하단 액션 */}
          <div className="mt-auto pt-4">
            <ApprovalActions docNo={report.docNo} variant="stack" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaCell({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex-1 px-4 py-3.5 ${last ? "" : "border-r border-line-soft"}`}>
      <div className="mb-[7px] text-[11px] font-semibold text-label">{label}</div>
      {children}
    </div>
  );
}
