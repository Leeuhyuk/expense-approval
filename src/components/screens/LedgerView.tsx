import type { Report } from "@/lib/types";
import { TONE_STYLE, CATEGORY_COLOR } from "@/lib/types";
import { won, comma } from "@/lib/format";
import { ApprovalActions } from "@/components/ApprovalActions";

/** C · 원장형 / 커맨드 — 다크 헤더 + 고밀도 원장 (width 1240px) */
export function LedgerView({ report }: { report: Report }) {
  return (
    <div
      className="mx-auto overflow-hidden rounded-[14px] border border-line bg-white"
      style={{ width: 1240, boxShadow: "var(--shadow-card)" }}
    >
      {/* 다크 헤더 */}
      <div className="flex items-center justify-between px-6 py-3.5" style={{ background: "#1A1D23" }}>
        <div className="flex items-center gap-3 font-mono text-[12px]" style={{ color: "#7E8694" }}>
          <span>결재함 <span style={{ color: "#4A5260" }}>/</span> {report.docNo}</span>
          <span
            className="rounded px-2 py-1 text-[11px] font-semibold"
            style={{ color: "#F0B84A", background: "rgba(240,184,74,.14)" }}
          >
            {report.status}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          {["⌘K", "J / K 이동", "A 승인", "R 반려"].map((k) => (
            <span key={k} className="rounded px-2 py-1" style={{ background: "#262A33", color: "#7E8694" }}>
              {k}
            </span>
          ))}
        </div>
      </div>

      {/* 본문 */}
      <div className="flex">
        {/* 원장 */}
        <div className="min-w-0 flex-1 px-6 py-5">
          <div className="text-[18px] font-bold">{report.title}</div>
          <div className="mt-1 font-mono text-[11.5px] tnum text-label-2">
            {report.author.name} · {report.author.team} · {report.period} · {report.itemCount} ITEMS
          </div>

          {/* 표 헤더 */}
          <div
            className="mt-4 flex items-center pb-2 font-mono text-[10.5px] font-semibold text-label"
            style={{ borderBottom: "1px solid #1A1D23" }}
          >
            <div style={{ width: 34 }}>#</div>
            <div style={{ width: 58 }}>DATE</div>
            <div style={{ width: 74 }}>분류</div>
            <div className="flex-1">내역</div>
            <div className="text-center" style={{ width: 88 }}>증빙</div>
            <div className="text-right" style={{ width: 120 }}>금액</div>
          </div>

          {/* 데이터 행 */}
          {report.items.map((it, idx) => (
            <div
              key={it.id}
              className="flex items-center text-[13px]"
              style={{
                padding: "9px 0",
                borderBottom: "1px solid #F3F4F6",
                background: it.flagged ? "#FEFBF4" : undefined,
                boxShadow: it.flagged ? "inset 3px 0 0 #C99016" : undefined,
              }}
            >
              <div className="font-mono text-label" style={{ width: 34 }}>{idx + 1}</div>
              <div className="font-mono tnum text-ink-soft" style={{ width: 58 }}>{it.date}</div>
              <div className="font-semibold" style={{ width: 74, color: CATEGORY_COLOR[it.category] }}>
                {it.category}
              </div>
              <div className="flex-1 pr-3 text-ink-soft">
                {it.flagged && <span className="mr-1 text-amber">⚠</span>}
                {it.desc}
              </div>
              <div className="text-center font-mono text-[11px]" style={{ width: 88 }}>
                <span style={{ color: it.hasReceipt ? "#7A818C" : "#9A6A14" }}>
                  {it.hasReceipt ? "첨부" : "검토필요"}
                </span>
              </div>
              <div className="text-right font-mono font-semibold tnum" style={{ width: 120 }}>
                {won(it.amount)}
              </div>
            </div>
          ))}

          {/* SUBTOTAL */}
          <div className="flex items-center justify-between pt-3 font-mono">
            <span className="text-[11px] text-label">SUBTOTAL · {report.itemCount} ITEMS</span>
            <span className="text-[17px] font-bold tnum">₩ {comma(report.total)}</span>
          </div>
        </div>

        {/* 거터 */}
        <div className="w-[262px] border-l border-line-soft bg-surface px-5 py-5">
          <div className="font-mono text-[10.5px] font-semibold tracking-wide text-label">APPROVAL FLOW</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {report.approvalChain.map((s) => {
              const t = TONE_STYLE[s.tone];
              return (
                <div key={s.step} className="flex items-center gap-2.5">
                  <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: t.dot }} />
                  <div className="flex-1">
                    <div className="text-[12.5px] font-semibold">{s.person.name}</div>
                    <div className="text-[10.5px] text-label-2">{s.step}</div>
                  </div>
                  <span className="font-mono text-[10.5px]" style={{ color: t.badgeText }}>{s.state}</span>
                </div>
              );
            })}
          </div>

          <div className="my-4 border-t border-line-soft" />

          <div className="font-mono text-[10.5px] font-semibold tracking-wide text-label">SUMMARY</div>
          <div className="mt-3 flex flex-col gap-2 font-mono text-[12px]">
            <Row k="항목" v={`${report.itemCount}건`} />
            <Row k="검토필요" v={`${report.flagCount}건`} amber />
            <Row k="합계" v={won(report.total)} bold />
          </div>
        </div>
      </div>

      {/* 커맨드 바 */}
      <div className="flex items-center justify-between border-t border-line-soft bg-surface-3 px-6 py-3.5">
        <span className="font-mono text-[11.5px] text-label-2">▸ 단축키로 결재하거나 버튼을 누르세요</span>
        <div className="w-[520px]">
          <ApprovalActions docNo={report.docNo} variant="inline" showHold />
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, amber, bold }: { k: string; v: string; amber?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-label-2">{k}</span>
      <span className="tnum" style={{ color: amber ? "#9A6A14" : undefined, fontWeight: bold ? 700 : 500 }}>
        {v}
      </span>
    </div>
  );
}
