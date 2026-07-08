import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("frontend favorites remote persistence", () => {
  const mainSource = () => readFileSync(resolve("src/main.tsx"), "utf8");
  const routeSource = () => readFileSync(resolve("backend/src/routes/pageResources.ts"), "utf8");

  it("keeps favorites CRUD and ordering on the erpApi service", () => {
    const source = mainSource();
    assert.match(source, /erpApi\.listPageRows\("favorites"/, "favorites page must load from the backend API");
    assert.match(source, /erpApi\.createPageRow\("favorites"/, "favorites add button must create through the backend API");
    assert.match(source, /erpApi\.updatePageRow\("favorites"[\s\S]*순서/, "favorites reorder/save must persist sort order through the backend API");
    assert.match(source, /erpApi\.deletePageRow\("favorites"/, "favorites delete button must call the backend API");
    assert.doesNotMatch(source, /erp-favorites:/, "favorites must not use the old browser-only localStorage key");
  });

  it("keeps backend favorite metadata connected to FavoriteItem fields", () => {
    const source = routeSource();
    assert.match(source, /순서: String\(item\.sortOrder\)/, "favorite rows must expose sortOrder");
    assert.match(source, /필터: filterTags\.join/, "favorite rows must expose stored filter tags");
    assert.match(source, /필터JSON: Object\.keys\(filters\.filters\)\.length/, "favorite rows must expose stored structured filters");
    assert.match(source, /정렬: favoriteSortToText\(filters\.sort\)/, "favorite rows must expose stored sort state");
    assert.match(source, /공유: filters\.shared/, "favorite rows must expose stored sharing scope");
    assert.match(source, /filters: favoriteFiltersFromRow\(row\)/, "favorite create must persist filters");
    assert.match(source, /patch\.필터JSON !== undefined \|\| patch\.정렬 !== undefined/, "favorite update must preserve structured filter and sort patches");
    assert.match(source, /sortOrder: favoriteSortOrder\(row\.순서/, "favorite create must persist explicit sort order");
    assert.match(source, /sortOrder: favoriteSortOrder\(patch\.순서/, "favorite update must persist reordered sort order");
  });

  it("replays server-saved route, filters, and sort when a favorite is opened", () => {
    const source = mainSource();
    assert.match(source, /targetPage: pageKey/, "favorite rows must keep the server target page");
    assert.match(source, /favoriteRouteStateFromRow\(row, pageKey\)/, "favorite rows must parse server filter and sort metadata");
    assert.match(source, /applyFavoriteRouteState\(selectedFavorite\)/, "favorite open must apply saved state before routing");
    assert.match(source, /erp-table-state:\$\{pageKey\}/, "favorite open must seed the target table state");
    assert.match(source, /favoriteRouteStateKey\(pageKey\)/, "favorite open must seed route-specific filters for custom screens");
    assert.match(source, /readFavoriteRouteState\("budget"\)/, "budget filters must restore from favorite state");
    assert.match(source, /readFavoriteRouteState\("vendors"\)/, "vendor filters must restore from favorite state");
    assert.doesNotMatch(source, /selectedFavorite\.iconKey === "report"[\s\S]*selectedFavorite\.iconKey === "approval"/, "favorite open must not infer the route only from the icon");
  });
  it("falls back when inactive, unauthorized, or deleted favorite filters are opened", () => {
    const source = mainSource();
    assert.match(source, /favoriteFilterFieldsByPage: Record<PageKey, Set<string>>/, "favorite filters must be validated against the current target screen fields");
    assert.match(source, /isFavoriteFilterFieldSupported\(pageKey, normalizedField\)/, "deleted or unsupported filter fields must be dropped before route state is persisted");
    assert.match(source, /favoriteUnsupportedFilterFields\(selectedFavorite\)/, "favorite open must identify deleted filter references for user feedback");
    assert.match(source, /if \(!canAccessPage\(currentUser, route\)\) \{[\s\S]*goToPage\(fallbackPage\)/, "favorites must route to a safe fallback when target page permission is revoked");
    assert.match(source, /비활성 메뉴는 열기와 신규 바로가기 추가를 차단하고 조회와 삭제만 허용합니다/, "inactive favorites must block opening and creation from the selected item");
    assert.match(source, /<button disabled=\{favorite\.status === "비활성"\} onClick=\{onAddShortcut\}/, "inactive favorite detail actions must disable shortcut creation");
    assert.match(source, /삭제되었거나 현재 화면에서 지원하지 않는 필터/, "favorite open feedback must name deleted filter fallback behavior");
  });
});