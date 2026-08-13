import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const loadBlueprint = () => import("../src/afk-delivery-blueprint.js");
const loadEvidence = () => import("../src/evidence-manifest.js");
const loadOverride = () => import("../src/repository-override-loader.js");
const loadCoordinator = () => import("../src/review-remediation-coordinator.js");
const loadTransaction = () => import("../src/git-worktree-transaction.js");

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
    artifacts.push({ path: relative, category, sha256: sha256(contents), transition: "prepare-item" });
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
        withEvidenceGuard: () => {},
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

test("evidence rejects external manifests, symlink artifacts, and missing action linkage", async (t) => {
  const { verifyEvidenceManifest } = await loadEvidence();
  await t.test("rejects external manifest and symlink artifact", async () => {
    const files = await validEvidenceFiles();
    await withFixture(files, async (root) => {
      const evidence = path.join(root, "evidence");
      await writeFile(path.join(root, "outside.json"), "outside\n");
      await rm(path.join(evidence, "input.json"));
      await symlink(path.join(root, "outside.json"), path.join(evidence, "input.json"));
      await assert.rejects(verifyEvidenceManifest({ runDirectory: evidence }), /symlink|escape|regular/i);
      await assert.rejects(verifyEvidenceManifest({ runDirectory: evidence, manifestPath: path.join(root, "outside.json") }), /manifest.*run-directory/i);
    });
  });
  await t.test("requires evidence linked to the guarded action", async () => {
    await withFixture(await validEvidenceFiles(), async (root) => {
      await assert.rejects(verifyEvidenceManifest({ runDirectory: path.join(root, "evidence"), expectedTransition: "dv-close" }), /linked.*dv-close/i);
    });
  });
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

function gitIn(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "blueprint-real-git-"));
  gitIn(root, ["init", "--initial-branch=main"]); gitIn(root, ["config", "user.email", "test@example.invalid"]); gitIn(root, ["config", "user.name", "Blueprint Test"]);
  writeFileSync(path.join(root, "README.md"), "base\n"); gitIn(root, ["add", "README.md"]); gitIn(root, ["commit", "-m", "base"]); return root;
}

// These exercise the blueprint entrypoint with composed coordinator/real Git transaction ports.
test("blueprint composed real Git fixtures preserve delivery policy", async (t) => {
  const { createAfkDeliveryBlueprint } = await loadBlueprint();
  const { createReviewRemediationCoordinator } = await loadCoordinator();
  const { createGitWorktreeTransaction } = await loadTransaction();
  async function runScenario(name, setup) {
    await t.test(name, async () => {
      const root = temporaryRepository();
      try {
        const events = []; let reviews = 0; let closes = 0;
        const git = async ({ args, cwd }) => {
          if (args[0] === "merge" && setup.mergeConflict) { const error = new Error("merge conflict"); error.exitCode = 1; throw error; }
          if (args[0] === "diff" && args.includes("--diff-filter=U") && setup.mergeConflict) return "README.md\n";
          if (args[0] === "update-ref" && setup.beforeUpdateRef) await setup.beforeUpdateRef(root);
          return gitIn(cwd, args);
        };
        const transaction = createGitWorktreeTransaction({
          git, journal: { append: async (event) => events.push(event) },
          paths: { item: ({ itemId }) => ({ branch: `items/${itemId}`, worktree: path.join(root, `.item-${itemId}`) }), integration: ({ itemId, attempt = 0 }) => ({ worktree: path.join(root, `.integration-${itemId}-${attempt}`) }) },
          acceptance: { run: async () => setup.rootChecks ?? true }, review: { verify: async () => true },
          // Blueprint overwrites this guard with its durable manifest verifier.
          guard: { before: async () => { throw new Error("blueprint failed to inject guard"); } },
        });
        const coordinator = createReviewRemediationCoordinator({
          policy: { changedPaths: async () => ["README.md"], authorize: async () => true }, journal: { append: async () => {} },
          review: { request: async () => { reviews += 1; return setup.review?.(reviews) ?? { verdict: "approved", reviewer: { identity: `reviewer-${reviews}`, context: `review-${reviews}` } }; } },
          acceptance: { execute: async () => ({ passed: true }) },
          dv: { close: async () => { closes += 1; if (setup.closeFails) throw new Error("close failed"); return { schemaVersion: "task-close/v1", id: "wi-005", status: "closed", lifecycle: "closed" }; } },
          workspace: { commitTracked: async ({ cwd }) => { writeFileSync(path.join(cwd, "closure.txt"), "closed\n"); gitIn(cwd, ["add", "closure.txt"]); gitIn(cwd, ["commit", "-m", "closure"]); return { committed: true }; } }, integration: transaction,
        });
        const blueprint = createAfkDeliveryBlueprint({ worktreeTransaction: transaction, delivery: coordinator, state: { transition: async () => {} } });
        const result = await blueprint.run({ itemId: "wi-005", cwd: root, runDirectory: path.join(root, "run"), implementer: { identity: "implementer", context: "implementation", remediate: async () => true } });
        await setup.assert({ root, result, reviews, closes, events });
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
  await runScenario("reviewed closure commit and CAS success", { assert: async ({ root, result, closes }) => {
    assert.equal(result.status, "delivered"); assert.equal(closes, 1); assert.match(gitIn(root, ["log", "-1", "--format=%s", "main"]), /Merge branch/);
    const runEvents = (await readFile(path.join(root, "run", "journal.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
    for (const action of ["cas-publication", "cleanup"]) assert.ok(runEvents.some((event) => event.event?.action === action), action);
    assert.ok(runEvents.every((event, index) => event.sequence === index + 1));
  } });
  await runScenario("changes-requested remediates, accepts, and receives fresh review", { review: (n) => n === 1 ? { verdict: "changes-requested", findings: [{ path: "README.md", line: 1, message: "fix" }], reviewer: { identity: "reviewer-1", context: "review-1" } } : { verdict: "approved", reviewer: { identity: "reviewer-2", context: "review-2" } }, assert: ({ result, reviews }) => { assert.equal(result.status, "delivered"); assert.equal(reviews, 2); } });
  await runScenario("close failure never integrates", { closeFails: true, assert: ({ root, result, closes }) => { assert.equal(result.status, "paused"); assert.equal(closes, 1); assert.equal(gitIn(root, ["log", "-1", "--format=%s", "main"]), "base"); } });
  await runScenario("root failure leaves target unchanged and worktree retained", { rootChecks: false, assert: ({ root, result }) => { assert.equal(result.status, "failed"); assert.equal(gitIn(root, ["log", "-1", "--format=%s", "main"]), "base"); assert.equal(existsSync(path.join(root, ".item-wi-005")), true); } });
  let raced = false;
  await runScenario("stale CAS refreshes, root-checks, and gets fresh review", { beforeUpdateRef: async (root) => { if (raced) return; raced = true; writeFileSync(path.join(root, "race.txt"), "race\n"); gitIn(root, ["add", "race.txt"]); gitIn(root, ["commit", "-m", "race"]); }, assert: ({ result, reviews }) => { assert.equal(result.status, "delivered"); assert.equal(reviews, 2); } });
  await runScenario("merge conflict leaves target unchanged and worktree preserved", { mergeConflict: true, assert: ({ root, result }) => { assert.equal(result.status, "conflict"); assert.equal(gitIn(root, ["log", "-1", "--format=%s", "main"]), "base"); assert.equal(existsSync(path.join(root, ".item-wi-005")), true); assert.equal(existsSync(path.join(root, ".integration-wi-005-0")), true); } });
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

test("composed coordinator guards every side effect and leaves reconstructable typed evidence", async () => {
  const { createAfkDeliveryBlueprint } = await loadBlueprint();
  const { createReviewRemediationCoordinator } = await loadCoordinator();
  await withFixture({}, async (root) => {
    const calls = [];
    const coordinator = createReviewRemediationCoordinator({
      policy: { changedPaths: async () => ["src/a.js"], authorize: async () => true },
      journal: { append: async (event) => calls.push(`journal:${event.type}`) },
      review: { request: async () => ({ verdict: "approved", reviewer: { identity: "reviewer", context: "review-1" } }) },
      acceptance: { execute: async () => ({ passed: true }) },
      dv: { close: async () => { calls.push("close"); return { schemaVersion: "task-close/v1", id: "wi-005", status: "closed", lifecycle: "closed" }; } },
      workspace: { commitTracked: async () => { calls.push("commit"); return { committed: true }; } },
      integration: { deliver: async () => { calls.push("deliver"); return { status: "delivered" }; } },
    });
    const blueprint = createAfkDeliveryBlueprint({
      worktreeTransaction: { withEvidenceGuard: () => {}, prepareItem: async () => ({ itemId: "wi-005", worktree: root, changedPaths: ["src/a.js"] }) },
      delivery: coordinator,
      state: { transition: async () => {} },
    });
    const result = await blueprint.run({ itemId: "wi-005", cwd: root, runDirectory: path.join(root, "run"), implementer: { identity: "implementer", context: "implementation-1" } });
    assert.equal(result.status, "delivered");
    assert.deepEqual(calls.filter((call) => !call.startsWith("journal:")), ["close", "commit", "deliver"]);
    const manifest = JSON.parse(await readFile(path.join(root, "run", "manifest.json"), "utf8"));
    for (const transition of ["prepare-item", "review-request", "dv-close", "closure-commit", "integration-deliver", "state-transition"]) assert.ok(manifest.artifacts.some((artifact) => artifact.transition === transition), transition);
    const journal = (await readFile(path.join(root, "run", "journal.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(journal.every((event, index) => event.sequence === index + 1));
    assert.ok(journal.some((event) => event.category === "dv" && event.transition === "dv-close"));
  });
});

test("v6 process resolves ports from JSON-selected importable configuration", async () => {
  const { process } = await import("../blueprints/babysitter-afk-v6/process.mjs");
  await withFixture({}, async (root) => {
    const config = path.join(root, "ports.mjs");
    await writeFile(config, `export function createPorts() { return { maxReviewCycles: 10, worktreeTransaction: { withEvidenceGuard: () => {}, prepareItem: async () => ({ itemId: "wi-005", worktree: "/item" }) }, delivery: { review: async () => ({ status: "delivered" }) }, state: { transition: async () => {} } }; }`);
    const result = await process({ configModule: config, runInput: { itemId: "wi-005", cwd: root, runDirectory: path.join(root, "run") } }, { task: async () => ({}) });
    assert.equal(result.status, "delivered");
    await assert.rejects(process({ runInput: {} }, { task: async () => ({}) }), /configModule/i);
    await assert.rejects(process({ configModule: "../ports.mjs", runInput: {} }, { task: async () => ({}) }), /absolute.*mjs/i);
  });
});

test("v6 package and operator documentation expose portable process contracts", async () => {
  const process = await import("../blueprints/babysitter-afk-v6/process.mjs");
  const packageMetadata = JSON.parse(await readFile(new URL("../blueprints/babysitter-afk-v6/package.json", import.meta.url), "utf8"));
  const docs = await readFile(new URL("../blueprints/babysitter-afk-v6/README.md", import.meta.url), "utf8");
  assert.equal(packageMetadata.version, "6.0.0");
  assert.equal(typeof process.process, "function");
  for (const phrase of ["babysitter run:create", "babysitter run:iterate", "configModule", "JSON-safe", "repository override", "run directory", "adapter", "Node-first", "lockfile"]) assert.match(docs, new RegExp(phrase, "i"));
});
