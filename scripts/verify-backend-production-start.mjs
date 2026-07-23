#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const serverEntry = resolve(process.cwd(), "backend/dist/server.js");
const startupTimeoutMs = Number(process.env.BACKEND_SMOKE_TIMEOUT_MS ?? 15_000);

function print(message) {
  console.log(`[backend-smoke] ${message}`);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function findFreePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Could not allocate a TCP port.")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(2_000).then(() => {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    }),
  ]);
}

async function waitForHealth(baseUrl, child, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`Backend process exited before health check. exitCode=${child.exitCode ?? "null"} signal=${child.signalCode ?? "null"}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      const payload = await response.json();
      if (response.ok && payload?.status === "success" && payload?.data?.ok === true) {
        return payload;
      }
      logs.push(`unexpected health response: ${response.status} ${JSON.stringify(payload)}`);
    } catch (error) {
      logs.push(`health pending: ${error instanceof Error ? error.message : String(error)}`);
    }
    await delay(300);
  }
  throw new Error(`Backend did not pass /api/health within ${startupTimeoutMs}ms.`);
}

if (!existsSync(serverEntry)) {
  console.error(`[backend-smoke] Missing ${serverEntry}. Run npm --prefix backend run build first.`);
  process.exit(1);
}

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];
const child = spawn(process.execPath, [serverEntry], {
  cwd: resolve(process.cwd(), "backend"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    FRONTEND_ORIGIN: "https://erp.example.com",
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://health:health@example.com:5432/payment_approval_erp?schema=public",
    FILE_URL_SECRET: process.env.FILE_URL_SECRET || "backend-smoke-file-url-secret-0000000000",
    CSRF_SECRET: process.env.CSRF_SECRET || "backend-smoke-csrf-secret-000000000000",
    BANK_ACCOUNT_SECRET: process.env.BANK_ACCOUNT_SECRET || "backend-smoke-bank-account-secret-0000",
    RELEASE_VERSION: process.env.RELEASE_VERSION || "backend-smoke-release",
    RELEASE_SOURCE_REF: process.env.RELEASE_SOURCE_REF || "backend-smoke-ref",
    RELEASE_GIT_COMMIT: process.env.RELEASE_GIT_COMMIT || "backend-smoke-commit",
    RELEASE_MANIFEST_SHA256: process.env.RELEASE_MANIFEST_SHA256 || "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => logs.push(chunk.trim()));
child.stderr.on("data", (chunk) => logs.push(chunk.trim()));

try {
  const payload = await waitForHealth(baseUrl, child, logs);
  print(`PASS ${baseUrl}/api/health -> ${payload.data.service}`);
  const versionResponse = await fetch(`${baseUrl}/api/health/version`, { signal: AbortSignal.timeout(1_000) });
  const versionPayload = await versionResponse.json();
  if (!versionResponse.ok || versionPayload?.data?.ok !== true) {
    throw new Error(`Backend version health check failed: ${versionResponse.status} ${JSON.stringify(versionPayload)}`);
  }
  print(`PASS ${baseUrl}/api/health/version -> ${versionPayload.data.releaseVersion}`);
} catch (error) {
  console.error(`[backend-smoke] FAIL ${error instanceof Error ? error.message : String(error)}`);
  for (const line of logs.slice(-20)) {
    if (line) console.error(`[backend-smoke] ${line}`);
  }
  process.exitCode = 1;
} finally {
  await stopChild(child);
}
