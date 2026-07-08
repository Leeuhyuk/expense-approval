#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultEvidencePath = "docs/final-acceptance-evidence-template.md";

const requiredSections = [
  "Final Acceptance Identity",
  "Production Business Operation Proof",
  "Persistence And Multi-Session Proof",
  "Authorization And Audit Proof",
  "Backend Control Proof",
  "Incident Recovery Handoff",
  "Operations Ownership Sign-Off",
  "KPI And Error Rate Review",
  "Backlog And Release Plan",
  "Evidence Links",
  "Final Real-Use Sign-Off",
];

const requiredTerms = [
  "실제 production 사용자",
  "결제 요청 생성",
  "승인자",
  "재무팀",
  "지급 전 단계",
  "DB",
  "object storage",
  "새로고침",
  "재로그인",
  "다른 기기",
  "권한 없는 사용자",
  "UI",
  "API",
  "AuditLog",
  "security_events",
  "requestId",
  "중복 승인",
  "중복 지급",
  "승인 전 지급",
  "마감 후 변경",
  "계좌 불일치 지급",
  "backend",
  "rollback",
  "복구",
  "읽기 전용",
  "사용자 공지",
  "운영 책임자",
  "배포",
  "모니터링",
  "백업",
  "장애 대응",
  "사용자 지원",
  "KPI",
  "오류율",
  "go-live 승인 기준",
  "backlog",
  "운영 릴리즈 계획",
  "sign-off",
  "stable-operation",
  "기능 책임자",
  "보안 책임자",
  "재무 책임자",
];

const unresolvedPatterns = [
  /\bTBD\b/i,
  /\bpending\b/i,
  /<[^>\n]+>/,
];

const hashPattern = /^[a-f0-9]{64}$/i;
const passLikePattern = /\b(pass|passed|ok|success|successful|verified|approved|accepted|complete|completed|matched|clean|blocked|denied|handoff)\b/i;
const dateLikePattern = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?\b/;

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSection(source, section) {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(source);
}

function hasTerm(source, term) {
  return source.toLowerCase().includes(term.toLowerCase());
}

function unresolvedLines(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => unresolvedPatterns.some((pattern) => pattern.test(line)));
}

function markdownRows(source) {
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replace(/`/g, "").trim());
    if (cells.length < 2) continue;
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

function markdownTableValues(source) {
  const values = new Map();
  for (const cells of markdownRows(source)) {
    const [key, ...rest] = cells;
    if (!key || key === "항목" || key === "업무" || key === "차단 항목" || key === "운영 영역" || key === "책임 영역") continue;
    values.set(key, rest.join(" | ").trim());
  }
  return values;
}

function markdownRowByKey(source, key) {
  return markdownRows(source).find((cells) => cells[0] === key);
}

function looksLikeEvidenceReference(value) {
  const normalized = value.trim();
  return /(https:\/\/|[A-Z]+-[A-Z0-9-]+|\w+:\/\/|release\/|docs\/|artifact:|run:|requestId=|audit|log|db-row|storage-object)/i.test(normalized);
}

function parsePercent(value) {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return Number.NaN;
  return Number.parseFloat(match[1]);
}

function validateStructuredFinalAcceptanceFields(source, strict) {
  if (!strict) return [];

  const table = markdownTableValues(source);
  const checks = [];
  const releaseVersion = table.get("Release version") ?? "";
  const releaseRef = table.get("Release source ref") ?? "";
  const releaseManifestHash = table.get("Release manifest hash") ?? "";
  const goLiveEvidence = table.get("Production go-live evidence") ?? "";
  const stabilizationEvidence = table.get("Post go-live stabilization evidence") ?? "";
  const finalOwner = table.get("Final acceptance owner") ?? "";
  const decisionDate = table.get("Final decision date/time") ?? "";
  const stableReadiness = table.get("READINESS_TARGET=stable-operation npm run release:go-live-readiness") ?? "";
  const expectedHashEnv = String(process.env.EXPECTED_RELEASE_MANIFEST_SHA256 ?? "").trim();
  const expectedRefEnv = String(process.env.EXPECTED_RELEASE_SOURCE_REF ?? "").trim();
  const expectedVersionEnv = String(process.env.EXPECTED_RELEASE_VERSION ?? process.env.RELEASE_VERSION ?? "").trim();

  checks.push({
    label: "final acceptance evidence uses a valid release manifest hash",
    ok: hashPattern.test(releaseManifestHash),
    detail: releaseManifestHash || "missing Release manifest hash",
  });

  if (expectedHashEnv) {
    checks.push({
      label: "final acceptance evidence release manifest hash matches EXPECTED_RELEASE_MANIFEST_SHA256 env",
      ok: releaseManifestHash.toLowerCase() === expectedHashEnv.toLowerCase(),
      detail: `${releaseManifestHash || "missing"} / ${expectedHashEnv}`,
    });
  }

  if (expectedRefEnv) {
    checks.push({
      label: "final acceptance evidence release source ref matches EXPECTED_RELEASE_SOURCE_REF env",
      ok: releaseRef === expectedRefEnv,
      detail: `${releaseRef || "missing"} / ${expectedRefEnv}`,
    });
  }

  if (expectedVersionEnv) {
    checks.push({
      label: "final acceptance evidence release version matches expected release version",
      ok: releaseVersion === expectedVersionEnv,
      detail: `${releaseVersion || "missing"} / ${expectedVersionEnv}`,
    });
  }

  checks.push({
    label: "final acceptance evidence links production go-live evidence",
    ok: looksLikeEvidenceReference(goLiveEvidence) && passLikePattern.test(goLiveEvidence),
    detail: goLiveEvidence || "missing Production go-live evidence",
  });

  checks.push({
    label: "final acceptance evidence links post go-live stabilization evidence",
    ok: looksLikeEvidenceReference(stabilizationEvidence) && passLikePattern.test(stabilizationEvidence),
    detail: stabilizationEvidence || "missing Post go-live stabilization evidence",
  });

  checks.push({
    label: "final acceptance evidence records final owner and decision time",
    ok: finalOwner.trim().length >= 2 && dateLikePattern.test(decisionDate),
    detail: `${finalOwner || "missing owner"} / ${decisionDate || "missing decision time"}`,
  });

  checks.push({
    label: "final acceptance evidence stable-operation readiness passed with zero open P0",
    ok: passLikePattern.test(stableReadiness) && /\b(open\s*)?P0\b.*\b0\b|\b0\b.*\b(open\s*)?P0\b/i.test(stableReadiness),
    detail: stableReadiness || "missing stable-operation readiness result",
  });

  const businessRows = [
    "결제 요청 생성",
    "증빙 첨부",
    "승인자 처리",
    "재무팀 지급 전 단계 처리",
    "알림 확인",
    "보고서 생성/다운로드",
  ];
  for (const rowName of businessRows) {
    const row = markdownRowByKey(source, rowName);
    const user = row?.[1] ?? "";
    const evidence = row?.[3] ?? "";
    const result = row?.[4] ?? "";
    checks.push({
      label: `final acceptance production operation proof: ${rowName}`,
      ok: Boolean(row) && user.trim().length >= 2 && looksLikeEvidenceReference(evidence) && passLikePattern.test(result),
      detail: row ? `${user || "missing user"} / ${evidence || "missing evidence"} / ${result || "missing result"}` : `missing ${rowName}`,
    });
  }

  const persistenceEvidenceRows = [
    "PaymentRequest DB row",
    "ApprovalStep DB row",
    "Attachment metadata DB row",
    "object storage object evidence",
    "Disbursement DB row",
    "ReportRun 또는 report artifact evidence",
  ];
  for (const rowName of persistenceEvidenceRows) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance persistence evidence: ${rowName}`,
      ok: looksLikeEvidenceReference(value),
      detail: value || `missing ${rowName}`,
    });
  }

  for (const rowName of ["새로고침 후 데이터 유지", "재로그인 후 데이터 유지", "다른 기기 또는 다른 브라우저 접속 후 데이터 유지"]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance multi-session persistence proof: ${rowName}`,
      ok: passLikePattern.test(value),
      detail: value || `missing ${rowName}`,
    });
  }

  for (const rowName of [
    "권한 없는 사용자 UI 차단",
    "권한 없는 사용자 API 차단",
    "AuditLog evidence",
    "security_events evidence",
    "requestId correlation",
    "파일 직접 접근 차단",
    "원문 계좌번호 비노출 확인",
  ]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance authorization/audit proof: ${rowName}`,
      ok: looksLikeEvidenceReference(value) || passLikePattern.test(value),
      detail: value || `missing ${rowName}`,
    });
  }

  for (const rowName of [
    "중복 승인",
    "중복 지급",
    "승인 전 지급",
    "마감 후 변경",
    "계좌 불일치 지급",
    "stale rowVersion 저장",
    "중복 idempotencyKey replay",
  ]) {
    const row = markdownRowByKey(source, rowName);
    const evidence = row?.[1] ?? "";
    const result = row?.[2] ?? "";
    checks.push({
      label: `final acceptance backend control proof: ${rowName}`,
      ok: Boolean(row) && looksLikeEvidenceReference(evidence) && passLikePattern.test(result),
      detail: row ? `${evidence || "missing evidence"} / ${result || "missing result"}` : `missing ${rowName}`,
    });
  }

  for (const rowName of [
    "Rollback rehearsal evidence",
    "복구 절차 수행 가능 담당자",
    "읽기 전용 전환 판단 절차",
    "사용자 공지 절차/문구",
    "P0/P1 incident response owner",
    "requestId 기반 장애 재현/추적 절차",
    "Backup/PITR restore owner",
  ]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance recovery handoff proof: ${rowName}`,
      ok: value.trim().length >= 3 && (looksLikeEvidenceReference(value) || passLikePattern.test(value) || /owner|담당|절차|공지|restore|rollback/i.test(value)),
      detail: value || `missing ${rowName}`,
    });
  }

  for (const rowName of ["배포", "모니터링", "백업", "장애 대응", "사용자 지원", "권한/보안 운영"]) {
    const row = markdownRowByKey(source, rowName);
    const owner = row?.[1] ?? "";
    const evidence = row?.[2] ?? "";
    const result = row?.[3] ?? "";
    checks.push({
      label: `final acceptance operations ownership proof: ${rowName}`,
      ok: Boolean(row) && owner.trim().length >= 2 && looksLikeEvidenceReference(evidence) && passLikePattern.test(result),
      detail: row ? `${owner || "missing owner"} / ${evidence || "missing evidence"} / ${result || "missing result"}` : `missing ${rowName}`,
    });
  }

  const kpiWindow = table.get("KPI measurement window") ?? "";
  const kpiCriteria = table.get("go-live 승인 기준") ?? "";
  const processingKpi = table.get("Actual processing KPI") ?? "";
  const kpiDecision = table.get("KPI/오류율 decision") ?? "";
  checks.push({
    label: "final acceptance evidence records KPI measurement window",
    ok: dateLikePattern.test(kpiWindow),
    detail: kpiWindow || "missing KPI measurement window",
  });
  checks.push({
    label: "final acceptance evidence records accepted KPI criteria and processing KPI",
    ok: passLikePattern.test(kpiCriteria) && passLikePattern.test(processingKpi),
    detail: `${kpiCriteria || "missing criteria"} / ${processingKpi || "missing processing KPI"}`,
  });

  for (const rowName of [
    "Actual error rate",
    "API 5xx rate",
    "Approval failure rate",
    "Disbursement failure rate",
    "File upload failure rate",
    "Report failure rate",
  ]) {
    const value = table.get(rowName) ?? "";
    const percent = parsePercent(value);
    checks.push({
      label: `final acceptance error-rate threshold: ${rowName}`,
      ok: Number.isFinite(percent) && percent <= 1,
      detail: value || `missing ${rowName}`,
    });
  }

  checks.push({
    label: "final acceptance KPI/error-rate decision is approved",
    ok: passLikePattern.test(kpiDecision),
    detail: kpiDecision || "missing KPI/오류율 decision",
  });

  for (const rowName of ["Remaining P1/P2 backlog", "운영 릴리즈 계획", "Hotfix procedure owner", "Improvement intake process"]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance backlog/release plan: ${rowName}`,
      ok: value.trim().length >= 3 && !/\bP0\b\s*[:=]?\s*[1-9]/i.test(value),
      detail: value || `missing ${rowName}`,
    });
  }
  checks.push({
    label: "final acceptance next review date is scheduled",
    ok: dateLikePattern.test(table.get("Next review date") ?? ""),
    detail: table.get("Next review date") || "missing Next review date",
  });

  for (const rowName of [
    "Production transaction evidence",
    "DB persistence evidence",
    "object storage evidence",
    "Authorization/audit/security evidence",
    "Backend control evidence",
    "Incident recovery evidence",
    "Operations handoff evidence",
    "KPI dashboard/export",
    "Backlog/release plan link",
  ]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance evidence link: ${rowName}`,
      ok: looksLikeEvidenceReference(value),
      detail: value || `missing ${rowName}`,
    });
  }

  for (const rowName of ["기능 책임자", "보안 책임자", "재무 책임자", "운영 책임자"]) {
    const value = table.get(rowName) ?? "";
    checks.push({
      label: `final acceptance final sign-off: ${rowName}`,
      ok: dateLikePattern.test(value) && looksLikeEvidenceReference(value),
      detail: value || `missing ${rowName} sign-off`,
    });
  }

  return checks;
}

export function runFinalAcceptanceEvidenceChecks({
  projectRoot = process.cwd(),
  evidencePath = process.env.FINAL_ACCEPTANCE_EVIDENCE_PATH || defaultEvidencePath,
  strict = isTruthyEnvValue(process.env.FINAL_ACCEPTANCE_EVIDENCE_STRICT),
} = {}) {
  const checks = [];
  const resolvedPath = resolve(projectRoot, evidencePath);
  const exists = existsSync(resolvedPath);
  checks.push({
    label: "final acceptance evidence document exists",
    ok: exists,
    detail: evidencePath,
  });

  if (!exists) {
    return { ok: false, checks, failures: checks.filter((check) => !check.ok), strict, evidencePath };
  }

  const source = readFileSync(resolvedPath, "utf8");
  for (const section of requiredSections) {
    checks.push({
      label: `final acceptance evidence section: ${section}`,
      ok: hasSection(source, section),
      detail: section,
    });
  }

  const missingTerms = requiredTerms.filter((term) => !hasTerm(source, term));
  checks.push({
    label: "final acceptance evidence covers production work, persistence, authorization, backend controls, recovery, operations, KPI, backlog, and sign-off terms",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? `${requiredTerms.length} term(s) covered` : `missing ${missingTerms.join(", ")}`,
  });

  const unresolved = unresolvedLines(source);
  checks.push({
    label: "final acceptance evidence unresolved placeholder audit",
    ok: !strict || unresolved.length === 0,
    detail: strict
      ? unresolved.length === 0
        ? "no unresolved placeholders"
        : unresolved.slice(0, 12).map((item) => `${item.lineNumber}: ${item.line.trim()}`).join(" | ")
      : `${unresolved.length} unresolved placeholder line(s) allowed in audit mode`,
  });

  checks.push(...validateStructuredFinalAcceptanceFields(source, strict));

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    strict,
    evidencePath,
    unresolvedCount: unresolved.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runFinalAcceptanceEvidenceChecks();
    console.log(`[final-acceptance-evidence] mode=${result.strict ? "strict" : "audit"} path=${result.evidencePath}`);
    for (const check of result.checks) {
      console.log(`[final-acceptance-evidence] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[final-acceptance-evidence] FAIL ${result.failures.length} final acceptance evidence check(s) failed.`);
      process.exit(1);
    }
    console.log(`[final-acceptance-evidence] PASS ${result.checks.length} final acceptance evidence check(s) passed.`);
  } catch (error) {
    console.error(`[final-acceptance-evidence] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
