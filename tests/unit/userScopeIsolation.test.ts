import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("user A/B data isolation", () => {
  it("keeps notifications scoped to the authenticated user", () => {
    const route = source("backend/src/routes/notifications.ts");

    assert.match(route, /function activeNotificationWhere\(userId: string[\s\S]*userId,/,
      "notification scope must be built around the authenticated user id");
    assert.match(route, /prisma\.notification\.findMany\(\{[\s\S]*where: activeNotificationWhere\(user\.id\)/,
      "notification list must only return the signed-in user's active notifications");
    assert.match(route, /prisma\.notification\.findFirst\(\{[\s\S]*\.\.\.activeNotificationWhere\(user\.id\),[\s\S]*id: params\.id/,
      "mark-read must not update another user's notification id");
    assert.match(route, /prisma\.notification\.updateMany\(\{[\s\S]*\.\.\.activeNotificationWhere\(user\.id, now\),[\s\S]*readAt: null/,
      "read-all must only update unread active notifications for the signed-in user");
  });

  it("keeps favorites scoped to the authenticated user for reads and mutations", () => {
    const route = source("backend/src/routes/pageResources.ts");
    const favoriteLookups = route.match(/favoriteItem\.findFirst\(\{ where: \{ userId: user\.id, label:/g) ?? [];

    assert.match(route, /prisma\.favoriteItem\.findMany\(\{ where: \{ userId: user\.id \}/,
      "favorites list must only return rows owned by the signed-in user");
    assert.ok(favoriteLookups.length >= 3, "favorite get, update, and delete paths must look up by userId plus label");
    assert.match(route, /tx\.favoriteItem\.create\(\{[\s\S]*data: \{[\s\S]*userId: user\.id,/,
      "favorite creation must assign ownership to the signed-in user");
    assert.match(route, /createAudit\(tx, request, user, "favorite_item"/,
      "favorite mutations must audit the acting user");
  });

  it("keeps system permission screens behind admin permissions", () => {
    const route = source("backend/src/routes/pageResources.ts");
    const main = source("src/main.tsx");

    assert.match(route, /app\.get\("\/settings"[\s\S]*hasPermission\(user, "system:manage"\)/,
      "settings user list must require system:manage");
    assert.match(route, /app\.get\("\/settings\/roles"[\s\S]*hasPermission\(user, "system:manage"\)/,
      "role group list must require system:manage");
    assert.match(route, /app\.patch\("\/settings\/:userName"[\s\S]*hasPermission\(user, "system:manage"\)/,
      "user permission changes must require system:manage");
    assert.match(main, /canAccessPage\(currentUser, item\.key\)/,
      "frontend navigation must be filtered from the current user's permissions");
  });

  it("keeps approval queues limited to assigned approvers unless the user can read all", () => {
    const route = source("backend/src/routes/approvals.ts");

    assert.match(route, /const canReadAll = hasPermission\(user, "payment_request:read_all"\)/,
      "approval list must distinguish global readers from assigned approvers");
    assert.match(route, /where: canReadAll \? undefined : \{ approvalSteps: \{ some: \{ approverId: user\.id \} \} \}/,
      "assigned approval list must filter by the signed-in approver id");
    assert.match(route, /hasPermission\(user, "approval:read_assigned"\) && item\.approvalSteps\.some\(\(step\) => step\.approverId === user\.id\)/,
      "approval detail must block another approver's request unless the user can read all");
    assert.match(route, /currentStep\.approverId !== user\.id && !hasPermission\(user, "system:manage"\)/,
      "approval mutation must only allow the current approver or system manager");
  });
});
