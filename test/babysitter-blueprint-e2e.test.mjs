import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const loadBlueprint = () => import("../src/afk-delivery-blueprint.js");
const loadEvidence = () => import("../src/evidence-manifest.js");
const loadOverride = () => import("../src/repository-override-loader.js");

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const categories = ["input", "command", "dv", "review", "diff", "commit", "integration", "hash"];

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "babysitter-blueprint-"));
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

async function validEvidenceFiles(directory = "evidence") {
  const files = {};
  const artifacts = [];
  for (const category of categories) {
    const relative = `${category}.json`;
    const contents = `${category} evidence\n`;
    files[`${directory}/${relative}`] = contents;
    artifacts.push({ path: relative, category, sha256: sha256(contents), transition: "delivery" });
  }
  files[`${directory}/manifest.json`] = { schemaVersion: "babysitter-evidence/v1", artifacts };
  return files;
}

function createHarness({ outcome = { status: "delivered" } } = {}) {
  const prepareCalls = [];
  const transitionCalls = [];
  const deliveryCalls = [];
  return {
    prepareCalls, transitionCalls, deliveryCalls,
    blueprintOptions: {
      worktreeTransaction: {
        prepareItem: async (input) => {
          prepareCalls.push(input);
          return { itemId: input.itemId, worktree: "/items/wi-005" };
        },
      },
      delivery: {
        review: async (input) => { deliveryCalls.push(input); return outcome; },
      },
      state: { transition: async (input) => transitionCalls.push(input) },
    },
  };
}

test("Babysitter blueprint fails closed before worktree preparation or state transition for invalid override and evidence", async (t) => {
  await t.test("an incompatible or malformed repository override cannot prepare an item worktree", async () => {
    const { createAfkDeliveryBlueprint } = await loadBlueprint();
    for (const [name, override] of [
      ["incompatible", { schemaVersion: "doc-vader-override/v1", compatibleWith: ["doc-vader-contract/v999"], commands: { ready: ["dv", "work", "ready", "--json"] } }],
      ["malformed", { schemaVersion: "doc-vader-override/v1", compatibleWith: "doc-vader-contract/v1" }],
    ]) {
      await withFixture({ ".babysitter/repository-override.json": override }, async (repositoryRoot) => {
        const harness = createHarness();
        const result = await createAfkDeliveryBlueprint(harness.blueprintOptions).run({
          itemId: "wi-005", cwd: repositoryRoot, runDirectory: path.join(repositoryRoot, ".babysitter", "runs", name),
          repositoryOverridePath: path.join(repositoryRoot, ".babysitter", "repository-override.json"),
        });
        assert.equal(result.status, "paused", name);
        assert.match(result.reason, /override|compatible|schema|malformed/i, name);
        assert.deepEqual(harness.prepareCalls, [], name);
        assert.deepEqual(harness.transitionCalls, [], name);
      });
    }
  });

  await t.test("a manifest whose artifact hash is wrong cannot transition the run", async () => {
    const { createAfkDeliveryBlueprint } = await loadBlueprint();
    const input = "canonical input evidence\n";
    await withFixture({
      "evidence/input.json": input,
      "evidence/manifest.json": { schemaVersion: "babysitter-evidence/v1", artifacts: [{ path: "input.json", category: "input", transition: "delivery", sha256: sha256("different contents\n") }] },
    }, async (repositoryRoot) => {
      const harness = createHarness();
      const result = await createAfkDeliveryBlueprint(harness.blueprintOptions).run({
        itemId: "wi-005", cwd: repositoryRoot, runDirectory: path.join(repositoryRoot, "evidence"),
        evidenceManifestPath: path.join(repositoryRoot, "evidence", "manifest.json"),
      });
      assert.equal(result.status, "paused");
      assert.match(result.reason, /evidence|manifest|hash/i);
      assert.deepEqual(harness.transitionCalls, []);
      assert.deepEqual(harness.prepareCalls, []);
    });
  });
});

test("evidence manifest is strict and hash verified", async (t) => {
  const { verifyEvidenceManifest } = await loadEvidence();
  await t.test("accepts an exactly complete manifest", async () => {
    await withFixture(await validEvidenceFiles(), async (root) => {
      const manifest = await verifyEvidenceManifest({ runDirectory: path.join(root, "evidence") });
      assert.equal(manifest.artifacts.length, categories.length);
    });
  });
  for (const [name, mutate] of [
    ["missing category", (m) => { m.artifacts.pop(); }],
    ["unsafe path", (m) => { m.artifacts[0].path = "../input.json"; }],
    ["duplicate path", (m) => { m.artifacts[1].path = m.artifacts[0].path; }],
    ["bad hash", (m) => { m.artifacts[0].sha256 = "nope"; }],
    ["unknown transition", (m) => { m.artifacts[0].transition = "invented"; }],
  ]) {
    await t.test(`rejects ${name}`, async () => {
      const files = await validEvidenceFiles();
      mutate(files["evidence/manifest.json"]);
      await withFixture(files, async (root) => {
        await assert.rejects(verifyEvidenceManifest({ runDirectory: path.join(root, "evidence") }), /manifest|evidence|artifact|path|hash|transition/i);
      });
    });
  }
});

test("optional override loader uses the Doc-Vader parser and built-ins by default", async () => {
  const { loadRepositoryOverride } = await loadOverride();
  await withFixture({}, async (root) => {
    const loaded = await loadRepositoryOverride({ repositoryRoot: root });
    assert.equal(loaded.source, "built-in");
    assert.deepEqual(loaded.commands.ready(), ["dv", "work", "ready", "--json"]);
  });
  await withFixture({ ".babysitter/repository-override.json": "not json" }, async (root) => {
    await assert.rejects(loadRepositoryOverride({ repositoryRoot: root }), /override/i);
  });
});

test("fixture-driven blueprint outcomes preserve delivery policy seams", async (t) => {
  const { createAfkDeliveryBlueprint } = await loadBlueprint();
  for (const [name, outcome, expected] of [
    ["success", { status: "delivered" }, "delivered"],
    ["remediation", { status: "delivered", remediationCycles: 1 }, "delivered"],
    ["close failure", { status: "paused", reason: "close failed" }, "paused"],
    ["root failure", { status: "failed", reason: "root acceptance failed" }, "failed"],
    ["stale CAS", { status: "stale", recovery: { action: "refreshStale" } }, "stale"],
    ["merge conflict", { status: "conflict", itemWorktree: "/items/wi-005" }, "conflict"],
  ]) {
    await t.test(name, async () => {
      await withFixture(await validEvidenceFiles(), async (root) => {
        const harness = createHarness({ outcome });
        const result = await createAfkDeliveryBlueprint(harness.blueprintOptions).run({ itemId: "wi-005", cwd: root, runDirectory: path.join(root, "evidence") });
        assert.equal(result.status, expected);
        assert.equal(harness.prepareCalls.length, 1);
        assert.equal(harness.deliveryCalls.length, 1);
        assert.equal(typeof harness.deliveryCalls[0].verifyEvidence, "function");
        assert.ok(harness.transitionCalls.length >= 2);
      });
    });
  }
});

test("v6 package and operator documentation expose portable process contracts", async () => {
  const process = await import("../blueprints/babysitter-afk-v6/process.mjs");
  const packageMetadata = JSON.parse(await readFile(new URL("../blueprints/babysitter-afk-v6/package.json", import.meta.url), "utf8"));
  const docs = await readFile(new URL("../blueprints/babysitter-afk-v6/README.md", import.meta.url), "utf8");
  assert.equal(packageMetadata.version, "6.0.0");
  assert.equal(typeof process.process, "function");
  for (const phrase of ["blueprints:", "repository override", "run directory", "adapter", "Node-first", "lockfile"]) assert.match(docs, new RegExp(phrase, "i"));
});
