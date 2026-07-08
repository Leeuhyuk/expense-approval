import { AccountVerificationStatus } from "../../generated/prisma/index.js";
import { decryptBankAccount } from "../security/bankAccountCrypto.js";

type BankAccountVerificationInput = {
  bankName: string;
  accountEncrypted: string;
  accountHolder: string;
  businessNumber: string;
  disbursementCode: string;
  currentDisbursementStatus: AccountVerificationStatus;
  currentVendorStatus: AccountVerificationStatus;
  vendorActive: boolean;
};

export type BankAccountVerificationResult = {
  adapter: string;
  status: AccountVerificationStatus;
  code: string;
  message: string;
  retryable: boolean;
};

const externalAdapterName = "external-bank-account-api";
const internalAdapterName = "internal-bank-account-policy";

function externalVerificationEndpoint(env = process.env) {
  return (env.BANK_ACCOUNT_VERIFICATION_ENDPOINT || env.ERP_BANK_ACCOUNT_VERIFICATION_ENDPOINT || "").trim();
}

function externalVerificationToken(env = process.env) {
  return (env.ERP_BANK_API_TOKEN || env.BANK_ACCOUNT_VERIFICATION_TOKEN || "").trim();
}

export function bankAccountVerificationAdapterName(env = process.env) {
  const mode = (env.BANK_ACCOUNT_VERIFICATION_MODE || "").trim().toLowerCase();
  return mode === "external" || Boolean(externalVerificationEndpoint(env)) ? externalAdapterName : internalAdapterName;
}

export function internalBankAccountVerificationPolicy(input: Pick<BankAccountVerificationInput, "currentDisbursementStatus" | "currentVendorStatus" | "vendorActive">, env = process.env): BankAccountVerificationResult {
  const adapter = bankAccountVerificationAdapterName(env);
  if (!input.vendorActive || input.currentVendorStatus === AccountVerificationStatus.INACTIVE || input.currentDisbursementStatus === AccountVerificationStatus.INACTIVE) {
    return {
      adapter,
      status: AccountVerificationStatus.INACTIVE,
      code: "VENDOR_ACCOUNT_INACTIVE",
      message: "비활성 거래처 또는 비활성 계좌는 계좌 재확인 후에도 지급할 수 없습니다.",
      retryable: false,
    };
  }
  if (input.currentVendorStatus === AccountVerificationStatus.MISMATCH || input.currentDisbursementStatus === AccountVerificationStatus.MISMATCH) {
    return {
      adapter,
      status: AccountVerificationStatus.MISMATCH,
      code: "BANK_ACCOUNT_MISMATCH",
      message: "거래처 계좌 또는 지급 건 계좌 정보가 예금주/계좌 검증과 일치하지 않습니다.",
      retryable: true,
    };
  }
  if (input.currentVendorStatus === AccountVerificationStatus.PENDING || input.currentDisbursementStatus === AccountVerificationStatus.PENDING) {
    return {
      adapter,
      status: AccountVerificationStatus.PENDING,
      code: "BANK_VERIFICATION_PENDING",
      message: "은행 계좌 검증이 아직 완료되지 않았습니다.",
      retryable: true,
    };
  }
  return {
    adapter,
    status: AccountVerificationStatus.VERIFIED,
    code: "BANK_ACCOUNT_VERIFIED",
    message: "거래처 계좌와 지급 건 계좌 검증이 완료되었습니다.",
    retryable: false,
  };
}

function normalizeExternalStatus(value: unknown): AccountVerificationStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (["VERIFIED", "MATCHED", "OK", "SUCCESS", "확인 완료", "일치"].includes(normalized)) return AccountVerificationStatus.VERIFIED;
  if (["MISMATCH", "UNMATCHED", "FAILED", "FAIL", "계좌 불일치", "불일치"].includes(normalized)) return AccountVerificationStatus.MISMATCH;
  if (["PENDING", "WAITING", "UNKNOWN", "확인 대기"].includes(normalized)) return AccountVerificationStatus.PENDING;
  if (["INACTIVE", "CLOSED", "DISABLED", "비활성"].includes(normalized)) return AccountVerificationStatus.INACTIVE;
  return null;
}

function resultFromStatus(status: AccountVerificationStatus, adapter: string, code: string, message: string): BankAccountVerificationResult {
  return {
    adapter,
    status,
    code,
    message,
    retryable: status === AccountVerificationStatus.PENDING || status === AccountVerificationStatus.MISMATCH,
  };
}

export async function verifyBankAccount(input: BankAccountVerificationInput, env = process.env): Promise<BankAccountVerificationResult> {
  const localPolicy = internalBankAccountVerificationPolicy(input, env);
  if (localPolicy.status === AccountVerificationStatus.INACTIVE) return localPolicy;

  const endpoint = externalVerificationEndpoint(env);
  const mode = (env.BANK_ACCOUNT_VERIFICATION_MODE || "").trim().toLowerCase();
  if (!endpoint) {
    if (mode === "external") {
      return resultFromStatus(AccountVerificationStatus.PENDING, externalAdapterName, "BANK_VERIFICATION_ENDPOINT_MISSING", "외부 은행 계좌 검증 endpoint가 서버 환경에 없습니다.");
    }
    return resultFromStatus(AccountVerificationStatus.VERIFIED, internalAdapterName, "BANK_ACCOUNT_VERIFIED", "내부 계좌 검증 정책으로 확인 완료 처리되었습니다.");
  }
  const token = externalVerificationToken(env);
  if (!token) {
    return resultFromStatus(AccountVerificationStatus.PENDING, externalAdapterName, "BANK_VERIFICATION_CREDENTIAL_MISSING", "은행 계좌 검증 credential이 서버 환경에 없습니다.");
  }
  const accountNumber = decryptBankAccount(input.accountEncrypted);
  if (!accountNumber) {
    return resultFromStatus(AccountVerificationStatus.MISMATCH, externalAdapterName, "BANK_ACCOUNT_DECRYPT_FAILED", "거래처 계좌번호를 복호화할 수 없어 검증할 수 없습니다.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bankName: input.bankName,
        accountNumber,
        accountHolder: input.accountHolder,
        businessNumber: input.businessNumber,
        disbursementCode: input.disbursementCode,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return resultFromStatus(AccountVerificationStatus.PENDING, externalAdapterName, `BANK_VERIFICATION_HTTP_${response.status}`, `은행 계좌 검증 API가 HTTP ${response.status}를 반환했습니다.`);
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const status =
      payload.verified === true
        ? AccountVerificationStatus.VERIFIED
        : payload.verified === false
          ? AccountVerificationStatus.MISMATCH
          : normalizeExternalStatus(payload.status ?? payload.result ?? payload.verdict);
    if (!status) {
      return resultFromStatus(AccountVerificationStatus.PENDING, externalAdapterName, "BANK_VERIFICATION_UNKNOWN_RESPONSE", "은행 계좌 검증 API 응답 상태를 해석할 수 없습니다.");
    }
    const code = typeof payload.code === "string" && payload.code.trim() ? payload.code.trim() : status === AccountVerificationStatus.VERIFIED ? "BANK_ACCOUNT_VERIFIED" : "BANK_ACCOUNT_NOT_VERIFIED";
    const message = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : status === AccountVerificationStatus.VERIFIED ? "은행 계좌 검증 API에서 일치로 확인되었습니다." : "은행 계좌 검증 API에서 일치하지 않는 결과를 반환했습니다.";
    return resultFromStatus(status, externalAdapterName, code, message);
  } catch (error) {
    return resultFromStatus(AccountVerificationStatus.PENDING, externalAdapterName, "BANK_VERIFICATION_UNAVAILABLE", error instanceof Error ? error.message : "은행 계좌 검증 API 호출 실패");
  } finally {
    clearTimeout(timeout);
  }
}
