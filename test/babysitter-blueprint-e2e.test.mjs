import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const loadBlueprint = () => import("../src/afk-delivery-blueprint.js");

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

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
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createHarness() {
  const prepareCalls = [];
  const transitionCalls = [];
  return {
    prepareCalls,
    transitionCalls,
    blueprintOptions: {
      worktreeTransaction: {
        prepareItem: async (input) => {
          prepareCalls.push(input);
          return { itemId: input.itemId, worktree: "/items/wi-005" };
        },
      },
      state: {
        transition: async (input) => transitionCalls.push(input),
      },
    },
  };
}

test("Babysitter blueprint fails closed before worktree preparation or state transition for invalid override and evidence", async (t) => {
  await t.test("an incompatible or malformed repository override cannot prepare an item worktree", async () => {
    const { createAfkDeliveryBlueprint } = await loadBlueprint();

    for (const [name, override] of [
      ["incompatible", {
        schemaVersion: "doc-vader-override/v1",
        compatibleWith: ["doc-vader-contract/v999"],
        commands: { ready: ["dv", "work", "ready", "--json"] },
      }],
      ["malformed", { schemaVersion: "doc-vader-override/v1", compatibleWith: "doc-vader-contract/v1" }],
    ]) {
      await withFixture({
        ".babysitter/repository-override.json": override,
      }, async (repositoryRoot) => {
        const harness = createHarness();
        const blueprint = createAfkDeliveryBlueprint(harness.blueprintOptions);

        const result = await blueprint.run({
          itemId: "wi-005",
          cwd: repositoryRoot,
          runDirectory: path.join(repositoryRoot, ".babysitter", "runs", name),
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
      "evidence/manifest.json": {
        schemaVersion: "babysitter-evidence/v1",
        artifacts: [{ path: "input.json", sha256: sha256("different contents\n") }],
      },
    }, async (repositoryRoot) => {
      const harness = createHarness();
      const blueprint = createAfkDeliveryBlueprint(harness.blueprintOptions);
      const runDirectory = path.join(repositoryRoot, "evidence");

      const result = await blueprint.run({
        itemId: "wi-005",
        cwd: repositoryRoot,
        runDirectory,
        evidenceManifestPath: path.join(runDirectory, "manifest.json"),
      });

      assert.equal(result.status, "paused");
      assert.match(result.reason, /evidence|manifest|hash/i);
      assert.deepEqual(harness.transitionCalls, []);
    });
  });
});
