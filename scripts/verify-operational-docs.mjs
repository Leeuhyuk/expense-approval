#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredDocs = [
  "docs/user-manual.md",
  "docs/admin-manual.md",
  "docs/incident-response.md",
  "docs/go-live-handoff-template.md",
  "docs/production-environment-inventory-template.md",
  "docs/staging-smoke-evidence-template.md",
  "docs/backup-restore-rehearsal-template.md",
  "docs/data-migration-evidence-template.md",
  "docs/release-note-template.md",
  "docs/role-uat-evidence-template.md",
  "docs/production-go-live-evidence-template.md",
  "docs/post-go-live-stabilization-evidence-template.md",
  "docs/final-acceptance-evidence-template.md",
  "docs/deployment-operations.md",
  "docs/frontend-hosting-policy.md",
  "docs/environment-separation-matrix-template.md",
  "docs/rollback-break-glass-runbook.md",
  "docs/button-action-map.md",
  "docs/core-smoke-runbook.md",
  "docs/api-spec.md",
  "docs/data-migration-readiness.md",
  "docs/release-readiness-decision.md",
  "docs/hypercare-runbook.md",
  "docs/user-training-faq.md",
  "docs/cutover-runbook.md",
  "docs/frontend-cache-revalidation-policy.md",
  "docs/capacity-planning.md",
  "docs/disaster-recovery-failover-runbook.md",
];

const docRequirements = [
  {
    file: "docs/capacity-planning.md",
    label: "capacity planning covers monthly forecasts, measured baselines, thresholds, and operator review",
    terms: [
      "월별",
      "Prisma count",
      "Attachment.byteSize",
      "CAPACITY_FORECAST_MONTHS",
      "CAPACITY_DATABASE_LIMIT_BYTES",
      "CAPACITY_OBJECT_STORAGE_LIMIT_BYTES",
      "첫 경고 월",
      "system:manage",
      "staging",
      "production",
      "15%",
    ],
  },
  {
    file: "docs/disaster-recovery-failover-runbook.md",
    label: "disaster recovery runbook covers DR failover, DNS, communication, data reconciliation, and failback",
    terms: [
      "DR 환경 인벤토리",
      "DNS Failover 절차",
      "ERP_OPERATION_MODE=read_only",
      "release:core-smoke",
      "data-quality",
      "장기 장애 커뮤니케이션 템플릿",
      "RTO 초과 공지",
      "Failback 절차",
      "release manifest",
      "RPO",
      "TTL",
      "synthetic monitor",
    ],
  },
  {
    file: "docs/environment-separation-matrix-template.md",
    label: "environment separation matrix covers dev/staging/production isolation and promotion controls",
    terms: [
      "Environment Matrix",
      "dev",
      "staging",
      "production",
      "Database",
      "Object storage",
      "Auth/session",
      "Secret scope",
      "Domain/API origin",
      "Logs/monitoring",
      "Same artifact promotion",
      "Same migration promotion",
      "RELEASE_NOTE_PATH",
    ],
  },
  {
    file: "docs/rollback-break-glass-runbook.md",
    label: "rollback and break-glass runbook covers approvals, DB access, recovery validation, and postmortems",
    terms: [
      "Rollback",
      "break-glass",
      "운영자 직접 DB 수정 금지",
      "PITR",
      "release:core-smoke",
      "사후 분석",
      "승인 매트릭스",
    ],
  },
  {
    file: "docs/cutover-runbook.md",
    label: "cutover runbook covers freeze windows, contacts, migration failure handling, and evidence",
    terms: [
      "freeze window",
      "담당자 연락망",
      "rollback/rerun",
      "quarantine",
      "AuditLog",
      "PITR",
      "requestId",
      "Go/no-go",
    ],
  },
  {
    file: "docs/user-training-faq.md",
    label: "user training FAQ covers role exercises, upload errors, requestId reporting, and training completion",
    terms: [
      "FAQ",
      "오류 신고 양식",
      "requestId",
      "권한 그룹",
      "파일 업로드",
      "새로고침",
      "재로그인",
      "교육 완료 기준",
    ],
  },
  {
    file: "docs/frontend-cache-revalidation-policy.md",
    label: "frontend cache revalidation policy covers per-screen invalidation, stale data, and localStorage boundaries",
    terms: [
      "useManagedTable",
      "erp-table-state",
      "listPageRows",
      "rowVersion",
      "stale",
      "수동 새로고침",
      "재로그인",
      "파일 업로드",
      "cross-screen invalidation",
      "requestId",
    ],
  },
  {
    file: "docs/hypercare-runbook.md",
    label: "hypercare runbook covers first-week checks, daily status, reports, and stabilization review",
    terms: [
      "daily check",
      "일일 상태 보고",
      "Hypercare 리포트",
      "2주차 안정화 회고",
      "requestId",
      "READINESS_TARGET=stable-operation",
    ],
  },
  {
    file: "docs/release-readiness-decision.md",
    label: "release decision template covers release identity, go/no-go criteria, exceptions, and ownership",
    terms: [
      "Release Identity",
      "release:go-live-readiness-report",
      "go/no-go",
      "conditional-go",
      "Owner",
      "Due date",
      "Rollback readiness confirmed",
    ],
  },
  {
    file: "docs/user-manual.md",
    label: "user manual covers operating screens and support evidence",
    terms: [
      "대시보드",
      "결제 요청",
      "승인 관리",
      "지급 관리",
      "예산 관리",
      "거래처 관리",
      "보고서",
      "시스템 설정",
      "즐겨찾기",
      "증빙 파일",
      "새로고침",
      "재로그인",
      "requestId",
    ],
  },
  {
    file: "docs/admin-manual.md",
    label: "admin manual covers permissions, settings, security, and release operations",
    terms: [
      "권한 그룹",
      "사용자 권한",
      "승인 한도",
      "결재 정책",
      "외부 연동",
      "감사 로그",
      "PRODUCTION_ACCESS_REVIEW",
      "data-quality",
      "business-failure-alerts",
      "release:operational-docs",
      "release:environment-inventory",
      "release:staging-smoke-evidence",
      "release:backup-restore-evidence",
      "release:data-migration-evidence",
      "release:role-uat-evidence",
      "release:production-go-live-evidence",
      "release:post-go-live-stabilization-evidence",
      "release:final-acceptance-evidence",
      "release:go-live-readiness",
      "release:go-live-readiness-report",
      "release:release-note",
      "docs/release-note-template.md",
      "PITR",
    ],
  },
  {
    file: "docs/incident-response.md",
    label: "incident response runbook covers triage, rollback, and communication",
    terms: [
      "P0",
      "P1",
      "requestId",
      "/api/health",
      "/api/operations/alerts",
      "/api/operations/business-failure-alerts",
      "/api/operations/data-quality",
      "Rollback",
      "읽기 전용",
      "커뮤니케이션",
      "known issue",
    ],
  },
  {
    file: "docs/deployment-operations.md",
    label: "deployment runbook references operational documentation and release gates",
    terms: [
      "release:operational-docs",
      "docs/incident-response.md",
      "release:environment-inventory",
      "release:staging-smoke-evidence",
      "release:backup-restore-evidence",
      "release:data-migration-evidence",
      "release:role-uat-evidence",
      "release:production-go-live-evidence",
      "release:post-go-live-stabilization-evidence",
      "release:final-acceptance-evidence",
      "release:go-live-readiness",
      "release:go-live-readiness-report",
      "release:release-note",
      "docs/release-note-template.md",
      "release:manifest",
      "release:core-smoke",
      "release:release-note",
      "frontend-hosting-policy",
      "rollback",
      "requestId",
    ],
  },
];

function readProjectFile(projectRoot, relativePath) {
  const path = resolve(projectRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Missing required operational document: ${relativePath}`);
  return readFileSync(path, "utf8");
}

function includesTerm(source, term) {
  return source.toLowerCase().includes(term.toLowerCase());
}

function checkTerms(projectRoot, requirement) {
  const source = readProjectFile(projectRoot, requirement.file);
  const missing = requirement.terms.filter((term) => !includesTerm(source, term));
  return {
    label: requirement.label,
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requirement.terms.length} required term(s) covered` : `missing ${missing.join(", ")}`,
  };
}

function screensFromButtonMap(source) {
  const screens = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!match) continue;
    const screen = match[1].trim();
    if (!screen || screen === "---" || screen === "화면") continue;
    screens.add(screen);
  }
  return Array.from(screens).sort((left, right) => left.localeCompare(right, "ko-KR"));
}

function checkButtonMapCoverage(projectRoot) {
  const buttonMap = readProjectFile(projectRoot, "docs/button-action-map.md");
  const manualText = [
    readProjectFile(projectRoot, "docs/user-manual.md"),
    readProjectFile(projectRoot, "docs/admin-manual.md"),
    readProjectFile(projectRoot, "docs/incident-response.md"),
  ].join("\n");
  const screens = screensFromButtonMap(buttonMap);
  const missing = screens.filter((screen) => !includesTerm(manualText, screen));
  return {
    label: "manuals cover every screen category from button-action-map",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${screens.length} screen category/categories covered` : `missing ${missing.join(", ")}`,
  };
}

function checkCrossReferences(projectRoot) {
  const deployment = readProjectFile(projectRoot, "docs/deployment-operations.md");
  const admin = readProjectFile(projectRoot, "docs/admin-manual.md");
  const incident = readProjectFile(projectRoot, "docs/incident-response.md");
  const disasterRecovery = readProjectFile(projectRoot, "docs/disaster-recovery-failover-runbook.md");
  const checks = [
    {
      label: "admin manual points to incident and deployment runbooks",
      ok: includesTerm(admin, "docs/incident-response.md") && includesTerm(admin, "docs/deployment-operations.md"),
      detail: "admin handoff must link operational runbooks",
    },
    {
      label: "deployment runbook points to incident response",
      ok: includesTerm(deployment, "docs/incident-response.md"),
      detail: "deployment procedure must link incident response",
    },
    {
      label: "incident runbook keeps release evidence in post-incident records",
      ok: includesTerm(incident, "release manifest hash") && includesTerm(incident, "migration review hash"),
      detail: "incident records must retain release evidence",
    },
    {
      label: "deployment and admin runbooks point to disaster recovery failover",
      ok:
        includesTerm(deployment, "docs/disaster-recovery-failover-runbook.md") &&
        includesTerm(admin, "docs/disaster-recovery-failover-runbook.md") &&
        includesTerm(disasterRecovery, "docs/incident-response.md"),
      detail: "DR failover must be linked from operator handoff and incident response",
    },
  ];
  return checks;
}

export function runOperationalDocsChecks({ projectRoot = process.cwd() } = {}) {
  const root = resolve(projectRoot);
  const checks = [];

  for (const doc of requiredDocs) {
    checks.push({
      label: `required document exists: ${doc}`,
      ok: existsSync(resolve(root, doc)),
      detail: doc,
    });
  }

  for (const requirement of docRequirements) {
    checks.push(checkTerms(root, requirement));
  }

  checks.push(checkButtonMapCoverage(root));
  checks.push(...checkCrossReferences(root));

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runOperationalDocsChecks();
    for (const check of result.checks) {
      console.log(`[operational-docs] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[operational-docs] FAIL ${result.failures.length} operational documentation check(s) failed.`);
      process.exit(1);
    }
    console.log(`[operational-docs] PASS ${result.checks.length} operational documentation check(s) passed.`);
  } catch (error) {
    console.error(`[operational-docs] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
