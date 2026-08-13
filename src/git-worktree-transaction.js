function text(result) {
  return typeof result === "string" ? result.trim() : String(result ?? "").trim();
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function validSha(value) {
  return /^[0-9a-f]{4,}$/i.test(value);
}

/**
 * Stack-neutral isolated-worktree delivery transaction.
 *
 * `git` receives `{ args, cwd }`; callers supply their own process adapter.
 * `journal`, `paths`, and `acceptance` are injected so this module has no Node
 * process, filesystem, or acceptance-stack dependency.
 */
export function createGitWorktreeTransaction({ git, journal, paths, acceptance }) {
  if (typeof git !== "function") throw new TypeError("git runner must be a function");
  if (!journal || typeof journal.append !== "function") throw new TypeError("journal sink must append evidence");
  if (!paths || typeof paths.item !== "function" || typeof paths.integration !== "function") throw new TypeError("worktree paths must be provided");
  if (!acceptance || typeof acceptance.run !== "function") throw new TypeError("acceptance adapter must run checks");

  const run = async (args, cwd) => text(await git({ args, cwd }));
  const record = async (event) => journal.append(event);

  async function resolveTarget({ cwd, targetBranch }) {
    requireString(cwd, "invocation cwd");
    const repositoryRoot = await run(["rev-parse", "--show-toplevel"], cwd);
    if (!repositoryRoot) throw new Error("Invocation PWD is outside a Git worktree");
    let branch = targetBranch;
    if (branch === undefined) {
      try { branch = await run(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd); } catch {
        throw new Error("Target branch is ambiguous: invocation PWD has detached HEAD");
      }
    }
    requireString(branch, "target branch");
    await run(["check-ref-format", "--branch", branch], repositoryRoot);
    let baseSha;
    try { baseSha = await run(["rev-parse", "--verify", `refs/heads/${branch}`], repositoryRoot); } catch {
      throw new Error(`Unknown target branch: ${branch}`);
    }
    if (!validSha(baseSha)) throw new Error(`Unknown target branch: ${branch}`);
    return { repositoryRoot, targetBranch: branch, targetBaseSha: baseSha };
  }

  async function prepareItem({ itemId, cwd, targetBranch } = {}) {
    requireString(itemId, "item ID");
    const target = await resolveTarget({ cwd, targetBranch });
    const location = await paths.item({ itemId, ...target });
    if (!location || typeof location !== "object") throw new TypeError("item worktree path must be provided");
    const branch = requireString(location.branch, "item branch");
    const worktree = requireString(location.worktree, "item worktree");
    await run(["worktree", "add", "-b", branch, worktree, target.targetBaseSha], target.repositoryRoot);
    const item = { itemId, ...target, branch, worktree };
    await record({ type: "item-worktree-created", itemId, targetBranch: target.targetBranch, targetBaseSha: target.targetBaseSha, branch, worktree });
    return item;
  }

  async function cleanup(item, integrationWorktree) {
    await run(["worktree", "remove", "--force", integrationWorktree], item.repositoryRoot);
    await run(["worktree", "remove", "--force", item.worktree], item.repositoryRoot);
    await run(["branch", "-D", item.branch], item.repositoryRoot);
  }

  async function deliver({ item, strategy = "merge-commit" } = {}) {
    if (!item || typeof item !== "object") throw new TypeError("item worktree evidence is required");
    for (const key of ["itemId", "repositoryRoot", "targetBranch", "targetBaseSha", "branch", "worktree"]) requireString(item[key], `item.${key}`);
    if (!validSha(item.targetBaseSha)) throw new TypeError("item.targetBaseSha must be a Git SHA");
    if (!["merge-commit", "squash", "rebase"].includes(strategy)) throw new TypeError("unknown integration strategy");
    const location = await paths.integration({ itemId: item.itemId, item, strategy });
    const worktree = requireString(location?.worktree, "integration worktree");

    try {
      const start = strategy === "rebase" ? item.branch : item.targetBaseSha;
      await run(["worktree", "add", "--detach", worktree, start], item.repositoryRoot);
      if (strategy === "merge-commit") {
        await run(["merge", "--no-ff", "--no-edit", item.branch], worktree);
      } else if (strategy === "squash") {
        await run(["merge", "--squash", item.branch], worktree);
        await run(["commit", "--no-edit", "-m", `Integrate ${item.itemId}`], worktree);
      } else {
        await run(["rebase", item.targetBranch], worktree);
      }
    } catch (error) {
      await record({ type: "delivery-conflict", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy, error: error.message });
      return { status: "conflict", itemWorktree: item.worktree, integrationWorktree: worktree };
    }

    let checksPassed;
    try {
      checksPassed = await acceptance.run({ candidate: "integration", repositoryRoot: item.repositoryRoot, worktree, item, strategy });
    } catch (error) {
      await record({ type: "delivery-failed", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy, error: error.message });
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }
    if (!checksPassed) {
      await record({ type: "delivery-failed", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy });
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }

    const candidateSha = await run(["rev-parse", "HEAD"], worktree);
    if (!validSha(candidateSha)) throw new Error("integration candidate did not produce a Git SHA");
    try {
      await run(["update-ref", `refs/heads/${item.targetBranch}`, candidateSha, item.targetBaseSha], item.repositoryRoot);
    } catch (error) {
      await record({ type: "delivery-stale", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, candidateSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy, error: error.message });
      return { status: "stale", itemWorktree: item.worktree, integrationWorktree: worktree, candidateSha };
    }

    await cleanup(item, worktree);
    await record({ type: "delivery-published", itemId: item.itemId, targetBranch: item.targetBranch, expectedBaseSha: item.targetBaseSha, publishedSha: candidateSha, strategy });
    return { status: "delivered", targetBranch: item.targetBranch, publishedSha: candidateSha };
  }

  return Object.freeze({ prepareItem, deliver });
}
