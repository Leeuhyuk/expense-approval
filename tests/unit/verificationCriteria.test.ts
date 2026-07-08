import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareTableRows } from "../../src/domain/formatters";
import type { TableRow } from "../../src/types";

function makeRows(count: number): TableRow[] {
  return Array.from({ length: count }, (_, index) => ({
    요청번호: `PR-PERF-${String(index).padStart(5, "0")}`,
    요청일: `2024-06-${String((index % 28) + 1).padStart(2, "0")}`,
    거래처: `거래처-${index % 37}`,
    금액: `${(count - index).toLocaleString("ko-KR")} 원`,
    상태: index % 3 === 0 ? "승인 대기" : index % 3 === 1 ? "승인 완료" : "반려",
  }));
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function relativeLuminance(hex: string) {
  return hexToRgb(hex)
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(foreground: string, background: string) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("verification criteria", () => {
  it("handles 1,000 and 10,000 row table fixtures", () => {
    for (const count of [1_000, 10_000]) {
      const rows = makeRows(count);
      const startedAt = Date.now();
      const sortedRows = [...rows].sort((a, b) => compareTableRows(a, b, "금액", "asc"));
      const elapsedMs = Date.now() - startedAt;

      assert.equal(sortedRows.length, count);
      assert.ok(elapsedMs < 5_000, `${count} row sort exceeded 5s: ${elapsedMs}ms`);
    }
  });

  it("keeps primary text and action contrast above the basic threshold", () => {
    assert.ok(contrastRatio("#102747", "#ffffff") >= 4.5);
    assert.ok(contrastRatio("#0a1f42", "#ffffff") >= 4.5);
    assert.ok(contrastRatio("#ffffff", "#078f89") >= 3);
  });
});
