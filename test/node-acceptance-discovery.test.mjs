import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The adapter is intentionally imported from production code: this test is the
// executable contract for backlog/002, not a test-local implementation.
import { createNodeAcceptanceDiscoveryAdapter } from "../src/node-acceptance-discovery.js";

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "node-acceptance-"));
  await Promise.all(Object.entries(files).map(async ([name, contents]) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof contents === "string" ? contents : JSON.stringify(contents));
  }));
  return root;
}

async function withFixture(files, run) {
  const root = await fixture(files);
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const rootPackage = {
  name: "fixture-root",
  private: true,
  packageManager: "pnpm@9.0.0",
  scripts: { check: "root-check", build: "root-build", test: "root-test", lint: "root-lint" },
};

const adapter = () => createNodeAcceptanceDiscoveryAdapter();

test("plans only a changed workspace and its reverse dependents in fixed script order", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/core/package.json": { name: "@fixture/core", scripts: { test: "test-core", check: "check-core" } },
    "packages/app/package.json": { name: "@fixture/app", dependencies: { "@fixture/core": "workspace:*" }, scripts: { lint: "lint-app", build: "build-app", check: "check-app" } },
    "packages/unrelated/package.json": { name: "@fixture/unrelated", scripts: { test: "test-unrelated" } },
  }, async (repositoryRoot) => {
    const plan = await adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/core/src/index.js"] });
    assert.deepEqual(plan, {
      scope: "affected-workspaces",
      workspaces: ["@fixture/core", "@fixture/app"],
      commands: [
        { workspace: "@fixture/core", script: "check" },
        { workspace: "@fixture/core", script: "test" },
        { workspace: "@fixture/app", script: "check" },
        { workspace: "@fixture/app", script: "build" },
        { workspace: "@fixture/app", script: "lint" },
      ],
    });
  });
});

test("fails closed for changed paths outside declared workspaces and ambiguous lockfiles", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "package-lock.json": "{}",
    "packages/a/package.json": { name: "a" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["README.md"] }),
      /outside declared workspaces|ambiguous/i,
    );
  });
});

test("plans root integration scripts in check, build, test, lint order", async () => {
  await withFixture({
    "package.json": rootPackage,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  }, async (repositoryRoot) => {
    const plan = await adapter().plan({ repositoryRoot, candidate: "integration", changedPaths: [] });
    assert.deepEqual(plan, {
      scope: "repository",
      workspaces: [],
      commands: [
        { workspace: "root", script: "check" },
        { workspace: "root", script: "build" },
        { workspace: "root", script: "test" },
        { workspace: "root", script: "lint" },
      ],
    });
  });
});
