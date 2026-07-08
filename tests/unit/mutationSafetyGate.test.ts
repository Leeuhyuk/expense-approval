import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { evaluateMutationSafety, extractMutationRoutes, mutationRouteCatalog } from "../../scripts/mutationSafetyCatalog.mjs";

describe("mutation safety release gate", () => {
  it("classifies every backend mutation route with idempotency, concurrency, audit, or approved exception evidence", () => {
    const result = evaluateMutationSafety();

    assert.equal(result.ok, true, result.issues.map((issue) => `${issue.ruleId} ${issue.route}: ${issue.message}`).join("\n"));
    assert.ok(result.discoveredRoutes.length > 40, "current backend should expose the full business mutation surface");
    assert.ok(mutationRouteCatalog.some((route) => route.method === "POST" && route.path === "/settings/integrations/:integrationId/test"), "external integration test route must stay in the guarded catalog");
  });

  it("detects uncatalogued backend mutation routes", () => {
    const routeFiles = new Map([
      [
        "backend/src/routes/unsafe.ts",
        'export async function unsafe(app) {\n  app.post("/unsafe", async (_request, reply) => reply.send({ ok: true }));\n}\n',
      ],
    ]);

    const result = evaluateMutationSafety({
      routeFiles,
      apiSpec: "# API",
      matrix: "# Matrix",
    });

    assert.equal(result.ok, false);
    assert.match(result.issues.map((issue) => `${issue.ruleId} ${issue.route}`).join("\n"), /uncatalogued-mutation-route POST \/unsafe/);
  });

  it("keeps the CLI wired into package scripts and CI", () => {
    const packageJson = readFileSync(resolve("package.json"), "utf8");
    const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

    assert.match(packageJson, /"release:mutation-safety": "node scripts\/verify-mutation-safety\.mjs"/);
    assert.match(ci, /Verify Mutation Safety[\s\S]*npm run release:mutation-safety/);
  });

  it("extracts PUT signed file content as a mutation-class route", () => {
    const fileRoute = readFileSync(resolve("backend/src/routes/files.ts"), "utf8");
    const routes = extractMutationRoutes(new Map([["backend/src/routes/files.ts", fileRoute]]));

    assert.ok(routes.some((route) => route.method === "PUT" && route.path === "/files/:id/content"), "signed file content upload must remain visible to mutation safety checks");
  });
});
