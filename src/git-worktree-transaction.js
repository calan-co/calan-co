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
export function createGitWorktreeTransaction({ git, journal, paths, acceptance, review }) {
  if (typeof git !== "function") throw new TypeError("git runner must be a function");
  if (!journal || typeof journal.append !== "function") throw new TypeError("journal sink must append evidence");
  if (!paths || typeof paths.item !== "function" || typeof paths.integration !== "function") throw new TypeError("worktree paths must be provided");
  if (!acceptance || typeof acceptance.run !== "function") throw new TypeError("acceptance adapter must run checks");
  if (!review || typeof review.verify !== "function") throw new TypeError("review verifier must validate evidence");

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

  function assertItem(item) {
    if (!item || typeof item !== "object") throw new TypeError("item worktree evidence is required");
    for (const key of ["itemId", "repositoryRoot", "targetBranch", "targetBaseSha", "branch", "worktree"]) requireString(item[key], `item.${key}`);
    if (!validSha(item.targetBaseSha)) throw new TypeError("item.targetBaseSha must be a Git SHA");
  }

  function assertStrategy(strategy) {
    if (!["merge-commit", "squash", "rebase"].includes(strategy)) throw new TypeError("unknown integration strategy");
  }

  async function cleanup(item, integrationWorktree) {
    await run(["worktree", "remove", "--force", integrationWorktree], item.repositoryRoot);
    await run(["worktree", "remove", "--force", item.worktree], item.repositoryRoot);
    await run(["branch", "-D", item.branch], item.repositoryRoot);
  }

  function failure(item, worktree, strategy, phase, error) {
    return { type: "delivery-failed", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy, phase, ...(error ? { error: error.message } : {}) };
  }

  async function createCandidate(item, strategy, worktree) {
    try {
      const start = strategy === "rebase" ? item.branch : item.targetBaseSha;
      await run(["worktree", "add", "--detach", worktree, start], item.repositoryRoot);
    } catch (error) {
      await record(failure(item, worktree, strategy, "provisioning", error));
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }
    try {
      if (strategy === "merge-commit") {
        await run(["merge", "--no-ff", "--no-edit", item.branch], worktree);
      } else if (strategy === "squash") {
        await run(["merge", "--squash", item.branch], worktree);
        await run(["commit", "--no-edit", "-m", `Integrate ${item.itemId}`], worktree);
      } else {
        await run(["rebase", item.targetBranch], worktree);
      }
    } catch (error) {
      const unmergedPaths = await run(["diff", "--name-only", "--diff-filter=U"], worktree).catch(() => "");
      if (unmergedPaths) {
        await record({ type: "delivery-conflict", itemId: item.itemId, targetBranch: item.targetBranch, targetBaseSha: item.targetBaseSha, itemWorktree: item.worktree, integrationWorktree: worktree, strategy, phase: "integration", error: error.message });
        return { status: "conflict", itemWorktree: item.worktree, integrationWorktree: worktree };
      }
      await record(failure(item, worktree, strategy, "integration", error));
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }
    let checksPassed;
    try {
      checksPassed = await acceptance.run({ candidate: "integration", repositoryRoot: item.repositoryRoot, worktree, item, strategy });
    } catch (error) {
      await record(failure(item, worktree, strategy, "acceptance", error));
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }
    if (!checksPassed) {
      await record(failure(item, worktree, strategy, "acceptance"));
      return { status: "failed", itemWorktree: item.worktree, integrationWorktree: worktree };
    }
    const candidateSha = await run(["rev-parse", "HEAD"], worktree);
    if (!validSha(candidateSha)) throw new Error("integration candidate did not produce a Git SHA");
    return { status: "candidate", candidateSha, worktree };
  }

  function staleResult(item, worktree, strategy, candidateSha) {
    return {
      status: "stale",
      itemWorktree: item.worktree,
      integrationWorktree: worktree,
      candidateSha,
      recovery: {
        action: "refreshStale",
        required: ["refresh-at-current-target", "root-acceptance", "independent-review", "explicit-retry"],
        item,
        strategy,
        attempt: 0,
      },
    };
  }

  function publicationIntent(item, worktree, strategy, candidateSha) {
    return {
      type: "delivery-publication-intent",
      itemId: item.itemId,
      repositoryRoot: item.repositoryRoot,
      targetBranch: item.targetBranch,
      expectedBaseSha: item.targetBaseSha,
      candidateSha,
      itemWorktree: item.worktree,
      integrationWorktree: worktree,
      strategy,
    };
  }

  function publicationFailure(item, worktree, strategy, candidateSha, intent, error) {
    return {
      status: "publication-failed",
      itemWorktree: item.worktree,
      integrationWorktree: worktree,
      candidateSha,
      recovery: {
        action: "retryPublication",
        required: ["inspect-publication-state", "explicit-retry"],
        item,
        strategy,
        publicationIntent: intent,
        ...(error ? { error: error.message } : {}),
      },
    };
  }

  async function publish(item, worktree, strategy, candidateSha) {
    const intent = publicationIntent(item, worktree, strategy, candidateSha);
    try {
      await record(intent);
    } catch (error) {
      return publicationFailure(item, worktree, strategy, candidateSha, intent, error);
    }

    try {
      await run(["update-ref", `refs/heads/${item.targetBranch}`, candidateSha, item.targetBaseSha], item.repositoryRoot);
    } catch (error) {
      let currentTargetSha;
      try {
        currentTargetSha = await run(["rev-parse", "--verify", `refs/heads/${item.targetBranch}`], item.repositoryRoot);
      } catch (readError) {
        return publicationFailure(item, worktree, strategy, candidateSha, intent, readError);
      }
      if (currentTargetSha !== item.targetBaseSha) {
        await record({ ...intent, type: "delivery-stale", targetBaseSha: item.targetBaseSha, currentTargetSha, error: error.message });
        return staleResult(item, worktree, strategy, candidateSha);
      }
      const failed = { ...intent, type: "delivery-publication-failed", error: error.message };
      try {
        await record(failed);
      } catch (recordError) {
        return publicationFailure(item, worktree, strategy, candidateSha, intent, recordError);
      }
      return publicationFailure(item, worktree, strategy, candidateSha, intent, error);
    }

    const published = { type: "delivery-published", itemId: item.itemId, targetBranch: item.targetBranch, expectedBaseSha: item.targetBaseSha, publishedSha: candidateSha, strategy };
    try {
      await record(published);
    } catch (error) {
      return {
        status: "published-but-recording-failed",
        targetBranch: item.targetBranch,
        publishedSha: candidateSha,
        recovery: {
          targetAlreadyPublished: true,
          cleanupRequired: true,
          itemWorktree: item.worktree,
          integrationWorktree: worktree,
          publicationIntent: intent,
          publicationJournalError: error.message,
        },
      };
    }
    try {
      await cleanup(item, worktree);
    } catch (error) {
      const recovery = {
        targetAlreadyPublished: true,
        cleanupRequired: true,
        itemWorktree: item.worktree,
        integrationWorktree: worktree,
        cleanupError: error.message,
      };
      try {
        await record({ ...published, type: "delivery-published-but-cleanup-failed", recovery });
      } catch (recoveryJournalError) {
        recovery.recoveryJournalError = recoveryJournalError.message;
      }
      return { status: "published-but-cleanup-failed", targetBranch: item.targetBranch, publishedSha: candidateSha, recovery };
    }
    return { status: "delivered", targetBranch: item.targetBranch, publishedSha: candidateSha };
  }

  async function deliver({ item, strategy = "merge-commit" } = {}) {
    assertItem(item);
    assertStrategy(strategy);
    const location = await paths.integration({ itemId: item.itemId, item, strategy, attempt: 0 });
    const worktree = requireString(location?.worktree, "integration worktree");
    const candidate = await createCandidate(item, strategy, worktree);
    if (candidate.status !== "candidate") return candidate;
    return publish(item, worktree, strategy, candidate.candidateSha);
  }

  async function refreshStale({ stale } = {}) {
    if (!stale || stale.status !== "stale" || !stale.recovery) throw new TypeError("stale recovery evidence is required");
    const { item: priorItem, strategy, attempt } = stale.recovery;
    assertItem(priorItem);
    assertStrategy(strategy);
    const targetBaseSha = await run(["rev-parse", "--verify", `refs/heads/${priorItem.targetBranch}`], priorItem.repositoryRoot);
    if (!validSha(targetBaseSha)) throw new Error(`Unknown target branch: ${priorItem.targetBranch}`);
    const item = { ...priorItem, targetBaseSha };
    const nextAttempt = attempt + 1;
    const location = await paths.integration({ itemId: item.itemId, item, strategy, attempt: nextAttempt });
    const worktree = requireString(location?.worktree, "integration worktree");
    const candidate = await createCandidate(item, strategy, worktree);
    if (candidate.status !== "candidate") return candidate;
    return {
      status: "refreshed",
      item,
      candidateSha: candidate.candidateSha,
      integrationWorktree: worktree,
      recovery: { action: "retryStale", required: ["fresh-independent-review", "explicit-retry"], strategy, attempt: nextAttempt },
    };
  }

  async function retryStale({ refreshed, independentReview } = {}) {
    if (!refreshed || refreshed.status !== "refreshed") throw new TypeError("refreshed stale evidence is required");
    const reviewer = independentReview?.reviewer;
    const implementer = independentReview?.implementer;
    if (
      !independentReview || independentReview.approved !== true || independentReview.fresh !== true
      || independentReview.candidateSha !== refreshed.candidateSha
      || typeof reviewer?.identity !== "string" || typeof reviewer?.context !== "string"
      || typeof implementer?.identity !== "string" || typeof implementer?.context !== "string"
      || reviewer.identity === implementer.identity || reviewer.context === implementer.context
    ) {
      throw new TypeError("fresh independent review approval for this candidate is required");
    }
    const verified = await review.verify({
      evidence: independentReview,
      candidate: {
        candidateSha: refreshed.candidateSha,
        targetBranch: refreshed.item.targetBranch,
        targetBaseSha: refreshed.item.targetBaseSha,
        itemWorktree: refreshed.item.worktree,
        integrationWorktree: refreshed.integrationWorktree,
        strategy: refreshed.recovery.strategy,
        attempt: refreshed.recovery.attempt,
      },
    });
    if (verified !== true) throw new TypeError("fresh independent review approval for this candidate is required");
    return publish(refreshed.item, refreshed.integrationWorktree, refreshed.recovery.strategy, refreshed.candidateSha);
  }

  return Object.freeze({ prepareItem, deliver, refreshStale, retryStale });
}
