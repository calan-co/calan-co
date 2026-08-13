import assert from "node:assert/strict";
import test from "node:test";

import { createGitWorktreeTransaction } from "../src/git-worktree-transaction.js";

function createHarness({ branch = "main", casFails = false, mergeFails = false, checksPass = true, checksThrow = false } = {}) {
  const calls = [];
  const events = [];
  const acceptanceCalls = [];
  const git = async ({ args, cwd }) => {
    calls.push({ args, cwd });
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") return "/repo\n";
    if (command === "symbolic-ref --quiet --short HEAD") {
      if (!branch) throw new Error("detached HEAD");
      return `${branch}\n`;
    }
    if (command.startsWith("check-ref-format --branch ")) return `${args.at(-1)}\n`;
    if (command === "rev-parse --verify refs/heads/main") return "aaaaaaaa\n";
    if (command === "rev-parse HEAD") return "bbbbbbbb\n";
    if (command.startsWith("merge ") && mergeFails) throw new Error("merge conflict");
    if (command.startsWith("update-ref ") && casFails) throw new Error("cannot lock ref");
    return "";
  };
  const transaction = createGitWorktreeTransaction({
    git,
    journal: { append: async (event) => events.push(event) },
    paths: {
      item: ({ itemId }) => ({ branch: `items/${itemId}`, worktree: `/items/${itemId}` }),
      integration: ({ itemId }) => ({ worktree: `/integration/${itemId}` }),
    },
    acceptance: { run: async (input) => { acceptanceCalls.push(input); if (checksThrow) throw new Error("root check failed"); return checksPass; } },
  });
  return { calls, events, acceptanceCalls, transaction };
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
