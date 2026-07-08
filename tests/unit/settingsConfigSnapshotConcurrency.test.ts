import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const routeSource = read("backend/src/routes/pageResources.ts");
const serviceSource = read("src/api/service.ts");
const mockSource = read("src/api/mockService.ts");
const mainSource = read("src/main.tsx");
const matrixSource = read("docs/mutation-safety-matrix.md");

describe("settings config snapshot concurrency", () => {
  it("guards append-only setting snapshots with idempotency and expected audit ids", () => {
    const configRoute = routeSource.match(/app\.patch\("\/settings\/config\/:settingKey"[\s\S]*?app\.post\("\/settings\/integrations\/:integrationId\/test"/)?.[0] ?? "";

    assert.match(routeSource, /__meta: Object\.fromEntries\(metaEntries\)/, "settings config GET must expose latest audit ids");
    assert.match(configRoute, /readSystemSettingSaveBody\(request\.body\)/, "settings config saves must parse wrapped concurrency metadata");
    assert.match(configRoute, /findUnique\(\{ where: \{ idempotencyKey: input\.idempotencyKey \} \}\)/, "settings config saves must check idempotency keys");
    assert.match(configRoute, /existingRequest\.entityType === "system_setting"[\s\S]*idempotencyReplay: true/, "settings config saves must replay duplicate safe requests");
    assert.match(configRoute, /input\.expectedAuditLogId !== currentAuditLogId/, "settings config saves must reject stale snapshots");
    assert.match(configRoute, /idempotencyKey: input\.idempotencyKey \|\| undefined/, "settings config audit logs must persist idempotency keys");
  });

  it("keeps frontend and mock services on the same settings snapshot contract", () => {
    assert.match(serviceSource, /export type SystemSettingSaveInput = \{[\s\S]*expectedAuditLogId\?: string \| null;[\s\S]*idempotencyKey\?: string;/, "service contract must expose settings snapshot concurrency input");
    assert.match(serviceSource, /saveSystemSetting\(key: SystemSettingKey, value: unknown, input\?: SystemSettingSaveInput\)/, "service method must accept settings snapshot concurrency input");
    assert.match(serviceSource, /body: JSON\.stringify\(\{ value, \.\.\.input \}\)/, "remote service must send wrapped settings snapshot payloads");
    assert.match(mockSource, /mockSystemSettingsVersionStore/, "mock service must track settings snapshot versions");
    assert.match(mockSource, /input\.expectedAuditLogId !== currentVersion/, "mock service must reject stale settings snapshot saves");
    assert.match(mockSource, /mockSystemSettingsIdempotencyStore/, "mock service must replay duplicate settings snapshot saves");

    assert.match(mainSource, /function systemSettingMutationKey/, "settings UI must build stable snapshot idempotency keys");
    assert.match(mainSource, /const \[systemSettingVersions, setSystemSettingVersions\]/, "settings UI must keep latest settings audit ids");
    assert.match(mainSource, /expectedAuditLogId,\s*[\s\S]*idempotencyKey: systemSettingMutationKey\(key, expectedAuditLogId, value\)/, "settings UI must submit expected audit ids and stable keys");
    assert.match(mainSource, /refreshSystemSettingVersions/, "settings UI must refresh versions after integration tests create snapshots");
  });

  it("documents settings config as a guarded mutation instead of an unresolved exception", () => {
    assert.match(matrixSource, /시스템 설정 스냅샷[\s\S]*`PATCH \/settings\/config\/\{key\}`[\s\S]*`idempotencyKey`, 최신 `AuditLog\.id` 기대값/, "mutation matrix must document settings config controls");
    assert.doesNotMatch(matrixSource, /시스템 설정 스냅샷 저장에 idempotency key 또는 운영 승인된 중복 허용 기준을 확정한다/, "settings config should no longer be listed as an unresolved P0");
  });

  it("guards external integration tests against duplicate button submits", () => {
    const integrationRoute = routeSource.match(/app\.post\("\/settings\/integrations\/:integrationId\/test"[\s\S]*?app\.get\("\/settings\/roles"/)?.[0] ?? "";

    assert.match(serviceSource, /export type IntegrationTestInput = \{[\s\S]*idempotencyKey\?: string;/, "service contract must expose integration test idempotency input");
    assert.match(serviceSource, /testIntegrationSetting\(integrationId: string, input\?: IntegrationTestInput\)/, "service method must accept integration test idempotency input");
    assert.match(serviceSource, /settings\/integrations\/\$\{encodeURIComponent\(integrationId\)\}\/test[\s\S]*body: JSON\.stringify\(input\)/, "remote service must send integration test idempotency payloads");
    assert.match(mainSource, /testIntegrationSetting\(settingId, \{[\s\S]*idempotencyKey: systemSettingMutationKey\("integrations"/, "settings UI must send a stable integration test idempotency key");
    assert.match(mockSource, /mockIntegrationTestIdempotencyStore/, "mock service must replay duplicate integration tests");

    assert.match(integrationRoute, /idempotencyKey.*readStringValue/, "integration test route must read idempotency keys");
    assert.match(integrationRoute, /외부 연동 테스트에는 idempotencyKey가 필요합니다/, "integration test route must reject missing idempotency keys");
    assert.match(integrationRoute, /existingRequest\.entityType === "system_setting"[\s\S]*settings_integration_test[\s\S]*idempotencyReplay: true/, "integration test route must replay duplicate safe requests");
    assert.match(integrationRoute, /idempotencyKey,/, "integration test audit log must persist idempotency keys");
  });
});
