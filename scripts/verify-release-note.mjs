#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultReleaseNotePath = "docs/release-note-template.md";
const requiredSections = [
  "Release Identity",
  "기능 변경",
  "DB 변경",
  "권한 변경",
  "운영 영향",
  "Known Issue",
  "Rollback 조건",
  "승인",
];
const requiredTerms = [
  "Release manifest hash",
  "Migration review hash",
  "하위 호환성",
  "사용자 영향",
  "모니터링",
  "우회 절차",
  "직전 release manifest artifact",
  "기능 책임자",
  "보안 책임자",
  "재무 책임자",
  "운영 책임자",
];
const placeholderPattern = /\bTBD\b|\bpending\b|<[^>]+>/i;

function readReleaseNote(path) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) throw new Error(`Missing release note document: ${path}`);
  return { resolved, source: readFileSync(resolved, "utf8") };
}

function includesTerm(source, term) {
  return source.toLowerCase().includes(term.toLowerCase());
}

export function runReleaseNoteChecks({ strict = false, releaseNotePath = process.env.RELEASE_NOTE_PATH || defaultReleaseNotePath } = {}) {
  const checks = [];
  let source = "";
  try {
    source = readReleaseNote(releaseNotePath).source;
    checks.push({ label: "release note document exists", ok: true, detail: releaseNotePath });
  } catch (error) {
    checks.push({ label: "release note document exists", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  if (source) {
    for (const section of requiredSections) {
      checks.push({
        label: `release note section: ${section}`,
        ok: includesTerm(source, `## ${section}`),
        detail: section,
      });
    }

    for (const term of requiredTerms) {
      checks.push({
        label: `release note required term: ${term}`,
        ok: includesTerm(source, term),
        detail: term,
      });
    }

    checks.push({
      label: "release note unresolved placeholder audit",
      ok: !strict || !placeholderPattern.test(source),
      detail: strict ? "strict mode requires a release-specific note without TBD/pending/<...> placeholders" : "template placeholders are allowed in audit mode",
    });

    checks.push({
      label: "production release note path is explicit",
      ok: !strict || Boolean(process.env.RELEASE_NOTE_PATH),
      detail: strict ? "RELEASE_NOTE_PATH must point to the filled release note" : "audit mode uses the template by default",
    });
  }

  const failures = checks.filter((check) => !check.ok);
  return { ok: failures.length === 0, strict, releaseNotePath, checks, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const strict = process.env.RELEASE_TARGET === "production" || process.env.REQUIRE_RELEASE_NOTE === "true";
    const result = runReleaseNoteChecks({ strict });
    console.log(`[release-note] mode=${result.strict ? "strict" : "audit"} path=${result.releaseNotePath}`);
    for (const check of result.checks) {
      console.log(`[release-note] ${check.ok ? "PASS" : "FAIL"} ${check.label} - ${check.detail}`);
    }
    if (!result.ok) {
      console.error(`[release-note] FAIL ${result.failures.length} release note check(s) failed.`);
      process.exit(1);
    }
    console.log(`[release-note] PASS ${result.checks.length} release note check(s) passed.`);
  } catch (error) {
    console.error(`[release-note] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}