export type PerformanceMetricsSnapshot = {
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  latencySampleSize: number;
};

type ReportJobPolicySnapshot = {
  timeoutMs: number;
  batchSize: number;
  maxAttempts: number;
};

function positiveInteger(value: string | undefined, fallback: number, max = 10_000_000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function performanceCapacityPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    responseLatency: {
      p95TargetMs: positiveInteger(env.PERFORMANCE_P95_TARGET_MS, 800, 60_000),
      p99TargetMs: positiveInteger(env.PERFORMANCE_P99_TARGET_MS, 1_500, 120_000),
      source: "PERFORMANCE_P95_TARGET_MS/PERFORMANCE_P99_TARGET_MS",
    },
    reportJob: {
      maxProcessingMs: positiveInteger(env.REPORT_JOB_MAX_PROCESSING_MS, 120_000, 3_600_000),
      source: "REPORT_JOB_MAX_PROCESSING_MS",
    },
    largeDownload: {
      maxReportRows: positiveInteger(env.REPORT_DOWNLOAD_MAX_ROWS, 5_000, 1_000_000),
      maxReportBytes: positiveInteger(env.REPORT_DOWNLOAD_MAX_BYTES, 3 * 1024 * 1024, 100 * 1024 * 1024),
      source: "REPORT_DOWNLOAD_MAX_ROWS/REPORT_DOWNLOAD_MAX_BYTES",
    },
  };
}

export function evaluateLatencyTargets(metrics: PerformanceMetricsSnapshot, env: NodeJS.ProcessEnv = process.env) {
  const policy = performanceCapacityPolicy(env);
  const p95Value = metrics.p95LatencyMs;
  const p99Value = metrics.p99LatencyMs;
  return {
    p95TargetMs: policy.responseLatency.p95TargetMs,
    p99TargetMs: policy.responseLatency.p99TargetMs,
    currentP95Ms: p95Value,
    currentP99Ms: p99Value,
    p95Ok: p95Value === null || p95Value <= policy.responseLatency.p95TargetMs,
    p99Ok: p99Value === null || p99Value <= policy.responseLatency.p99TargetMs,
    sampleSize: metrics.latencySampleSize,
    source: policy.responseLatency.source,
  };
}

export function reportDownloadLimitIssue(
  input: { rowCount: number; contentBytes?: number },
  env: NodeJS.ProcessEnv = process.env,
) {
  const policy = performanceCapacityPolicy(env).largeDownload;
  if (input.rowCount > policy.maxReportRows) {
    return {
      code: "REPORT_DOWNLOAD_ROW_LIMIT_EXCEEDED",
      message: `보고서 행 수가 ${policy.maxReportRows.toLocaleString("ko-KR")}건을 초과해 직접 다운로드할 수 없습니다. 필터를 줄이거나 배치 export로 처리하세요.`,
      rowCount: input.rowCount,
      maxReportRows: policy.maxReportRows,
      contentBytes: input.contentBytes ?? null,
      maxReportBytes: policy.maxReportBytes,
    };
  }
  if (input.contentBytes !== undefined && input.contentBytes > policy.maxReportBytes) {
    return {
      code: "REPORT_DOWNLOAD_SIZE_LIMIT_EXCEEDED",
      message: `보고서 파일이 ${policy.maxReportBytes.toLocaleString("ko-KR")} bytes를 초과해 직접 다운로드할 수 없습니다. 필터를 줄이거나 배치 export로 처리하세요.`,
      rowCount: input.rowCount,
      maxReportRows: policy.maxReportRows,
      contentBytes: input.contentBytes,
      maxReportBytes: policy.maxReportBytes,
    };
  }
  return null;
}

export function getPerformancePolicyStatus(
  metrics: PerformanceMetricsSnapshot,
  jobPolicy: ReportJobPolicySnapshot,
  env: NodeJS.ProcessEnv = process.env,
) {
  const policy = performanceCapacityPolicy(env);
  const latency = evaluateLatencyTargets(metrics, env);
  return {
    ok: latency.p95Ok && latency.p99Ok,
    generatedAt: new Date().toISOString(),
    latency,
    reportJob: {
      maxProcessingMs: policy.reportJob.maxProcessingMs,
      workerTimeoutMs: jobPolicy.timeoutMs,
      batchSize: jobPolicy.batchSize,
      maxAttempts: jobPolicy.maxAttempts,
      source: policy.reportJob.source,
    },
    largeDownload: policy.largeDownload,
  };
}
