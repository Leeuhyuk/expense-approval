import { CATEGORY_COLOR, type Category, type ReportStatus } from "@/lib/types";

/** 이니셜 원형 아바타 */
export function Avatar({
  initial,
  size = 30,
  bg = "#2B50CE",
  color = "#fff",
  border,
}: {
  initial: string;
  size?: number;
  bg?: string;
  color?: string;
  border?: string;
}) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold shrink-0"
      style={{
        width: size,
        height: size,
        background: bg,
        color,
        fontSize: Math.round(size * 0.43),
        border: border ? `1px solid ${border}` : undefined,
      }}
    >
      {initial}
    </span>
  );
}

/** 경비 분류 칩 (점 + 텍스트) */
export function CategoryChip({ category }: { category: Category }) {
  const c = CATEGORY_COLOR[category];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: c }}>
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: c }} />
      {category}
    </span>
  );
}

/** 증빙 상태 pill */
export function ReceiptPill({ hasReceipt }: { hasReceipt: boolean }) {
  return hasReceipt ? (
    <span className="inline-block rounded-md px-2 py-1 text-[11px] font-semibold bg-line-faint text-[#7A818C]">
      첨부
    </span>
  ) : (
    <span className="inline-block rounded-md px-2 py-1 text-[11px] font-semibold bg-amber-bg text-amber-text">
      검토 필요
    </span>
  );
}

/** 보고서 상태 pill */
export function StatusPill({ status }: { status: ReportStatus }) {
  const map: Record<ReportStatus, { bg: string; text: string; dot: string }> = {
    "검토 대기": { bg: "var(--color-amber-bg)", text: "var(--color-amber-text)", dot: "#C99016" },
    승인: { bg: "var(--color-approve-bg)", text: "var(--color-approve-text)", dot: "#1F8A5B" },
    반려: { bg: "var(--color-reject-bg)", text: "var(--color-reject-text)", dot: "#C8453B" },
    보류: { bg: "var(--color-line-faint)", text: "var(--color-label-2)", dot: "#868D98" },
  };
  const s = map[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
      style={{ background: s.bg, color: s.text }}
    >
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: s.dot }} />
      {status}
    </span>
  );
}

/** 진행 바 */
export function ProgressBar({
  ratio,
  width = 160,
  height = 7,
  fill = "#2B50CE",
  track = "#E4E6EA",
}: {
  ratio: number; // 0~100
  width?: number | string;
  height?: number;
  fill?: string;
  track?: string;
}) {
  return (
    <span
      className="inline-block overflow-hidden rounded-full align-middle"
      style={{ width, height, background: track }}
    >
      <span className="block h-full rounded-full" style={{ width: `${ratio}%`, background: fill }} />
    </span>
  );
}
