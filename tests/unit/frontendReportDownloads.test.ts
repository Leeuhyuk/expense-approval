import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend report downloads", () => {
  const mainSource = () => readFileSync(resolve("src/main.tsx"), "utf8");
  const serviceSource = () => readFileSync(resolve("src/api/service.ts"), "utf8");
  const mockServiceSource = () => readFileSync(resolve("src/api/mockService.ts"), "utf8");
  const reportRoutesSource = () => readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");

  it("routes report generation and download buttons through erpApi", () => {
    const source = mainSource();
    assert.match(source, /erpApi\.listPageRows\("reports"/, "reports page must load saved ReportRun rows from the API");
    assert.match(source, /erpApi\.createPageRow\("reports"/, "report generation must create a backend ReportRun");
    assert.match(source, /erpApi\.downloadReport\(selectedReport\.보고서명, format\)/, "report download must call the backend download API");
    assert.match(source, /triggerBase64Download\(response\.data\.fileName/, "report download must save the server-generated file payload");
    assert.doesNotMatch(source, /downloadReportCsv|downloadReportPdf/, "report buttons must not use browser-only export helpers");
  });

  it("keeps remote and mock services on the same report download contract", () => {
    assert.match(serviceSource(), /downloadReport\(reportName: string, format: ReportDownloadFormat\)/, "ErpApiService must expose report download");
    assert.match(serviceSource(), /\/reports\/\$\{encodeURIComponent\(reportName\)\}\/download\?\$\{params\.toString\(\)\}/, "remote service must call the report download route");
    assert.match(mockServiceSource(), /buildMockReportDownload\(report, format\)/, "mock service must return the same base64 file payload shape");
  });

  it("keeps report download implemented and audited on the backend", () => {
    const source = reportRoutesSource();
    assert.match(source, /app\.get\("\/reports\/:reportName\/download"/, "backend must expose a report download route");
    assert.match(source, /buildReportDownload\(item, format\)/, "backend route must create the server-side file payload");
    assert.match(source, /action: `download_\$\{format\}`/, "backend route must audit the download format");
    assert.match(source, /auditRequestContext\(request\)/, "backend report download audit must include request context");
  });
});
