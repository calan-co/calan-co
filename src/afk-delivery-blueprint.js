import path from "node:path";
import { createEvidenceJournal, verifyEvidenceManifest } from "./evidence-manifest.js";
import { loadRepositoryOverride } from "./repository-override-loader.js";

function paused(reason) { return { status: "paused", reason }; }
function guarded(port, method, transition, verify, journal, category) {
  if (!port || typeof port[method] !== "function") throw new TypeError(`${method} port is required`);
  return async (input = {}) => {
    // Intent is durable before the guard and effect; the guard then verifies
    // the action-specific manifest linkage before allowing the side effect.
    await journal.append({ category, transition, type: `${transition}:intent`, input });
    await verify(transition);
    const result = await port[method](input);
    await journal.append({ category, transition, type: `${transition}:after`, result });
    return result;
  };
}

/**
 * Stack-neutral composition root. Guarded wrappers make manifest verification
 * mandatory immediately before each coordinator and transaction side effect.
 */
export function createAfkDeliveryBlueprint({ worktreeTransaction, delivery, state, journalFactory = createEvidenceJournal, maxReviewCycles = 10 } = {}) {
  if (!worktreeTransaction || typeof worktreeTransaction.prepareItem !== "function") throw new TypeError("worktree transaction port is required");
  if (!delivery || typeof delivery.review !== "function") throw new TypeError("delivery review port is required");
  if (!state || typeof state.transition !== "function") throw new TypeError("state transition port is required");
  if (!Number.isInteger(maxReviewCycles) || maxReviewCycles !== 10) throw new TypeError("blueprint maxReviewCycles must be 10");
  return Object.freeze({
    maxReviewCycles,
    async run({ itemId, cwd, runDirectory, repositoryOverridePath, evidenceManifestPath, targetBranch, implementer } = {}) {
      if (typeof itemId !== "string" || itemId === "" || typeof cwd !== "string" || cwd === "" || typeof runDirectory !== "string" || runDirectory === "") return paused("invalid blueprint run input");
      let journal;
      try {
        await loadRepositoryOverride({ repositoryRoot: cwd, repositoryOverridePath });
        journal = await journalFactory({ runDirectory, input: { itemId, cwd, targetBranch } });
      } catch (error) { return paused(error instanceof Error ? error.message : "override or journal initialization failed"); }
      const verify = (transition) => verifyEvidenceManifest({ runDirectory: journal.runDirectory ?? runDirectory, manifestPath: evidenceManifestPath ?? path.join(journal.runDirectory ?? runDirectory, "manifest.json"), expectedTransition: transition });
      try {
        const transition = guarded(state, "transition", "state-transition", verify, journal, "command");
        const prepareItem = guarded(worktreeTransaction, "prepareItem", "prepare-item", verify, journal, "command");
        await transition({ type: "evidence-journal-created", itemId, runDirectory });
        const item = await prepareItem({ itemId, cwd, targetBranch });
        await transition({ type: "item-worktree-prepared", itemId, worktree: item.worktree });
        const outcome = await delivery.review({
          item, implementer, maxReviewCycles, verifyEvidence: verify,
          guards: Object.freeze({
            reviewRequest: (port) => guarded(port, "request", "review-request", verify, journal, "review"),
            remediate: (port) => guarded(port, "remediate", "remediate", verify, journal, "diff"),
            affectedAcceptance: (port) => guarded(port, "execute", "affected-acceptance", verify, journal, "command"),
            close: (port) => guarded(port, "close", "dv-close", verify, journal, "dv"),
            closureCommit: (port) => guarded(port, "commitTracked", "closure-commit", verify, journal, "commit"),
            integrationDeliver: (port) => guarded(port, "deliver", "integration-deliver", verify, journal, "integration"),
            integrationRefresh: (port) => typeof port?.refreshStale === "function" ? guarded(port, "refreshStale", "integration-refresh", verify, journal, "integration") : undefined,
            integrationRetry: (port) => typeof port?.retryStale === "function" ? guarded(port, "retryStale", "integration-retry", verify, journal, "integration") : undefined,
          }),
        });
        await transition({ type: "delivery-outcome", itemId, status: outcome?.status });
        return outcome;
      } catch (error) { return paused(error instanceof Error ? error.message : "delivery port failed"); }
    },
  });
}
