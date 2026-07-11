import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildVbsLauncher } from "../../scripts/local-autostart.mjs";
import { restartDelayMs, shouldRestart } from "../../scripts/local-supervisor.mjs";

test("Windows launcher starts the supervisor hidden without waiting", () => {
  const source = buildVbsLauncher("C:\\Program Files\\nodejs\\node.exe", "C:\\ERP Workspace\\scripts\\local-supervisor.mjs");
  assert.match(source, /WScript\.Shell/);
  assert.match(source, /Chr\(34\).*node\.exe/);
  assert.match(source, /local-supervisor\.mjs/);
  assert.match(source, /, 0, False/);
});

test("supervisor restarts failures but respects an intentional stop", () => {
  assert.equal(shouldRestart(1), true);
  assert.equal(shouldRestart(0), false);
  assert.equal(shouldRestart(1, true), false);
  assert.equal(restartDelayMs(1), 2_000);
  assert.equal(restartDelayMs(5), 30_000);
  assert.equal(restartDelayMs(20), 30_000);
});

test("autostart registration is user-scoped and the local frontend remains fixed to 3000", async () => {
  const [autostartSource, startSource] = await Promise.all([
    readFile("scripts/local-autostart.mjs", "utf8"),
    readFile("scripts/start-local.mjs", "utf8"),
  ]);
  assert.match(autostartSource, /HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run/);
  assert.match(autostartSource, /ExpenseApprovalERP/);
  assert.match(startSource, /ERP_LOCAL_FRONTEND_PORT \?\? 3000/);
  assert.match(startSource, /--strictPort/);
  const supervisorSource = await readFile("scripts/local-supervisor.mjs", "utf8");
  assert.match(supervisorSource, /const supervisorPort = 4308;/);
  assert.match(supervisorSource, /EADDRINUSE/);
});
