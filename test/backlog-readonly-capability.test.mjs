import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";

import { createBacklogCapability, registerBacklogCommands } from "../extensions/pi-sandcastle/backlog.mjs";

function makeDirent(name, kind) {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
  };
}

function createFakeFs(files) {
  const writes = [];
  return {
    writes,
    existsSync(path) {
      return files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`));
    },
    readFileSync(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing file: ${path}`);
      return value;
    },
    readdirSync(path, options = {}) {
      const names = new Map();
      for (const key of files.keys()) {
        if (!key.startsWith(`${path}/`)) continue;
        const remainder = key.slice(path.length + 1);
        const [first] = remainder.split("/");
        if (!first) continue;
        const isLeaf = !remainder.includes("/");
        if (!names.has(first)) names.set(first, isLeaf ? "file" : "dir");
      }
      const entries = [...names.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, kind]) => makeDirent(name, kind));
      return options.withFileTypes ? entries : entries.map((entry) => entry.name);
    },
    statSync(path) {
      if (files.has(path)) {
        return { isFile: () => true, isDirectory: () => false };
      }
      if ([...files.keys()].some((key) => key.startsWith(`${path}/`))) {
        return { isFile: () => false, isDirectory: () => true };
      }
      throw new Error(`missing path: ${path}`);
    },
    writeFileSync(path, value) {
      writes.push({ path, value });
      throw new Error(`write attempted: ${path}`);
    },
  };
}

function createTrackedPath() {
  const calls = { join: 0, resolve: 0 };
  return {
    calls,
    basename: path.basename,
    isAbsolute: path.isAbsolute,
    join(...args) {
      calls.join++;
      return path.join(...args);
    },
    relative: path.relative,
    resolve(...args) {
      calls.resolve++;
      return path.resolve(...args);
    },
  };
}

function makeItemMarkdown({ id, title, summary, priority = "medium", estimated = 1, dependsOn = [] }) {
  return `---
id: ${id}
title: ${title}
summary: ${summary}
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: ${priority}
estimated: ${estimated}
links:
  depends_on:
${dependsOn.map((entry) => `    - '${entry}'`).join("\n") || "    - '[[00002-sandcastle-config-scaffolding-and-validation]]'"}
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - backlog
  - readonly
  - inspect
---

## Goal

${summary}
`;
}

test("backlog commands register on the extension API", async () => {
  const registered = [];
  const fakePi = {
    registerCommand(name, config) {
      registered.push({ name, config });
    },
  };

  registerBacklogCommands(fakePi, {
    capabilityFactory: () => ({
      async list() {
        return { text: "list output" };
      },
      async inspect() {
        return { text: "inspect output" };
      },
    }),
  });

  assert.deepEqual(
    registered.map(({ name }) => name),
    ["backlog:list", "backlog:inspect"],
  );
});

test("backlog list and inspect use a fake filesystem without writes", async () => {
  const files = new Map([
    [
      "/repo/backlog/00002-sandcastle-config-scaffolding-and-validation.md",
      makeItemMarkdown({
        id: "wi-00002",
        title: "Sandcastle Config Scaffolding and Validation",
        summary: "Implement /sc:config subcommands for setup, show, get, set, reset, and validate.",
        priority: "high",
        estimated: 5,
      }),
    ],
    [
      "/repo/backlog/00006-readonly-backlog-list-and-inspect.md",
      makeItemMarkdown({
        id: "wi-00006",
        title: "Read-only Backlog List and Inspect",
        summary: "Implement ephemeral /backlog:list and /backlog:inspect commands.",
        priority: "medium",
        estimated: 4,
        dependsOn: ["[[00002-sandcastle-config-scaffolding-and-validation]]"],
      }),
    ],
    [
      "/repo/backlog/00007-backlog-plan-and-next-alias.md",
      makeItemMarkdown({
        id: "wi-00007",
        title: "Backlog Plan and Next Alias",
        summary: "Implement /backlog:plan and /backlog:next as ephemeral planning commands.",
        priority: "medium",
        estimated: 4,
        dependsOn: ["[[00006-readonly-backlog-list-and-inspect]]"],
      }),
    ],
  ]);
  const fakeFs = createFakeFs(files);
  const capability = createBacklogCapability({
    cwd: "/repo",
    fs: fakeFs,
    path,
    sources: ["backlog"],
  });

  const listResult = await capability.list("backlog");
  assert.equal(listResult.items.length, 3);
  assert.equal(listResult.items[0].id, "wi-00002");
  assert.match(listResult.text, /Matching backlog items:/);
  assert.equal(fakeFs.writes.length, 0);

  const inspectResult = await capability.inspect("00006");
  assert.equal(inspectResult.item.id, "wi-00006");
  assert.match(inspectResult.text, /recommended pipeline: research-review/);
  assert.equal(inspectResult.dependencyState.status, "has-dependencies");
  assert.equal(fakeFs.writes.length, 0);
  assert.deepEqual(inspectResult.relevantFiles, [
    "backlog/00006-readonly-backlog-list-and-inspect.md",
    "backlog/00002-sandcastle-config-scaffolding-and-validation.md",
    "docs/prd/sandcastle-backlog-processing.md",
    "backlog/00001-sandcastle-backlog-processing-command-surface-prd.md",
  ]);
});

test("backlog capability consistently uses injected path helpers", async () => {
  const files = new Map([
    [
      "/repo/backlog/00006-readonly-backlog-list-and-inspect.md",
      makeItemMarkdown({
        id: "wi-00006",
        title: "Read-only Backlog List and Inspect",
        summary: "Implement ephemeral /backlog:list and /backlog:inspect commands.",
        priority: "medium",
        estimated: 4,
        dependsOn: ["[[00002-sandcastle-config-scaffolding-and-validation]]"],
      }),
    ],
  ]);
  const trackedPath = createTrackedPath();
  const capability = createBacklogCapability({
    cwd: "/repo",
    fs: createFakeFs(files),
    path: trackedPath,
    sources: ["backlog"],
  });

  await capability.list("backlog");
  await assert.rejects(() => capability.inspect("missing"), /No backlog item matched/);

  assert.ok(trackedPath.calls.resolve > 0);
  assert.ok(trackedPath.calls.join > 0);
});

test("backlog list and inspect report clear missing-source and missing-item errors", async () => {
  const missingSourceCapability = createBacklogCapability({
    cwd: "/repo",
    fs: {
      existsSync: () => false,
      readFileSync() {
        throw new Error("unexpected read");
      },
      readdirSync() {
        throw new Error("unexpected readdir");
      },
      statSync() {
        throw new Error("unexpected stat");
      },
    },
    path,
    sources: [],
  });

  await assert.rejects(
    () => missingSourceCapability.list("anything"),
    /No backlog source configured/,
  );

  const files = new Map([
    [
      "/repo/backlog/00006-readonly-backlog-list-and-inspect.md",
      makeItemMarkdown({
        id: "wi-00006",
        title: "Read-only Backlog List and Inspect",
        summary: "Implement ephemeral /backlog:list and /backlog:inspect commands.",
        priority: "medium",
        estimated: 4,
        dependsOn: ["[[00002-sandcastle-config-scaffolding-and-validation]]"],
      }),
    ],
  ]);
  const fakeFs = createFakeFs(files);
  const capability = createBacklogCapability({
    cwd: "/repo",
    fs: fakeFs,
    path,
    sources: ["backlog"],
  });

  await assert.rejects(() => capability.inspect("missing"), /No backlog item matched/);
});
