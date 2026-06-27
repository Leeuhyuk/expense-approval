import type { Report } from "@/lib/types";
import { TONE_STYLE, CATEGORY_COLOR } from "@/lib/types";
import { won, percent } from "@/lib/format";
import { Avatar } from "@/components/primitives";
import { ApprovalActions } from "@/components/ApprovalActions";

/** B · 워크플로우 중심 — 파이프라인 + 통계 (width 1240px) */
export function PipelineView({ report }: { report: Report }) {
  const N = report.approvalChain.length;
  return (
    <div
      className="mx-auto overflow-hidden rounded-[14px] border border-line bg-white"
      style={{ width: 1240, boxShadow: "var(--shadow-card)" }}
    >
      {/* 헤더 */}
      <div
        className="flex items-center justify-between px-7 py-5"
        style={{ background: "linear-gradient(180deg,#FBFCFE,#fff)" }}
      >
        <div>
          <div className="flex items-center gap-2.5 text-[12px] text-label-2">
            <span className="font-mono font-semibold text-accent">{report.docNo}</span>
            <span className="font-mono tnum">{report.period}</span>
          </div>
          <div className="mt-1 text-[20px] font-extrabold tracking-[-0.01em]">{report.title}</div>
        </div>
        <div className="flex items-center gap-2.5 rounded-full border border-line-soft bg-white px-3 py-2">
          <Avatar initial={report.author.initial} size={28} />
          <div className="text-[12.5px]">
            <div className="font-bold leading-none">{report.author.name}</div>
            <div className="mt-1 text-label-2">{report.author.team} · {report.author.role}</div>
          </div>
        </div>
      </div>

      {/* 결재 파이프라인 */}
      <div className="relative border-y border-line-soft bg-surface-3 px-7 py-6">
        {/* 연결선 (노드 뒤, 링 세로중심) */}
        <div className="pointer-events-none absolute inset-x-7" style={{ top: 24 + 21 }}>
          {report.approvalChain.slice(0, -1).map((s, i) => (
            <span
              key={i}
              className="absolute"
              style={{
                left: `${((i + 0.5) / N) * 100}%`,
                width: `${(1 / N) * 100}%`,
                height: 2,
                background: s.tone === "done" ? "#1F8A5B" : "#DEE0E5",
              }}
            />
          ))}
        </div>
        <div className="relative flex">
          {report.approvalChain.map((s) => {
            const t = TONE_STYLE[s.tone];
            return (
              <div key={s.step} className="flex flex-1 flex-col items-center text-center">
                <span
                  className="flex items-center justify-center rounded-full bg-white font-bold"
                  style={{
                    width: 42,
                    height: 42,
                    border: `2px solid ${t.dot}`,
                    color: s.tone === "wait" ? "#B6BCC6" : t.dot,
                    boxShadow: s.tone === "current" ? "0 0 0 4px #EEF1FD" : undefined,
                  }}
                >
                  {s.person.initial}
                </span>
                <div className="mt-2 text-[11px] font-semibold text-label">{s.step}</div>
                <div className="text-[13px] font-bold">{s.person.name}</div>
                <div className="text-[11px] text-label-2">{s.person.role}</div>
                <span
                  className="mt-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold"
                  style={{ background: t.badgeBg, color: t.badgeText }}
                >
                  {s.state}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 통계 4카드 */}
      <div className="flex gap-3.5 px-7 py-6">
        <StatCard label="총 청구액" value={won(report.total)} />
        <StatCard label="청구 항목" value={`${report.itemCount}건`} />
        <StatCard label="한도 사용률" value={percent(report.usage)}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-faint">
            <div className="h-full rounded-full bg-accent" style={{ width: `${report.usage}%` }} />
          </div>
        </StatCard>
        <StatCard label="검토 필요" value={`${report.flagCount}건`} amber />
      </div>

      {/* 분류별 지출 + 검토 필요 항목 */}
      <div className="grid grid-cols-2 gap-[22px] px-7 pb-6">
        <section className="rounded-[11px] border border-line-soft p-5">
          <div className="mb-4 text-[13px] font-bold">분류별 지출</div>
          <div className="flex flex-col gap-3.5">
            {report.categories.map((c) => {
              const color = CATEGORY_COLOR[c.category];
              return (
                <div key={c.category}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: color }} />
                      {c.category}
                    </span>
                    <span className="font-mono text-[12.5px] tnum text-ink-soft">
                      {won(c.amount)} · {percent(c.ratio)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-line-faint">
                    <div className="h-full rounded-full" style={{ width: `${c.ratio}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[11px] border border-line-soft p-5">
          <div className="mb-4 text-[13px] font-bold">검토 필요 항목</div>
          <div className="flex flex-col gap-3">
            {report.items.filter((i) => i.flagged).map((i) => (
              <div
                key={i.id}
                className="rounded-[10px] border border-amber-border bg-flag-row p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 7, height: 7, background: CATEGORY_COLOR[i.category] }}
                    />
                    {i.desc}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tnum">{won(i.amount)}</span>
                </div>
                <div className="mt-1.5 text-[12px] text-amber-text">⚠ {i.flagReason}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 액션 바 */}
      <div className="border-t border-line-soft bg-surface px-7 py-4">
        <ApprovalActions docNo={report.docNo} variant="inline" showHold />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  children,
  amber,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  amber?: boolean;
}) {
  return (
    <div
      className="flex-1 rounded-[11px] border p-4"
      style={
        amber
          ? { background: "var(--color-flag-row)", borderColor: "var(--color-amber-border)" }
          : { borderColor: "var(--color-line-soft)" }
      }
    >
      <div className="text-[11.5px] font-semibold" style={{ color: amber ? "#9A6A14" : "var(--color-label)" }}>
        {label}
      </div>
      <div
        className="mt-1 text-[22px] font-extrabold font-mono tnum"
        style={amber ? { color: "#9A6A14" } : undefined}
      >
        {value}
      </div>
      {children}
    </div>
  );
}
