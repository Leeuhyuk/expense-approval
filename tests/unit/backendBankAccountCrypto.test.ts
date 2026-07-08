import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptBankAccount, encryptBankAccount, maskBankAccount } from "../../backend/src/security/bankAccountCrypto";

describe("backend bank account crypto", () => {
  it("encrypts, decrypts, and masks bank account numbers", () => {
    const previousSecret = process.env.BANK_ACCOUNT_SECRET;
    process.env.BANK_ACCOUNT_SECRET = "test-bank-account-secret-32-characters";
    try {
      const encrypted = encryptBankAccount("110-555-777777");
      assert.notEqual(encrypted, "110-555-777777");
      assert.match(encrypted, /^v1:/);
      assert.equal(decryptBankAccount(encrypted), "110-555-777777");
      assert.equal(maskBankAccount("110-555-777777"), "110-****-7777");
      assert.equal(decryptBankAccount("pending:legacy"), null);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.BANK_ACCOUNT_SECRET;
      } else {
        process.env.BANK_ACCOUNT_SECRET = previousSecret;
      }
    }
  });
});
