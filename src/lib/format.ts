/** 금액을 ₩1,511,500 형식으로 */
export function won(amount: number): string {
  return `₩${amount.toLocaleString("ko-KR")}`;
}

/** 천 단위 콤마만 (₩ 없이) */
export function comma(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

/** 비율을 75.6% 형식으로 (소수 1자리) */
export function percent(ratio: number): string {
  return `${ratio.toFixed(1)}%`;
}
