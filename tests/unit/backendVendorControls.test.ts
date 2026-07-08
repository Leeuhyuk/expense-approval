import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateVendorBankAccount,
  validateVendorBusinessNumber,
  validateVendorTaxInvoiceEmail,
  validateVendorTaxIssueType,
} from "../../backend/src/routes/pageResources";

describe("backend vendor controls", () => {
  it("validates Korean business number format", () => {
    assert.equal(validateVendorBusinessNumber("123-45-67890"), true);
    assert.equal(validateVendorBusinessNumber("1234567890"), false);
    assert.equal(validateVendorBusinessNumber("12-345-67890"), false);
  });

  it("validates bank account and tax invoice metadata", () => {
    assert.equal(validateVendorBankAccount("110-555-777777"), true);
    assert.equal(validateVendorBankAccount("abc-555"), false);
    assert.equal(validateVendorTaxInvoiceEmail("tax@example.com"), true);
    assert.equal(validateVendorTaxInvoiceEmail("tax.example.com"), false);
    assert.equal(validateVendorTaxIssueType("이메일 발행"), true);
    assert.equal(validateVendorTaxIssueType("메신저 발행"), false);
  });
});
