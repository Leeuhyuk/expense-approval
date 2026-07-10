#!/usr/bin/env node
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultExpectedRows = 20_000;
const defaultReportRows = 5_000;
const defaultMaxListMs = 3_000;
const defaultMaxReportMs = 2_000;
const defaultMaxReportBytes = 3 * 1024 * 1024;
const defaultMaxReportGenerationMs = 2_000;
const defaultUploadBytes = 10 * 1024 * 1024;
const defaultUploadChunkBytes = 1024 * 1024;
const defaultMaxUploadMs = 2_000;

function integerOption(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseWon(value) {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareValues(a, b) {
  const numericA = parseWon(a);
  const numericB = parseWon(b);
  if (numericA !== undefined && numericB !== undefined) return numericA - numericB;
  return String(a ?? "").localeCompare(String(b ?? ""), "ko-KR");
}

function filterAndSortRows(rows, query) {
  const search = normalize(query.search ?? "");
  const filters = Object.entries(query.filters ?? {}).filter(([, value]) => value);
  const filteredBySearch = search
    ? rows.filter((row) => Object.values(row).some((value) => normalize(value).includes(search)))
    : rows;
  const filtered = filters.length
    ? filteredBySearch.filter((row) => filters.every(([field, value]) => normalize(row[field] ?? "").includes(normalize(value))))
    : filteredBySearch;

  if (!query.sort) return filtered;
  const [field, direction = "asc"] = query.sort.split(":");
  if (!field) return filtered;

  return [...filtered].sort((left, right) => {
    const result = compareValues(left[field] ?? "", right[field] ?? "");
    return direction === "desc" ? -result : result;
  });
}

function paginateRows(rows, query) {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, query.pageSize);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

function generateOperationalRows(rowCount) {
  const statuses = ["승인 대기", "승인 진행 중", "승인 완료", "보류", "반려"];
  const departments = ["재무팀", "구매팀", "영업팀", "운영팀", "개발팀", "품질팀"];
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push({
      요청번호: `PR-${String(index + 1).padStart(7, "0")}`,
      거래처: `거래처 ${index % 500}`,
      상태: statuses[index % statuses.length],
      금액: `${((index % 900) + 1) * 10_000} 원`,
      부서: departments[index % departments.length],
      요청자: `사용자 ${index % 250}`,
      생성일시: `2026-07-${String((index % 28) + 1).padStart(2, "0")} ${String(index % 24).padStart(2, "0")}:00`,
      유형: index % 3 === 0 ? "정기 지급" : index % 3 === 1 ? "일반 구매" : "프로젝트",
    });
  }
  return rows;
}

export function syntheticListCapacityWorkload({ rowCount = defaultExpectedRows, maxMs = defaultMaxListMs } = {}) {
  const rows = generateOperationalRows(rowCount);
  const query = {
    page: 2,
    pageSize: 100,
    search: "거래처 12",
    sort: "금액:desc",
    filters: {
      상태: "승인",
      부서: "팀",
    },
  };

  const startedAt = performance.now();
  const page = paginateRows(filterAndSortRows(rows, query), query);
  const elapsedMs = performance.now() - startedAt;

  return {
    ok: page.rows.length === 100 && page.total >= 100 && elapsedMs <= maxMs,
    elapsedMs,
    maxMs,
    rowCount,
    total: page.total,
    returned: page.rows.length,
  };
}

export function syntheticServerPaginationWorkload({ rowCount = defaultExpectedRows, maxMs = defaultMaxListMs } = {}) {
  const rows = generateOperationalRows(rowCount);
  const query = {
    page: 50,
    pageSize: 100,
    search: "",
    sort: "요청번호:asc",
    filters: {},
  };

  const startedAt = performance.now();
  const firstPage = paginateRows(filterAndSortRows(rows, { ...query, page: 1 }), { ...query, page: 1 });
  const targetPage = paginateRows(filterAndSortRows(rows, query), query);
  const elapsedMs = performance.now() - startedAt;
  const firstIds = new Set(firstPage.rows.map((row) => row.요청번호));
  const hasOverlap = targetPage.rows.some((row) => firstIds.has(row.요청번호));

  return {
    ok: targetPage.rows.length <= query.pageSize && targetPage.total === rowCount && !hasOverlap && elapsedMs <= maxMs,
    elapsedMs,
    maxMs,
    rowCount,
    total: targetPage.total,
    page: targetPage.page,
    pageSize: targetPage.pageSize,
    returned: targetPage.rows.length,
    hasOverlap,
  };
}

export function syntheticReportGenerationWorkload({ rowCount = defaultReportRows, maxMs = defaultMaxReportGenerationMs } = {}) {
  const rows = generateOperationalRows(rowCount);
  const startedAt = performance.now();
  const byDepartment = new Map();
  const byStatus = new Map();
  const byMonth = new Map();
  let totalAmount = 0;

  for (const row of rows) {
    const amount = parseWon(row.금액) ?? 0;
    totalAmount += amount;
    byDepartment.set(row.부서, (byDepartment.get(row.부서) ?? 0) + amount);
    byStatus.set(row.상태, (byStatus.get(row.상태) ?? 0) + 1);
    byMonth.set(String(row.생성일시).slice(0, 7), (byMonth.get(String(row.생성일시).slice(0, 7)) ?? 0) + amount);
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    ok: rows.length === rowCount && totalAmount > 0 && byDepartment.size > 1 && byStatus.size > 1 && byMonth.size >= 1 && elapsedMs <= maxMs,
    elapsedMs,
    maxMs,
    rowCount,
    totalAmount,
    departmentCount: byDepartment.size,
    statusCount: byStatus.size,
    monthCount: byMonth.size,
  };
}

function escapeCsvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

export function syntheticReportDownloadWorkload({
  rowCount = defaultReportRows,
  maxMs = defaultMaxReportMs,
  maxBytes = defaultMaxReportBytes,
} = {}) {
  const rows = generateOperationalRows(rowCount);
  const columns = ["요청번호", "거래처", "상태", "금액", "부서", "요청자", "생성일시", "유형"];

  const startedAt = performance.now();
  const csv = [
    columns.map(escapeCsvCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(",")),
  ].join("\r\n");
  const contentBase64 = Buffer.from(`\uFEFF${csv}`, "utf8").toString("base64");
  const elapsedMs = performance.now() - startedAt;
  const bytes = Buffer.byteLength(contentBase64, "utf8");

  return {
    ok: elapsedMs <= maxMs && bytes <= maxBytes && rows.length === rowCount,
    elapsedMs,
    maxMs,
    bytes,
    maxBytes,
    rowCount,
  };
}

export function syntheticFileUploadWorkload({ bytes = defaultUploadBytes, chunkBytes = defaultUploadChunkBytes, maxMs = defaultMaxUploadMs } = {}) {
  const chunkSize = Math.max(1, chunkBytes);
  const chunk = Buffer.alloc(Math.min(chunkSize, Math.max(1, bytes)), 7);
  const startedAt = performance.now();
  const hash = createHash("sha256");
  let uploadedBytes = 0;
  let chunks = 0;

  while (uploadedBytes < bytes) {
    const size = Math.min(chunk.length, bytes - uploadedBytes);
    hash.update(size === chunk.length ? chunk : chunk.subarray(0, size));
    uploadedBytes += size;
    chunks += 1;
  }

  const checksum = hash.digest("hex");
  const elapsedMs = performance.now() - startedAt;
  return {
    ok: uploadedBytes === bytes && chunks === Math.ceil(bytes / chunkSize) && checksum.length === 64 && elapsedMs <= maxMs,
    elapsedMs,
    maxMs,
    bytes,
    uploadedBytes,
    chunkBytes: chunkSize,
    chunks,
    checksum,
  };
}

function readProjectFile(projectRoot, relativePath) {
  const path = resolve(projectRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Missing required file: ${relativePath}`);
  return readFileSync(path, "utf8");
}

function modelBlock(schema, modelName) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, "m"));
  if (!match) throw new Error(`Missing Prisma model: ${modelName}`);
  return match[0];
}

function checkPattern(checks, label, source, pattern, detail) {
  checks.push({
    label,
    ok: pattern.test(source),
    detail,
  });
}

export function runPerformanceCapacityChecks({
  projectRoot = process.cwd(),
  expectedRows = integerOption("PERFORMANCE_CAPACITY_ROWS", defaultExpectedRows),
  maxListMs = integerOption("PERFORMANCE_CAPACITY_MAX_LIST_MS", defaultMaxListMs),
  reportRows = integerOption("PERFORMANCE_CAPACITY_REPORT_ROWS", defaultReportRows),
  maxReportMs = integerOption("PERFORMANCE_CAPACITY_MAX_REPORT_MS", defaultMaxReportMs),
  maxReportBytes = integerOption("PERFORMANCE_CAPACITY_MAX_REPORT_BYTES", defaultMaxReportBytes),
  maxReportGenerationMs = integerOption("PERFORMANCE_CAPACITY_MAX_REPORT_GENERATION_MS", defaultMaxReportGenerationMs),
  uploadBytes = integerOption("PERFORMANCE_CAPACITY_UPLOAD_BYTES", defaultUploadBytes),
  maxUploadMs = integerOption("PERFORMANCE_CAPACITY_MAX_UPLOAD_MS", defaultMaxUploadMs),
} = {}) {
  const root = resolve(projectRoot);
  const checks = [];
  const pageResources = readProjectFile(root, "backend/src/routes/pageResources.ts");
  const approvals = readProjectFile(root, "backend/src/routes/approvals.ts");
  const disbursements = readProjectFile(root, "backend/src/routes/disbursements.ts");
  const paymentRequests = readProjectFile(root, "backend/src/routes/paymentRequests.ts");
  const rowUtils = readProjectFile(root, "backend/src/routes/rowUtils.ts");
  const performancePolicy = readProjectFile(root, "backend/src/operations/performancePolicy.ts");
  const capacityPlanning = readProjectFile(root, "backend/src/operations/capacityPlanningReport.ts");
  const operationsRoutes = readProjectFile(root, "backend/src/routes/operations.ts");
  const attachmentPolicy = readProjectFile(root, "backend/src/security/attachmentPolicy.ts");
  const rateLimit = readProjectFile(root, "backend/src/security/rateLimit.ts");
  const releaseEnv = readProjectFile(root, "scripts/verify-release-env.mjs");
  const schema = readProjectFile(root, "prisma/schema.prisma");

  const listSchemaCapPattern = /pageSize:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.max\(100\)\.default\(10\)/;
  for (const [label, source] of [
    ["page resource list pageSize cap", pageResources],
    ["approval list pageSize cap", approvals],
    ["disbursement list pageSize cap", disbursements],
    ["payment request list pageSize cap", paymentRequests],
  ]) {
    checkPattern(checks, label, source, listSchemaCapPattern, "list query pageSize must stay bounded at 100 rows");
  }

  checkPattern(checks, "shared list pagination slices bounded pages", rowUtils, /rows\.slice\(start,\s*start \+ pageSize\)/, "shared pagination must return one bounded page");
  checkPattern(checks, "shared filtering and sorting remains centralized", rowUtils, /export function filterAndSortRows[\s\S]*query\.sort/, "list filter/sort behavior must stay centralized");
  checkPattern(checks, "payment request list uses database pagination", paymentRequests, /prisma\.paymentRequest\.findMany\(\{[\s\S]*skip:\s*\(query\.page - 1\) \* query\.pageSize,[\s\S]*take:\s*query\.pageSize,[\s\S]*prisma\.paymentRequest\.count/s, "largest request list must use DB skip/take and count");
  checkPattern(checks, "report download is server-generated and audited", pageResources, /app\.get\("\/reports\/:reportName\/download"[\s\S]*ensureReportArtifact\(item\)[\s\S]*readReportArtifactDownload\(artifactItem, format\)[\s\S]*auditLog\.create/s, "report CSV/PDF downloads must be generated by the backend and audited");
  checkPattern(checks, "performance policy defines p95 and p99 targets", performancePolicy, /PERFORMANCE_P95_TARGET_MS[\s\S]*PERFORMANCE_P99_TARGET_MS/, "response latency targets must be explicit and environment configurable");
  checkPattern(checks, "performance policy defines report job processing budget", performancePolicy, /REPORT_JOB_MAX_PROCESSING_MS/, "report job max processing time must be explicit and environment configurable");
  checkPattern(checks, "performance policy defines report download row and byte limits", performancePolicy, /REPORT_DOWNLOAD_MAX_ROWS[\s\S]*REPORT_DOWNLOAD_MAX_BYTES/, "large report download limits must be explicit and environment configurable");
  checkPattern(checks, "capacity report projects current plus monthly forecast", capacityPlanning, /CAPACITY_FORECAST_MONTHS[^]*Array[.]from[(][{] length: forecastMonths [+] 1 [}]/, "capacity planning must project a bounded current-plus-monthly forecast");
  checkPattern(checks, "capacity report uses aggregate counts and attachment bytes only", capacityPlanning, /prisma[.]paymentRequest[.]count[(][)][^]*prisma[.]auditLog[.]count[(][)][^]*prisma[.]attachment[.]aggregate[(][{] _count:[^]*_sum: [{] byteSize: true [}]/, "capacity baseline must use aggregate counts and attachment bytes without raw business data");
  checkPattern(checks, "capacity report defines database and object storage limits", capacityPlanning, /CAPACITY_DATABASE_LIMIT_BYTES[^]*CAPACITY_OBJECT_STORAGE_LIMIT_BYTES[^]*CAPACITY_WARNING_PERCENT[^]*CAPACITY_CRITICAL_PERCENT/, "capacity thresholds must be environment configurable");
  checkPattern(checks, "capacity planning API requires system management", operationsRoutes, /app[.]get[(]"[/]operations[/]capacity-planning"[^]*hasPermission[(]user, "system:manage"[)][^]*getCapacityPlanningReport[(][)]/, "capacity planning report must be restricted to system managers");
  checkPattern(checks, "report download enforces policy before response", pageResources, /const rowLimitIssue = reportDownloadLimitIssue\(\{ rowCount: item\.rowCount \}\)[\s\S]*const sizeLimitIssue = reportDownloadLimitIssue\(\{ rowCount: artifactItem\.rowCount, contentBytes: download\.limits\.contentBytes \}\)/s, "report downloads must reject row or payload sizes above policy");
  checkPattern(checks, "file upload policy enforces 10MB maximum", attachmentPolicy, /maxAttachmentBytes\s*=\s*10 \* 1024 \* 1024/, "upload file size policy must remain at 10MB");
  checkPattern(checks, "API body limit is environment controlled", rateLimit, /API_BODY_LIMIT_BYTES[\s\S]*defaultBodyLimitBytes/, "Fastify body limit must remain configurable");
  checkPattern(checks, "release gate verifies API body limit and rate limit", releaseEnv, /API_BODY_LIMIT_BYTES[\s\S]*RATE_LIMIT_DISABLED[\s\S]*RATE_LIMIT_WINDOW_MS[\s\S]*RATE_LIMIT_MAX/s, "release gate must reject unsafe body or rate limit settings");

  const indexExpectations = [
    ["PaymentRequest status/requestedAt index", modelBlock(schema, "PaymentRequest"), /@@index\(\[status, requestedAt\]\)/],
    ["PaymentRequest department/requestedAt index", modelBlock(schema, "PaymentRequest"), /@@index\(\[departmentId, requestedAt\]\)/],
    ["PaymentRequest vendor index", modelBlock(schema, "PaymentRequest"), /@@index\(\[vendorId\]\)/],
    ["Disbursement status/scheduledDate index", modelBlock(schema, "Disbursement"), /@@index\(\[status, scheduledDate\]\)/],
    ["Disbursement vendor/scheduledDate index", modelBlock(schema, "Disbursement"), /@@index\(\[vendorId, scheduledDate\]\)/],
    ["Vendor verification/active index", modelBlock(schema, "Vendor"), /@@index\(\[accountVerificationStatus, isActive\]\)/],
    ["ReportRun creator/date index", modelBlock(schema, "ReportRun"), /@@index\(\[createdBy, createdAt\]\)/],
    ["ReportRun type/date index", modelBlock(schema, "ReportRun"), /@@index\(\[type, createdAt\]\)/],
    ["FavoriteItem user/kind/order index", modelBlock(schema, "FavoriteItem"), /@@index\(\[userId, kind, sortOrder\]\)/],
  ];
  for (const [label, block, pattern] of indexExpectations) {
    checkPattern(checks, label, block, pattern, "Prisma schema must retain production list/report indexes");
  }

  const listWorkload = syntheticListCapacityWorkload({ rowCount: expectedRows, maxMs: maxListMs });
  checks.push({
    label: "synthetic production-volume list filter/sort/page workload",
    ok: listWorkload.ok,
    detail: `${listWorkload.rowCount} rows -> ${listWorkload.total} matches, ${listWorkload.returned} returned in ${listWorkload.elapsedMs.toFixed(1)}ms (limit ${listWorkload.maxMs}ms)`,
  });

  const serverPaginationWorkload = syntheticServerPaginationWorkload({ rowCount: expectedRows, maxMs: maxListMs });
  checks.push({
    label: "synthetic server pagination page boundary workload",
    ok: serverPaginationWorkload.ok,
    detail: `${serverPaginationWorkload.rowCount} rows page ${serverPaginationWorkload.page}/${serverPaginationWorkload.pageSize} returned ${serverPaginationWorkload.returned} rows in ${serverPaginationWorkload.elapsedMs.toFixed(1)}ms`,
  });

  const reportGenerationWorkload = syntheticReportGenerationWorkload({ rowCount: reportRows, maxMs: maxReportGenerationMs });
  checks.push({
    label: "synthetic report generation aggregation workload",
    ok: reportGenerationWorkload.ok,
    detail: `${reportGenerationWorkload.rowCount} rows aggregated into ${reportGenerationWorkload.departmentCount} departments, ${reportGenerationWorkload.statusCount} statuses, ${reportGenerationWorkload.monthCount} month buckets in ${reportGenerationWorkload.elapsedMs.toFixed(1)}ms`,
  });

  const reportWorkload = syntheticReportDownloadWorkload({ rowCount: reportRows, maxMs: maxReportMs, maxBytes: maxReportBytes });
  checks.push({
    label: "synthetic report download payload workload",
    ok: reportWorkload.ok,
    detail: `${reportWorkload.rowCount} rows -> ${reportWorkload.bytes} base64 bytes in ${reportWorkload.elapsedMs.toFixed(1)}ms (limits ${reportWorkload.maxMs}ms, ${reportWorkload.maxBytes} bytes)`,
  });

  const uploadWorkload = syntheticFileUploadWorkload({ bytes: uploadBytes, maxMs: maxUploadMs });
  checks.push({
    label: "synthetic file upload chunk/hash workload",
    ok: uploadWorkload.ok,
    detail: `${uploadWorkload.uploadedBytes} bytes across ${uploadWorkload.chunks} chunks in ${uploadWorkload.elapsedMs.toFixed(1)}ms (limit ${uploadWorkload.maxMs}ms)`,
  });

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    metrics: {
      listWorkload,
      serverPaginationWorkload,
      reportGenerationWorkload,
      reportWorkload,
      uploadWorkload,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runPerformanceCapacityChecks();
    for (const check of result.checks) {
      console.log(`[performance-capacity] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[performance-capacity] FAIL ${result.failures.length} capacity check(s) failed.`);
      process.exit(1);
    }
    console.log(`[performance-capacity] PASS ${result.checks.length} capacity check(s) passed.`);
  } catch (error) {
    console.error(`[performance-capacity] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
