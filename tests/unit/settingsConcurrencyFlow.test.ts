import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const schemaSource = read("prisma/schema.prisma");
const migrationSource = read("prisma/migrations/20260705060000_settings_row_versions/migration.sql");
const routeSource = read("backend/src/routes/pageResources.ts");
const serviceSource = read("src/api/service.ts");
const mainSource = read("src/main.tsx");

describe("settings permission concurrency flow", () => {
  it("keeps user and role rows versioned in schema and migration", () => {
    assert.match(schemaSource, /model User \{[\s\S]*rowVersion\s+Int\s+@default\(1\)[\s\S]*@@map\("users"\)/, "User rows must carry rowVersion");
    assert.match(schemaSource, /model Role \{[\s\S]*rowVersion\s+Int\s+@default\(1\)[\s\S]*@@map\("roles"\)/, "Role rows must carry rowVersion");
    assert.match(migrationSource, /ALTER TABLE "users" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;/, "migration must add User.rowVersion");
    assert.match(migrationSource, /ALTER TABLE "roles" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;/, "migration must add Role.rowVersion");
  });

  it("guards role and user permission mutations with rowVersion and idempotency keys", () => {
    assert.match(routeSource, /function toSettingRow[\s\S]*사용자RowVersion: String\(item\.rowVersion\)/, "settings rows must expose user rowVersion");
    assert.match(routeSource, /function toSettingRow[\s\S]*사용자ID: item\.id/, "settings rows must expose the stable user id");
    assert.match(routeSource, /function settingUserWhere[\s\S]*\? \{ id: identifier \}[\s\S]*: \{ name: identifier \}/, "settings mutations must resolve UUID identifiers without confusing duplicate names");
    assert.match(routeSource, /function toRoleSettingsDto[\s\S]*rowVersion: item\.rowVersion/, "role DTOs must expose role rowVersion");
    assert.match(routeSource, /app\.post\("\/settings\/roles"[\s\S]*findUnique\(\{ where: \{ idempotencyKey \} \}\)/, "role create must replay duplicate idempotency keys");
    assert.match(routeSource, /app\.patch\("\/settings\/roles\/:roleId"[\s\S]*expectedRowVersion !== before\.rowVersion/, "role update must reject stale rowVersion");
    assert.match(routeSource, /tx\.role\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "role update must use guarded updateMany");
    assert.match(routeSource, /tx\.role\.deleteMany\(\{ where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "role delete must use guarded deleteMany");
    assert.match(routeSource, /app\.patch\("\/settings\/:userName"[\s\S]*expectedRowVersion !== before\.rowVersion/, "user permission update must reject stale rowVersion");
    assert.match(routeSource, /tx\.user\.updateMany\(\{[\s\S]*where: \{ id: before\.id, rowVersion: before\.rowVersion \}/, "user permission update must use guarded updateMany");
    assert.match(routeSource, /app\.delete\("\/settings\/:userName"[\s\S]*사용자RowVersion: rowVersion/, "user deactivate route must forward rowVersion to the canonical patch route");
  });

  it("keeps frontend settings buttons wired to the backend concurrency contract", () => {
    assert.match(serviceSource, /rowVersion: number;/, "role settings DTO must expose rowVersion");
    assert.match(serviceSource, /deleteRoleSettings\(roleId: string, input\?: RoleSettingsDeleteInput\)/, "role delete API must accept mutation metadata");
    assert.match(mainSource, /erpApi\.listPageRows\("settings"[\s\S]*encodeSort\("사용자", "asc"\)/, "settings screen must load user permission rows from the API");
    assert.match(mainSource, /rowVersion: role\.rowVersion/, "role DTO mapping must preserve rowVersion");
    assert.match(mainSource, /roleMutationKey\("permission", currentGroup\)/, "permission toggle must send an idempotency key");
    assert.match(mainSource, /deleteRoleSettings\(groupId, \{ rowVersion: currentGroup\.rowVersion/, "role delete button must send rowVersion");
    assert.match(mainSource, /userPermissionMutationKey\(existingAssignment \? "update" : "create"/, "user permission save must send an idempotency key");
    assert.match(mainSource, /사용자RowVersion: existingAssignment\.rowVersion/, "user permission update must send rowVersion");
    assert.match(mainSource, /settingRowToAssignedUser\(response\.data \?\? userRow/, "user permission saves must refresh local rowVersion from the API response");
    assert.match(mainSource, /id: row\.사용자ID \|\| row\.사용자/, "settings UI must key users by the backend id when available");
    assert.match(mainSource, /updatePageRow\("settings", assignment\.id, userRow\)/, "settings UI must update the selected user by stable id");
  });
});
