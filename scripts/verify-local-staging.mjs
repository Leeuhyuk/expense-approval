#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(process.env.ERP_LOCAL_DATA_DIR ?? resolve(projectRoot, ".local-data", "staging"));
const runtimePath = resolve(process.env.ERP_LOCAL_RUNTIME_STATE_PATH ?? resolve(dataRoot, "runtime.json"));
const manifestPath = resolve(projectRoot, "release", "release-manifest.json");
const evidencePath = resolve(dataRoot, "smoke-evidence.json");
const frontendPort = Number(process.env.ERP_LOCAL_FRONTEND_PORT ?? 3100);
const baseUrl = `http://127.0.0.1:${frontendPort}`;
const checks = [];

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`[staging-local-smoke] ${ok ? "PASS" : "FAIL"} ${id} - ${detail}`);
}

function cookiesFrom(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).join("; ");
}

async function getJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  const payload = await response.json();
  return { response, payload };
}

const [runtime, manifest] = await Promise.all([
  readFile(runtimePath, "utf8").then(JSON.parse),
  readFile(manifestPath, "utf8").then(JSON.parse),
]);

record("profile", runtime.profile === "staging-local", `profile=${runtime.profile}`);
record("artifact_mode", runtime.artifactMode === "build", `artifactMode=${runtime.artifactMode}`);
record("isolated_database", normalizedPath(runtime.databaseDir).endsWith("/expense-approval-erp-staging/postgres"), runtime.databaseDir);
record("isolated_files", normalizedPath(runtime.fileStorageDir).endsWith("/expense-approval-erp-staging/files"), runtime.fileStorageDir);
record("isolated_db_identity", runtime.databaseName === "payment_approval_erp_staging" && runtime.databaseUser === "erp_staging_local", `database=${runtime.databaseName} user=${runtime.databaseUser}`);
record("clean_release", manifest.git?.dirty === false && runtime.releaseGitCommit === manifest.git?.commit && runtime.releaseSourceRef === manifest.sourceRef, `dirty=${manifest.git?.dirty} commit=${manifest.git?.commit}`);
record("isolated_ports", runtime.frontendPort === 3100 && runtime.backendPort === 4410 && runtime.databasePort === 55442, `frontend=${runtime.frontendPort} backend=${runtime.backendPort} db=${runtime.databasePort}`);

const frontend = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
const frontendHtml = await frontend.text();
record("frontend_artifact", frontend.ok && /<div id="root"><\/div>/.test(frontendHtml), `status=${frontend.status}`);

for (const path of ["/api/health", "/api/health/db", "/api/health/storage", "/api/health/file-security"]) {
  const result = await getJson(path);
  record(path, result.response.ok && result.payload?.status === "success" && result.payload?.data?.ok !== false, `status=${result.response.status}`);
}

const version = await getJson("/api/health/version");
const versionData = version.payload?.data;
record(
  "release_identity",
  version.response.ok && versionData?.ok === true && versionData.releaseVersion === process.env.RELEASE_VERSION && versionData.gitCommit === manifest.git.commit && versionData.manifestSha256 === manifest.manifestSha256,
  `version=${versionData?.releaseVersion ?? "missing"} manifest=${versionData?.manifestSha256 ?? "missing"}`,
);

const login = await getJson("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "kim.minsu@example.local", password: "password" }),
});
const cookie = cookiesFrom(login.response.headers);
record("login", login.response.ok && login.payload?.status === "success" && cookie.includes("erp_session="), `status=${login.response.status}`);
const currentUser = await getJson("/api/auth/me", { headers: { Cookie: cookie } });
record("authenticated_read", currentUser.response.ok && currentUser.payload?.data?.email === "kim.minsu@example.local", `status=${currentUser.response.status}`);

const evidence = {
  ok: checks.every((check) => check.ok),
  profile: runtime.profile,
  baseUrl,
  generatedAt: new Date().toISOString(),
  release: {
    version: versionData?.releaseVersion ?? null,
    sourceRef: versionData?.sourceRef ?? null,
    gitCommit: versionData?.gitCommit ?? null,
    manifestSha256: versionData?.manifestSha256 ?? null,
    frontendArtifactSha256: manifest.artifacts.find((item) => item.id === "frontend")?.sha256 ?? null,
    backendArtifactSha256: manifest.artifacts.find((item) => item.id === "backend")?.sha256 ?? null,
  },
  runtime: {
    frontendPort: runtime.frontendPort,
    backendPort: runtime.backendPort,
    databasePort: runtime.databasePort,
    databaseDir: runtime.databaseDir,
    fileStorageDir: runtime.fileStorageDir,
    artifactMode: runtime.artifactMode,
  },
  checks,
};
await mkdir(dataRoot, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
if (!evidence.ok) process.exitCode = 1;
else console.log(`[staging-local-smoke] PASS evidence=${evidencePath}`);
