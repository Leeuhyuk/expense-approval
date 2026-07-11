import { spawn } from "node:child_process";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

function processEnv() {
  return { ...process.env, LANG: "C", LC_ALL: "C", LC_MESSAGES: "C" };
}

function runProcess(executable, args, { onLog, onError }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      env: processEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stdout?.on("data", (chunk) => onLog?.(chunk.toString()));
    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString();
      stderr += message;
      onLog?.(message);
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else {
        const error = new Error(`PostgreSQL command failed: code=${code ?? "none"} signal=${signal ?? "none"} ${stderr.trim()}`);
        onError?.(error);
        rejectRun(error);
      }
    });
  });
}

class WindowsLocalPostgres {
  constructor(options) {
    this.options = options;
    this.runtimeDir = resolve(options.runtimeRoot, "postgres-18.4.0-beta.17");
    this.nativeDir = resolve(this.runtimeDir, "native");
    this.binDir = resolve(this.nativeDir, "bin");
    this.postgresProcess = null;
  }

  async ensureAsciiRuntime() {
    const targetPostgres = resolve(this.binDir, "postgres.exe");
    try {
      const sourceModule = await import("@embedded-postgres/windows-x64");
      const sourceNativeDir = resolve(dirname(sourceModule.postgres), "..");
      await mkdir(this.runtimeDir, { recursive: true });
      try {
        await access(targetPostgres);
      } catch {
        await rm(this.nativeDir, { recursive: true, force: true });
        await cp(sourceNativeDir, this.nativeDir, { recursive: true, force: true });
      }
      return targetPostgres;
    } catch (error) {
      throw new Error(`Windows PostgreSQL runtime preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async initialise() {
    await this.ensureAsciiRuntime();
    await mkdir(dirname(this.options.databaseDir), { recursive: true });
    const passwordPath = resolve(tmpdir(), `erp-local-postgres-${process.pid}.password`);
    await writeFile(passwordPath, `${this.options.password}\n`, "utf8");
    try {
      await runProcess(resolve(this.binDir, "initdb.exe"), [
        `--pgdata=${this.options.databaseDir}`,
        `--username=${this.options.user}`,
        `--pwfile=${passwordPath}`,
        "--auth=password",
        "--encoding=UTF8",
        "--no-locale",
      ], this.options);
    } finally {
      await rm(passwordPath, { force: true });
    }
  }

  async start() {
    await this.ensureAsciiRuntime();
    const executable = resolve(this.binDir, "postgres.exe");
    await new Promise((resolveStart, rejectStart) => {
      let ready = false;
      let stderr = "";
      this.postgresProcess = spawn(executable, [
        "-D",
        this.options.databaseDir,
        "-p",
        String(this.options.port),
        "-c",
        "listen_addresses=127.0.0.1",
      ], {
        env: processEnv(),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      this.postgresProcess.stderr?.on("data", (chunk) => {
        const message = chunk.toString();
        stderr += message;
        this.options.onLog?.(message);
        if (!ready && message.includes("database system is ready to accept connections")) {
          ready = true;
          resolveStart();
        }
      });
      this.postgresProcess.once("error", rejectStart);
      this.postgresProcess.once("exit", (code, signal) => {
        if (!ready) rejectStart(new Error(`PostgreSQL exited before ready: code=${code ?? "none"} signal=${signal ?? "none"} ${stderr.trim()}`));
      });
    });
  }

  getPgClient(database = "postgres", host = "127.0.0.1") {
    return new Client({
      host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database,
    });
  }

  async stop() {
    if (!this.postgresProcess) return;
    const child = this.postgresProcess;
    this.postgresProcess = null;
    try {
      await runProcess(resolve(this.binDir, "pg_ctl.exe"), [
        "stop",
        "-D",
        this.options.databaseDir,
        "-m",
        "fast",
        "-w",
      ], this.options);
    } catch {
      child.kill();
    }
    await new Promise((resolveStop) => {
      if (child.exitCode !== null) resolveStop();
      else {
        child.once("exit", resolveStop);
        setTimeout(resolveStop, 5_000).unref();
      }
    });
  }
}

export async function createLocalPostgres(options) {
  if (process.platform === "win32") return new WindowsLocalPostgres(options);
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  return new EmbeddedPostgres({
    ...options,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  });
}
