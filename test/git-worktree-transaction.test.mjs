import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGitWorktreeTransaction } from "../src/git-worktree-transaction.js";

function createHarness({
  branch = "main",
  casFails = false,
  casFailures = casFails ? Infinity : 0,
  mergeFails = false,
  mergeOperationalFails = false,
  integrationProvisionFails = false,
  cleanupFails = false,
  checksPass = true,
  checksThrow = false,
  journalFails = false,
  publicationIntentJournalFails = false,
  casFailureTargetSha = casFailures > 0 ? "cccccccc" : undefined,
  reviewApproves = true,
} = {}) {
  const calls = [];
  const events = [];
  const timeline = [];
  const acceptanceCalls = [];
  const reviewCalls = [];
  let targetSha = "aaaaaaaa";
  let remainingCasFailures = casFailures;
  const git = async ({ args, cwd }) => {
    calls.push({ args, cwd });
    timeline.push({ operation: "git", command: args.join(" ") });
    const command = args.join(" ");
    if (command.startsWith("worktree add --detach") && integrationProvisionFails) throw new Error("disk unavailable");
    if (command.startsWith("worktree remove") && cleanupFails) throw new Error("cleanup unavailable");
    if (command === "rev-parse --show-toplevel") return "/repo\n";
    if (command === "symbolic-ref --quiet --short HEAD") {
      if (!branch) throw new Error("detached HEAD");
      return `${branch}\n`;
    }
    if (command.startsWith("check-ref-format --branch ")) return `${args.at(-1)}\n`;
    if (command === "rev-parse --verify refs/heads/main") return `${targetSha}\n`;
    if (command === "rev-parse HEAD") return "bbbbbbbb\n";
    if (command === "diff --name-only --diff-filter=U") return mergeFails ? "conflicted-file\n" : "";
    if (command.startsWith("merge ") && (mergeFails || mergeOperationalFails)) {
      const error = new Error(mergeFails ? "merge conflict" : "merge could not read object");
      error.exitCode = 1;
      throw error;
    }
    if (command.startsWith("update-ref ") && remainingCasFailures > 0) {
      remainingCasFailures -= 1;
      if (casFailureTargetSha) targetSha = casFailureTargetSha;
      throw new Error("cannot lock ref");
    }
    if (command.startsWith("update-ref ")) targetSha = args[2];
    return "";
  };
  const transaction = createGitWorktreeTransaction({
    git,
    journal: { append: async (event) => {
      if (publicationIntentJournalFails && event.type === "delivery-publication-intent") throw new Error("intent journal unavailable");
      if (journalFails && event.type === "delivery-published") throw new Error("journal unavailable");
      events.push(event);
      timeline.push({ operation: "journal", event });
    } },
    paths: {
      item: ({ itemId }) => ({ branch: `items/${itemId}`, worktree: `/items/${itemId}` }),
      integration: ({ itemId }) => ({ worktree: `/integration/${itemId}` }),
    },
    acceptance: { run: async (input) => { acceptanceCalls.push(input); if (checksThrow) throw new Error("root check failed"); return checksPass; } },
    review: { verify: async (input) => { reviewCalls.push(input); return reviewApproves; } },
  });
  return { calls, events, timeline, acceptanceCalls, reviewCalls, transaction };
}

test("creates an isolated item worktree from the invocation PWD branch and journals its base", async () => {
  const { calls, events, transaction } = createHarness();

  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo/packages/app" });

  assert.deepEqual(item, {
    itemId: "003",
    repositoryRoot: "/repo",
    targetBranch: "main",
    targetBaseSha: "aaaaaaaa",
    branch: "items/003",
    worktree: "/items/003",
  });
  assert.deepEqual(calls.at(-1), {
    cwd: "/repo",
    args: ["worktree", "add", "-b", "items/003", "/items/003", "aaaaaaaa"],
  });
  assert.deepEqual(events.at(-1), {
    type: "item-worktree-created",
    itemId: "003",
    targetBranch: "main",
    targetBaseSha: "aaaaaaaa",
    branch: "items/003",
    worktree: "/items/003",
  });
});

test("fails closed for detached or unknown explicit target branches", async () => {
  const detached = createHarness({ branch: "" }).transaction;
  await assert.rejects(detached.prepareItem({ itemId: "003", cwd: "/repo" }), /detached|target/i);

  const { transaction } = createHarness();
  await assert.rejects(
    transaction.prepareItem({ itemId: "003", cwd: "/repo", targetBranch: "missing" }),
    /target branch|unknown/i,
  );
});

test("runs merge-commit integration checks in a temporary worktree and only then CAS-publishes", async () => {
  const { calls, events, acceptanceCalls, transaction } = createHarness();
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.deepEqual(result, { status: "delivered", targetBranch: "main", publishedSha: "bbbbbbbb" });
  assert.ok(calls.some(({ args }) => args.join(" ") === "merge --no-ff --no-edit items/003"));
  assert.ok(calls.some(({ args }) => args.join(" ") === "update-ref refs/heads/main bbbbbbbb aaaaaaaa"));
  assert.deepEqual(acceptanceCalls, [{
    candidate: "integration",
    repositoryRoot: "/repo",
    worktree: "/integration/003",
    item,
    strategy: "merge-commit",
  }]);
  assert.deepEqual(calls.slice(-3).map(({ args }) => args), [
    ["worktree", "remove", "--force", "/integration/003"],
    ["worktree", "remove", "--force", "/items/003"],
    ["branch", "-D", "items/003"],
  ]);
  assert.equal(events.at(-1).type, "delivery-published");
});

test("preserves item and integration worktrees with recovery evidence after conflict, failed checks, or stale CAS", async () => {
  for (const [name, options, status] of [
    ["conflict", { mergeFails: true }, "conflict"],
    ["failed checks", { checksPass: false }, "failed"],
    ["stale CAS", { casFails: true }, "stale"],
  ]) {
    const { calls, events, transaction } = createHarness(options);
    const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });
    const result = await transaction.deliver({ item });

    assert.equal(result.status, status, name);
    assert.equal(calls.some(({ args }) => args[0] === "worktree" && args[1] === "remove"), false, name);
    assert.equal(events.at(-1).type, `delivery-${status}`, name);
  }
});

test("preserves worktrees when the injected root-check adapter throws", async () => {
  const { calls, events, transaction } = createHarness({ checksThrow: true });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  const result = await transaction.deliver({ item });
  assert.equal(result.status, "failed");
  assert.equal(calls.some(({ args }) => args[0] === "worktree" && args[1] === "remove"), false);
  assert.equal(events.at(-1).type, "delivery-failed");
});

test("uses explicit target overrides and supports squash and rebase strategies", async () => {
  for (const strategy of ["squash", "rebase"]) {
    const { calls, transaction } = createHarness();
    const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo", targetBranch: "main" });
    await transaction.deliver({ item, strategy });
    const commands = calls.map(({ args }) => args.join(" "));
    assert.ok(commands.includes(strategy === "squash" ? "merge --squash items/003" : "rebase main"), strategy);
  }
});

test("returns an explicit stale recovery contract rather than publishing a stale candidate", async () => {
  const { calls, transaction } = createHarness({ casFails: true });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.equal(result.status, "stale");
  assert.equal(result.recovery.action, "refreshStale");
  assert.deepEqual(result.recovery.required, ["refresh-at-current-target", "root-acceptance", "independent-review", "explicit-retry"]);
  assert.equal(calls.filter(({ args }) => args[0] === "update-ref").length, 1);
  assert.equal(typeof transaction.refreshStale, "function");
  assert.equal(typeof transaction.retryStale, "function");
});

test("treats a CAS failure without target movement as a recoverable publication failure", async () => {
  const { calls, events, transaction } = createHarness({ casFails: true, casFailureTargetSha: "aaaaaaaa" });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.equal(result.status, "publication-failed");
  assert.equal(result.recovery.action, "retryPublication");
  assert.equal(calls.filter(({ args }) => args.join(" ") === "rev-parse --verify refs/heads/main").length, 2);
  assert.equal(calls.some(({ args }) => args[0] === "worktree" && args[1] === "remove"), false);
  assert.equal(events.at(-1).type, "delivery-publication-failed");
});

test("refreshes stale candidates through root acceptance and gates retry on verified fresh independent review", async () => {
  const { acceptanceCalls, reviewCalls, transaction } = createHarness({ casFailures: 1 });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  const stale = await transaction.deliver({ item });

  const refreshed = await transaction.refreshStale({ stale });

  assert.equal(refreshed.status, "refreshed");
  assert.equal(acceptanceCalls.length, 2);
  await assert.rejects(transaction.retryStale({ refreshed }), /independent review/);
  const result = await transaction.retryStale({
    refreshed,
    independentReview: {
      approved: true,
      fresh: true,
      candidateSha: refreshed.candidateSha,
      reviewer: { identity: "reviewer", context: "independent-review-context" },
      implementer: { identity: "implementer", context: "implementation-context" },
    },
  });
  assert.equal(result.status, "delivered");
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].candidate.candidateSha, refreshed.candidateSha);
});

test("requires review evidence to be structured, independent, fresh, and accepted by the injected verifier", async () => {
  const { transaction } = createHarness({ casFailures: 1, reviewApproves: false });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  const stale = await transaction.deliver({ item });
  const refreshed = await transaction.refreshStale({ stale });
  const evidence = {
    approved: true,
    fresh: true,
    candidateSha: refreshed.candidateSha,
    reviewer: { identity: "reviewer", context: "independent-review-context" },
    implementer: { identity: "implementer", context: "implementation-context" },
  };

  await assert.rejects(transaction.retryStale({ refreshed, independentReview: { approved: true, candidateSha: refreshed.candidateSha } }), /independent review/);
  await assert.rejects(transaction.retryStale({ refreshed, independentReview: { ...evidence, reviewer: evidence.implementer } }), /independent review/);
  await assert.rejects(transaction.retryStale({ refreshed, independentReview: evidence }), /independent review/);
});

test("writes durable publication intent before CAS and aborts before CAS when intent journaling fails", async () => {
  const failedIntent = createHarness({ publicationIntentJournalFails: true });
  const failedItem = await failedIntent.transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const failedResult = await failedIntent.transaction.deliver({ item: failedItem });

  assert.equal(failedResult.status, "publication-failed");
  assert.equal(failedResult.recovery.action, "retryPublication");
  assert.equal(failedIntent.calls.some(({ args }) => args[0] === "update-ref"), false);
  assert.equal(failedIntent.calls.some(({ args }) => args[0] === "worktree" && args[1] === "remove"), false);

  const successfulIntent = createHarness();
  const item = await successfulIntent.transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  await successfulIntent.transaction.deliver({ item });
  const intent = successfulIntent.events.find((event) => event.type === "delivery-publication-intent");
  assert.deepEqual(intent, {
    type: "delivery-publication-intent",
    itemId: "003",
    repositoryRoot: "/repo",
    targetBranch: "main",
    expectedBaseSha: "aaaaaaaa",
    candidateSha: "bbbbbbbb",
    itemWorktree: "/items/003",
    integrationWorktree: "/integration/003",
    strategy: "merge-commit",
  });
  assert.ok(successfulIntent.timeline.findIndex(({ operation, event }) => operation === "journal" && event === intent) < successfulIntent.timeline.findIndex(({ operation, command }) => operation === "git" && command.startsWith("update-ref ")));
});

test("uses durable publication intent and preserves worktrees when post-CAS publication journaling fails", async () => {
  const { calls, events, transaction } = createHarness({ journalFails: true });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.equal(result.status, "published-but-recording-failed");
  assert.equal(result.recovery.targetAlreadyPublished, true);
  assert.equal(result.recovery.cleanupRequired, true);
  assert.equal(result.recovery.publicationIntent.type, "delivery-publication-intent");
  assert.equal(calls.some(({ args }) => args[0] === "worktree" && args[1] === "remove"), false);
  assert.ok(events.some((event) => event.type === "delivery-publication-intent"));
  assert.equal(events.some((event) => event.type === "delivery-published"), false);
});

test("turns post-publication cleanup failures into inspectable recovery states", async () => {
  const { calls, events, transaction } = createHarness({ cleanupFails: true });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.equal(result.status, "published-but-cleanup-failed");
  assert.equal(result.recovery.targetAlreadyPublished, true);
  assert.equal(result.recovery.cleanupRequired, true);
  assert.equal(result.recovery.itemWorktree, item.worktree);
  assert.equal(calls.some(({ args }) => args[0] === "update-ref"), true);
  assert.ok(events.some((event) => event.type === "delivery-published-but-cleanup-failed"));
});

test("reports worktree provisioning failures separately from integration conflicts", async () => {
  const provisioned = createHarness({ integrationProvisionFails: true });
  const item = await provisioned.transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  const provisionResult = await provisioned.transaction.deliver({ item });
  assert.equal(provisionResult.status, "failed");
  assert.equal(provisioned.events.at(-1).phase, "provisioning");

  const conflicting = createHarness({ mergeFails: true });
  const conflictItem = await conflicting.transaction.prepareItem({ itemId: "003", cwd: "/repo" });
  const conflictResult = await conflicting.transaction.deliver({ item: conflictItem });
  assert.equal(conflictResult.status, "conflict");
  assert.equal(conflicting.events.at(-1).phase, "integration");
});

test("treats an integration command error without unmerged paths as an operational failure", async () => {
  const { events, transaction } = createHarness({ mergeOperationalFails: true });
  const item = await transaction.prepareItem({ itemId: "003", cwd: "/repo" });

  const result = await transaction.deliver({ item });

  assert.equal(result.status, "failed");
  assert.equal(events.at(-1).type, "delivery-failed");
  assert.equal(events.at(-1).phase, "integration");
});

function gitIn(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function temporaryRepository() {
  const root = mkdtempSync(join(tmpdir(), "git-worktree-transaction-"));
  gitIn(root, ["init", "--initial-branch=main"]);
  gitIn(root, ["config", "user.email", "test@example.invalid"]);
  gitIn(root, ["config", "user.name", "Transaction Test"]);
  writeFileSync(join(root, "README.md"), "base\n");
  gitIn(root, ["add", "README.md"]);
  gitIn(root, ["commit", "-m", "base"]);
  return root;
}

function realTransaction(root, { acceptance = async () => true, beforeUpdateRef, review = { verify: async () => true } } = {}) {
  const events = [];
  const git = async ({ args, cwd }) => {
    if (args[0] === "update-ref" && beforeUpdateRef) await beforeUpdateRef();
    try {
      return gitIn(cwd, args);
    } catch (cause) {
      const error = new Error(cause.stderr?.toString() || cause.message);
      error.exitCode = cause.status;
      throw error;
    }
  };
  const transaction = createGitWorktreeTransaction({
    git,
    journal: { append: async (event) => events.push(event) },
    paths: {
      item: ({ itemId }) => ({ branch: `items/${itemId}`, worktree: join(root, `.item-${itemId}`) }),
      integration: ({ itemId, attempt = 0 }) => ({ worktree: join(root, `.integration-${itemId}-${attempt}`) }),
    },
    acceptance: { run: acceptance },
    review,
  });
  return { events, transaction };
}

function commitItemChange(item) {
  writeFileSync(join(item.worktree, "item.txt"), "item\n");
  gitIn(item.worktree, ["add", "item.txt"]);
  gitIn(item.worktree, ["commit", "-m", "item change"]);
}

test("real Git root-check failure leaves target unchanged and retains both worktrees", async () => {
  const root = temporaryRepository();
  try {
    const { transaction } = realTransaction(root, { acceptance: async () => false });
    const item = await transaction.prepareItem({ itemId: "003", cwd: root });
    commitItemChange(item);
    const before = gitIn(root, ["rev-parse", "main"]);

    const result = await transaction.deliver({ item });

    assert.equal(result.status, "failed");
    assert.equal(gitIn(root, ["rev-parse", "main"]), before);
    assert.equal(existsSync(item.worktree), true);
    assert.equal(existsSync(join(root, ".integration-003-0")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real Git CAS race retains competing target and both recovery worktrees", async () => {
  const root = temporaryRepository();
  let raced = false;
  try {
    const { transaction } = realTransaction(root, {
      beforeUpdateRef: async () => {
        if (raced) return;
        raced = true;
        writeFileSync(join(root, "race.txt"), "competing\n");
        gitIn(root, ["add", "race.txt"]);
        gitIn(root, ["commit", "-m", "competing target advance"]);
      },
    });
    const item = await transaction.prepareItem({ itemId: "003", cwd: root });
    commitItemChange(item);

    const result = await transaction.deliver({ item });

    assert.equal(result.status, "stale");
    assert.equal(gitIn(root, ["rev-parse", "main"]), gitIn(root, ["rev-parse", "HEAD"]));
    assert.match(gitIn(root, ["log", "-1", "--format=%s", "main"]), /competing target advance/);
    assert.equal(existsSync(item.worktree), true);
    assert.equal(existsSync(join(root, ".integration-003-0")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real Git executes and publishes merge-commit, squash, and rebase candidates", async () => {
  for (const strategy of ["merge-commit", "squash", "rebase"]) {
    const root = temporaryRepository();
    try {
      const { transaction } = realTransaction(root);
      const item = await transaction.prepareItem({ itemId: "003", cwd: root });
      commitItemChange(item);

      const result = await transaction.deliver({ item, strategy });

      assert.equal(result.status, "delivered", strategy);
      assert.match(gitIn(root, ["show", "main:item.txt"]), /item/, strategy);
      if (strategy === "merge-commit") assert.equal(gitIn(root, ["rev-list", "--parents", "-n", "1", "main"]).split(" ").length, 3, strategy);
      if (strategy === "squash") assert.match(gitIn(root, ["log", "-1", "--format=%s", "main"]), /Integrate 003/, strategy);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
