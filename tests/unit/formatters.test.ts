import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareTableRows, decodeSort, encodeSort, formatCurrencyWon, formatDateIso } from "../../src/domain/formatters";
import type { TableRow } from "../../src/types";

describe("formatters", () => {
  it("formats won currency and ISO dates consistently", () => {
    assert.equal(formatCurrencyWon(1234567), "1,234,567 원");
    assert.equal(formatDateIso("2026-07-04T09:00:00+09:00"), "2026-07-04");
  });

  it("encodes and decodes table sort state", () => {
    assert.deepEqual(decodeSort(encodeSort("금액", "desc")), { field: "금액", direction: "desc" });
    assert.equal(decodeSort("금액:sideways"), null);
  });

  it("sorts money, date, and Korean text values", () => {
    const low: TableRow = { 금액: "1,000 원", 요청일: "2026-07-01", 거래처: "가나다" };
    const high: TableRow = { 금액: "10,000 원", 요청일: "2026-07-04", 거래처: "하나" };

    assert.ok(compareTableRows(low, high, "금액", "asc") < 0);
    assert.ok(compareTableRows(low, high, "요청일", "desc") > 0);
    assert.ok(compareTableRows(low, high, "거래처", "asc") < 0);
  });
});
