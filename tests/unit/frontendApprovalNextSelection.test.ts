import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend approval next selection", () => {
  const mainSource = () => readFileSync(resolve("src/main.tsx"), "utf8");

  it("updates the local row from the server response before selecting the next approval", () => {
    const source = mainSource();
    assert.match(source, /type UpdateSelectedRowOptions/, "table mutations must support post-success selection rules");
    assert.match(source, /const response = await erpApi\.updatePageRow/, "row updates must use the server response");
    assert.match(source, /const updatedRow = response\.data;/, "local rows must use the server-updated row only");
    assert.match(source, /if \(!updatedRow\) \{[\s\S]*setRefreshVersion/, "missing server rows must roll back and requery instead of fabricating local state");
    assert.match(source, /setRows\(mergedRows\)/, "the visible table must be updated immediately after mutation success");
  });

  it("selects the next processable approval and blocks duplicate bulk clicks", () => {
    const source = mainSource();
    assert.match(source, /function selectNextProcessableApprovalRow/, "approval processing must choose a next row explicitly");
    assert.match(source, /canCurrentUserProcessApproval\(row, currentUser\)/, "next approval selection must respect the current user's actionable rows");
    assert.match(source, /selectNextRow: \(rows, currentRow\) => selectNextProcessableApprovalRow\(rows, currentRow, currentUser\)/, "approval actions must pass the next-row selector");
    assert.match(source, /setSelectedIds\(new Set\(\)\)/, "bulk approval must clear selection until the server-refreshed list arrives");
  });
});
