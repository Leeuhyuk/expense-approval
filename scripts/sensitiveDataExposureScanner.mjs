import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionSourceFiles = [
  "backend/src/routes/pageResources.ts",
  "backend/src/routes/disbursements.ts",
  "backend/src/operations/dataQuality.ts",
  "backend/src/security/bankAccountCrypto.ts",
  "src/main.tsx",
  "src/api/service.ts",
  "src/api/contracts.ts",
  "src/api/errors.ts",
];

const frontendBrowserFiles = ["src/main.tsx", "src/api/service.ts", "src/api/contracts.ts", "src/api/errors.ts"];

const rawAccountLiteralPattern = /(?<![A-Fa-f0-9-])\d{2,6}-\d{2,6}-\d{4,8}(?![A-Fa-f0-9-])/g;
const residentIdPattern = /(?<![A-Fa-f0-9-])\d{6}-[1-4]\d{6}(?![A-Fa-f0-9-])/g;

function readProjectFile(root, path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, "utf8");
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function findFunctionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) return "";
  const bodyStart = source.indexOf("{", start);
  if (bodyStart < 0) return "";

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index + 1);
  }
  return "";
}

function issue(filePath, ruleId, message, line = 1) {
  return { filePath, line, ruleId, message };
}

function requirePattern(issues, source, filePath, ruleId, pattern, message) {
  if (!pattern.test(source)) {
    issues.push(issue(filePath, ruleId, message));
  }
}

function rejectPattern(issues, source, filePath, ruleId, pattern, message) {
  const match = pattern.exec(source);
  if (match) {
    issues.push(issue(filePath, ruleId, message, lineAt(source, match.index)));
  }
}

function rejectRawAccountLiterals(issues, source, filePath) {
  const pattern = new RegExp(rawAccountLiteralPattern.source, "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const digits = match[0].replace(/\D/g, "");
    if (/^0+$/.test(digits)) continue;
    issues.push(issue(
      filePath,
      "raw-account-literal",
      "Production source must not contain literal raw bank account numbers outside fixtures/tests.",
      lineAt(source, match.index),
    ));
    return;
  }
}

export function scanSensitiveDataExposureProject(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  const issues = [];
  const sources = new Map();

  for (const path of productionSourceFiles) {
    const source = readProjectFile(root, path);
    if (source === null) {
      issues.push(issue(path, "missing-production-source", "Production sensitive-data source file is missing."));
      continue;
    }
    sources.set(path, source);
  }

  const vendorSource = sources.get("backend/src/routes/pageResources.ts") ?? "";
  requirePattern(
    issues,
    vendorSource,
    "backend/src/routes/pageResources.ts",
    "vendor-list-masked-account",
    /function toVendorRow[\s\S]*bankAccountMasked/,
    "Vendor list/detail rows must expose bankAccountMasked instead of raw or encrypted account values.",
  );
  requirePattern(
    issues,
    vendorSource,
    "backend/src/routes/pageResources.ts",
    "vendor-create-encrypted-account",
    /bankAccountEncrypted:\s*encryptBankAccount\(bankAccount\)/,
    "Vendor create must store bank accounts encrypted.",
  );
  requirePattern(
    issues,
    vendorSource,
    "backend/src/routes/pageResources.ts",
    "vendor-update-encrypted-account",
    /data\.bankAccountEncrypted\s*=\s*encryptBankAccount\(bankAccount\)/,
    "Vendor update must store bank accounts encrypted.",
  );
  requirePattern(
    issues,
    vendorSource,
    "backend/src/routes/pageResources.ts",
    "vendor-audit-masked-row",
    /createAudit\(tx, request, user, "vendor", item\.id, "create", null, toVendorRow\(item\)[\s\S]*createAudit\(tx, request, user, "vendor", before\.id, "update", toVendorRow\(before\), afterRow/,
    "Vendor create/update audit payloads must use masked table rows, not raw request rows.",
  );

  const disbursementSource = sources.get("backend/src/routes/disbursements.ts") ?? "";
  requirePattern(
    issues,
    disbursementSource,
    "backend/src/routes/disbursements.ts",
    "disbursement-list-masked-account",
    /function toDisbursementRow[\s\S]*bankAccountMasked/,
    "Disbursement list/detail rows must expose masked vendor account values.",
  );
  requirePattern(
    issues,
    disbursementSource,
    "backend/src/routes/disbursements.ts",
    "bank-transfer-authorized-export",
    /hasPermission\(user,\s*"disbursement:execute"\)[\s\S]*buildBankTransferCsv\(rows\)/,
    "Raw account values may only appear in the authorized bank transfer export flow.",
  );
  requirePattern(
    issues,
    disbursementSource,
    "backend/src/routes/disbursements.ts",
    "bank-transfer-audit-summary-only",
    /afterValue:\s*summary as Prisma\.InputJsonObject/,
    "Bank transfer export audit logs must store the redacted summary instead of the raw CSV rows.",
  );

  const transferSummaryBody = findFunctionBody(disbursementSource, "buildBankTransferExportSummary");
  if (!transferSummaryBody) {
    issues.push(issue("backend/src/routes/disbursements.ts", "bank-transfer-summary-missing", "Bank transfer export summary function is missing."));
  } else {
    rejectPattern(
      issues,
      transferSummaryBody,
      "backend/src/routes/disbursements.ts",
      "bank-transfer-summary-raw-account",
      /계좌번호|accountNumber|bankAccountEncrypted|decryptBankAccount/,
      "Bank transfer screen/audit reconciliation summary must not include raw account fields.",
    );
  }

  const bankResultBody = findFunctionBody(disbursementSource, "bankResultJson");
  if (!bankResultBody) {
    issues.push(issue("backend/src/routes/disbursements.ts", "bank-result-json-missing", "Bank result audit JSON builder is missing."));
  } else {
    rejectPattern(
      issues,
      bankResultBody,
      "backend/src/routes/disbursements.ts",
      "bank-result-raw-account",
      /계좌번호|accountNumber|bankAccount|bankAccountEncrypted|decryptBankAccount/,
      "Bank result reconciliation errors and audit payloads must not include raw account fields.",
    );
  }

  const dataQualitySource = sources.get("backend/src/operations/dataQuality.ts") ?? "";
  rejectPattern(
    issues,
    dataQualitySource,
    "backend/src/operations/dataQuality.ts",
    "data-quality-raw-account",
    /decryptBankAccount|bankAccountDecrypted|rawAccount/,
    "Data quality summaries must not decrypt or expose raw account values.",
  );
  requirePattern(
    issues,
    dataQualitySource,
    "backend/src/operations/dataQuality.ts",
    "data-quality-encrypted-masked-check",
    /bankAccountEncrypted\.startsWith\("v1:"\)[\s\S]*bankAccountMasked\.includes\("\*\*\*\*"\)/,
    "Data quality checks must verify encrypted storage and masked display fields.",
  );

  for (const path of frontendBrowserFiles) {
    const source = sources.get(path) ?? "";
    rejectPattern(
      issues,
      source,
      path,
      "frontend-console-sensitive-risk",
      /console\.(?:log|debug|info|warn|error)\s*\(/,
      "Production browser entrypoints must not write account or personal data candidates to the console.",
    );
  }

  for (const [path, source] of sources) {
    rejectRawAccountLiterals(issues, source, path);
    rejectPattern(
      issues,
      source,
      path,
      "resident-id-literal",
      new RegExp(residentIdPattern.source, "g"),
      "Production source must not contain resident-registration-number style personal identifiers.",
    );
  }

  return { root, scannedFiles: sources.size, issues };
}
