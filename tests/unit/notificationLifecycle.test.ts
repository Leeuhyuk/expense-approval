import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("notification lifecycle", () => {
  const source = (path: string) => readFileSync(resolve(path), "utf8");

  it("keeps backend read state, links, and expiry on DB-backed notifications", () => {
    const routeSource = source("backend/src/routes/notifications.ts");
    const retentionSource = source("backend/src/domain/notificationRetention.ts");
    const approvalSource = source("backend/src/routes/approvals.ts");
    const paymentSource = source("backend/src/routes/paymentRequests.ts");
    const disbursementSource = source("backend/src/routes/disbursements.ts");
    const pageResourceSource = source("backend/src/routes/pageResources.ts");

    assert.match(routeSource, /expiresAt: item\.expiresAt\?\.toISOString\(\)/, "notification DTO must expose DB expiry");
    assert.match(routeSource, /function activeNotificationWhere/, "notification routes must share the active notification scope");
    assert.match(routeSource, /\.\.\.activeNotificationWhere\(user\.id\)[\s\S]*id: params\.id/, "single read must reject expired or foreign notifications");
    assert.match(routeSource, /readAt: item\.readAt \?\? new Date\(\)/, "single read must preserve existing read timestamps");
    assert.match(retentionSource, /notificationRetentionDays = 90/, "new notifications must use the 90-day retention policy");
    for (const route of [approvalSource, paymentSource, disbursementSource, pageResourceSource]) {
      assert.match(route, /expiresAt: notificationExpiresAt\(\)/, "created workflow notifications must receive a default expiry");
    }
  });

  it("keeps frontend notification display and navigation aligned with active DB rows", () => {
    const mainSource = source("src/main.tsx");
    const mockServiceSource = source("src/api/mockService.ts");
    const typeSource = source("src/types.ts");

    assert.match(typeSource, /expiresAt\?: string/, "frontend notification type must carry expiry");
    assert.match(mainSource, /const activeNotifications = useMemo\(\(\) => notifications\.filter\(isNotificationActive\)/, "UI must derive unread counts from active notifications");
    assert.match(mainSource, /function notificationPageFromLink/, "notification links must be normalized before navigation");
    assert.match(mainSource, /canAccessPage\(currentUser, pageKey as PageKey\)/, "notification links must respect menu permissions");
    assert.match(mainSource, /goToPage\(route\)/, "notification clicks must navigate only to a validated route");
    assert.match(mockServiceSource, /filter\(isActiveNotification\)/, "mock notification APIs must mirror expiry filtering");
  });
});
