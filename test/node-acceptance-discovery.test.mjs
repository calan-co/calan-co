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

test("discovers a nested workspace declared by packages/** for a changed path", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/**"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/tools/formatter/package.json": { name: "@fixture/formatter", scripts: { test: "test-formatter" } },
  }, async (repositoryRoot) => {
    const plan = await adapter().plan({
      repositoryRoot,
      candidate: "implementation",
      changedPaths: ["packages/tools/formatter/src/index.js"],
    });
    assert.deepEqual(plan, {
      scope: "affected-workspaces",
      workspaces: ["@fixture/formatter"],
      commands: [{ workspace: "@fixture/formatter", script: "test" }],
    });
  });
});

test("fails closed when nested declared workspaces both own a changed path", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/**"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/tools/package.json": { name: "@fixture/tools" },
    "packages/tools/formatter/package.json": { name: "@fixture/formatter" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({
        repositoryRoot,
        candidate: "implementation",
        changedPaths: ["packages/tools/formatter/src/index.js"],
      }),
      /ambiguous workspace ownership/i,
    );
  });
});

test("plans root scripts for a changed root file in a single-package repository", async () => {
  await withFixture({
    "package.json": rootPackage,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/index.js": "export {};\n",
  }, async (repositoryRoot) => {
    const plan = await adapter().plan({
      repositoryRoot,
      candidate: "implementation",
      changedPaths: ["src/index.js"],
    });
    assert.deepEqual(plan, {
      scope: "affected-workspaces",
      workspaces: ["fixture-root"],
      commands: [
        { workspace: "fixture-root", script: "check" },
        { workspace: "fixture-root", script: "build" },
        { workspace: "fixture-root", script: "test" },
        { workspace: "fixture-root", script: "lint" },
      ],
    });
  });
});

test("fails closed for an ambiguous lockfile configuration", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "package-lock.json": "{}",
    "packages/a/package.json": { name: "a" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/a/index.js"] }),
      /ambiguous/i,
    );
  });
});

test("fails closed when pnpm and npm shrinkwrap lockfiles coexist", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "npm-shrinkwrap.json": "{}",
    "packages/a/package.json": { name: "a" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/a/index.js"] }),
      /ambiguous/i,
    );
  });
});

test("fails closed for a changed path outside declared workspaces", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/a/package.json": { name: "a" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["README.md"] }),
      /outside declared workspaces/i,
    );
  });
});

test("fails closed for negated and malformed workspace declarations", async () => {
  for (const workspaces of [["packages/*", "!packages/ignored"], { packages: "packages/*" }]) {
    await withFixture({
      "package.json": { ...rootPackage, workspaces },
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/a/package.json": { name: "a" },
    }, async (repositoryRoot) => {
      await assert.rejects(
        adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/a/index.js"] }),
        /unparseable declared workspaces/i,
      );
    });
  }
});

test("fails closed for malformed dependency data in an unselected workspace", async () => {
  await withFixture({
    "package.json": { ...rootPackage, workspaces: ["packages/*"] },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/selected/package.json": { name: "@fixture/selected" },
    "packages/unselected/package.json": { name: "@fixture/unselected", dependencies: "invalid" },
  }, async (repositoryRoot) => {
    await assert.rejects(
      adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/selected/index.js"] }),
      /unparseable workspace graph/i,
    );
  });
});

test("fails closed for non-string workspace dependency entries", async () => {
  for (const [section, value] of [
    ["dependencies", { "@fixture/core": 1 }],
    ["devDependencies", { "@fixture/core": null }],
    ["optionalDependencies", { "@fixture/core": {} }],
    ["peerDependencies", { "@fixture/core": ["workspace:*"] }],
  ]) {
    await withFixture({
      "package.json": { ...rootPackage, workspaces: ["packages/*"] },
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/core/package.json": { name: "@fixture/core" },
      "packages/app/package.json": { name: "@fixture/app", [section]: value },
    }, async (repositoryRoot) => {
      await assert.rejects(
        adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/core/index.js"] }),
        /unparseable workspace graph/i,
      );
    });
  }
});

test("fails closed for non-object workspace dependency sections", async () => {
  for (const [section, value] of [
    ["dependencies", "@fixture/core"],
    ["devDependencies", ["@fixture/core"]],
    ["optionalDependencies", null],
    ["peerDependencies", 1],
  ]) {
    await withFixture({
      "package.json": { ...rootPackage, workspaces: ["packages/*"] },
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/core/package.json": { name: "@fixture/core" },
      "packages/app/package.json": { name: "@fixture/app", [section]: value },
    }, async (repositoryRoot) => {
      await assert.rejects(
        adapter().plan({ repositoryRoot, candidate: "implementation", changedPaths: ["packages/core/index.js"] }),
        /unparseable workspace graph/i,
      );
    });
  }
});

test("returns a structured command plan and execution-result artifact", async () => {
  await withFixture({
    "package.json": rootPackage,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  }, async (repositoryRoot) => {
    const plan = await adapter().plan({ repositoryRoot, candidate: "integration", changedPaths: [] });
    const artifact = await adapter().execute(plan, async ({ workspace, script }) => ({ workspace, script, exitCode: 0 }));
    assert.deepEqual(artifact, {
      plan,
      results: [
        { workspace: "root", script: "check", exitCode: 0 },
        { workspace: "root", script: "build", exitCode: 0 },
        { workspace: "root", script: "test", exitCode: 0 },
        { workspace: "root", script: "lint", exitCode: 0 },
      ],
    });
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
