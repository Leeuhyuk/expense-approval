import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
const cssSource = readFileSync(resolve("src/styles.css"), "utf8");

describe("frontend remote authentication flow", () => {
  it("shows a real login form instead of blanking the ERP route when /auth/me fails", () => {
    assert.match(mainSource, /function LoginScreen/, "remote auth fallback must render a login screen");
    assert.match(mainSource, /aria-label="로그인 이메일"/, "login form must collect email");
    assert.match(mainSource, /aria-label="로그인 비밀번호"/, "login form must collect password");
    assert.match(mainSource, /erpApi\s*\.\s*login\(\{\s*email:\s*loginEmail\.trim\(\),\s*password:\s*loginPassword\s*\}\)/s, "login submit must call the remote API service");
    assert.match(mainSource, /setAuthState\("anonymous"\)/, "failed session lookup must enter anonymous auth state");
    assert.doesNotMatch(mainSource, /window\.location\.hash\s*=\s*""/, "failed session lookup must not navigate away to a blank landing state");
  });

  it("exposes logout and stable auth screen styling", () => {
    assert.match(mainSource, /erpApi\s*\.\s*logout\(\)\.catch/, "topbar logout must call the remote API service");
    assert.match(mainSource, /aria-label="로그아웃"/, "logout button must be accessible");
    assert.match(cssSource, /\.auth-shell/, "login screen styles must be present");
    assert.match(cssSource, /\.erp-logout-button/, "logout button styles must be present");
  });
});
