import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPageRow, deletePageRow, executePageAction, getPageRow, listPageRows, updatePageRow } from "../../src/api/mockApi";

describe("mock API layer", () => {
  it("supports list, detail, create, update, action, and delete patterns", async () => {
    const rowId = "PR-TEST-API";
    const row = {
      요청번호: rowId,
      요청일: "2024-06-10",
      거래처: "API테스트",
      부서: "재무팀",
      금액: "10,000 원",
      상태: "임시 저장",
    };

    const created = await createPageRow("payment-request", row);
    assert.equal(created.data.요청번호, rowId);

    const listed = await listPageRows("payment-request", { search: rowId, page: 1, pageSize: 5 });
    assert.equal(listed.data.total, 1);
    assert.equal(listed.data.rows[0].요청번호, rowId);

    const updated = await updatePageRow("payment-request", rowId, { 상태: "승인 대기" });
    assert.equal(updated.data?.상태, "승인 대기");

    const actioned = await executePageAction("payment-request", rowId, "submit", { 상태: "제출" });
    assert.equal(actioned.data?.상태, "제출");
    assert.equal(actioned.data?.["마지막 액션"], "submit");

    const deleted = await deletePageRow("payment-request", rowId);
    assert.equal(deleted.meta?.deleted, true);

    const missing = await getPageRow("payment-request", rowId);
    assert.equal(missing.data, null);
  });
});
