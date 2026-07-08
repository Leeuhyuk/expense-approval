import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBankTransferExportSummary } from "../../backend/src/routes/disbursements";
import { scanSensitiveDataExposureProject } from "../../scripts/sensitiveDataExposureScanner.mjs";

describe("sensitive data exposure controls", () => {
  it("keeps raw account and personal data out of production screens, logs, errors, and browser console", () => {
    const result = scanSensitiveDataExposureProject(process.cwd());
    assert.deepEqual(result.issues, []);
  });

  it("redacts bank transfer screen and audit summaries while leaving the authorized CSV flow separate", () => {
    const summary = buildBankTransferExportSummary(
      [
        {
          지급번호: "PMT-2026-0086",
          승인번호: "PR-2026-0057",
          지급예정일: "2026-07-06",
          거래처: "이노베이션(주)",
          사업자번호: "110-81-12345",
          은행: "가나다은행",
          계좌번호: "110-555-777777",
          금액: 7_800_000,
          요청부서: "재무팀",
          요청자: "김민수",
          지급상태: "지급 예정",
          계좌확인: "확인 완료",
          거래처계좌확인: "확인 완료",
          결재상태: "승인 완료",
          결재단계확인: "확인 완료",
        },
      ],
      {},
      new Date("2026-07-05T08:30:00.000Z"),
    );

    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes("110-555-777777"), false);
    assert.equal("계좌번호" in summary.reconciliationRows[0], false);
  });
});
