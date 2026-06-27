"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitDecision, type DecisionResult } from "@/app/actions";

/**
 * 결재 의견 + 승인/반려(/보류) 버튼 + 결과 배너.
 * 결정 후 액션 영역이 결과 배너로 치환됩니다 (README Interactions).
 */
export function ApprovalActions({
  docNo,
  variant = "stack",
  showHold = false,
}: {
  docNo: string;
  /** stack: 세로(레일), inline: 가로(액션 바), mobile: 큰 버튼만 */
  variant?: "stack" | "inline" | "mobile";
  showHold?: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const r = await submitDecision(docNo, decision, comment);
      setResult(r);
      if (r.ok) router.refresh(); // 결재선/상태 변화 반영
    });
  }

  // 성공 → 결과 배너로 치환
  if (result?.ok) {
    const approved = result.decision === "approved";
    return (
      <div
        className="rounded-[9px] px-4 py-3.5 text-[13px] font-semibold"
        style={{
          background: approved ? "var(--color-approve-bg)" : "var(--color-reject-bg)",
          border: `1px solid ${approved ? "var(--color-approve-border)" : "var(--color-reject-border)"}`,
          color: approved ? "var(--color-approve-text)" : "var(--color-reject-text)",
        }}
      >
        {approved ? "✓ " : ""}
        {result.message}
      </div>
    );
  }

  const inline = variant === "inline";
  const mobile = variant === "mobile";

  // 모바일: 의견 입력 없이 큰 버튼만
  if (mobile) {
    return (
      <div className="flex flex-col gap-2.5">
        {result && !result.ok && (
          <div className="rounded-lg bg-reject-bg px-3 py-2 text-[12px] font-semibold text-reject-text">
            {result.message}
          </div>
        )}
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("rejected")}
            className="flex-1 rounded-[14px] border border-reject-btnborder text-[15px] font-bold text-reject transition-colors hover:bg-reject-bg disabled:opacity-50"
            style={{ padding: 15 }}
          >
            반려
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("approved")}
            style={{ flex: 1.7, padding: 15, boxShadow: "0 4px 14px rgba(31,138,91,.32)" }}
            className="rounded-[14px] bg-approve text-[15px] font-bold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {pending ? "처리 중…" : "승인"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={inline ? "flex items-center gap-2.5" : "flex flex-col gap-2.5"}>
      {inline ? (
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="결재 의견 (선택)"
          className="flex-1 rounded-lg border border-line-strong bg-white px-3.5 py-3 text-[13px] outline-none focus:border-accent"
        />
      ) : (
        <>
          <div className="text-[11px] font-semibold text-label">결재 의견</div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="의견을 입력하세요 (선택)"
            className="h-[62px] w-full resize-none rounded-lg border border-line-strong bg-white px-3 py-2.5 text-[13px] outline-none focus:border-accent"
          />
        </>
      )}

      {/* 실패 메시지 (권한 없음 등) */}
      {result && !result.ok && (
        <div className="rounded-lg bg-reject-bg px-3 py-2 text-[12px] font-semibold text-reject-text">
          {result.message}
        </div>
      )}

      <div className="flex gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className="flex-1 rounded-[9px] border border-reject-btnborder px-3 py-3 text-sm font-bold text-reject transition-colors hover:bg-reject-bg disabled:opacity-50"
        >
          반려
        </button>
        {showHold && (
          <button
            type="button"
            disabled={pending}
            className="flex-1 rounded-[9px] border border-line-strong px-3 py-3 text-sm font-bold text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            보류
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approved")}
          style={{ flex: 1.6, boxShadow: "0 2px 8px rgba(31,138,91,.3)" }}
          className="rounded-[9px] bg-approve px-3 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-50"
        >
          {pending ? "처리 중…" : "승인"}
        </button>
      </div>
    </div>
  );
}
