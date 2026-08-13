import path from "node:path";
import { verifyEvidenceManifest } from "./evidence-manifest.js";
import { loadRepositoryOverride } from "./repository-override-loader.js";

function paused(reason) { return { status: "paused", reason }; }

/**
 * Stack-neutral composition root. All side effects beyond its filesystem gates
 * are injected ports; this preserves the existing transaction/review policy.
 */
export function createAfkDeliveryBlueprint({ worktreeTransaction, delivery, state } = {}) {
  if (!worktreeTransaction || typeof worktreeTransaction.prepareItem !== "function") throw new TypeError("worktree transaction port is required");
  if (!delivery || typeof delivery.review !== "function") throw new TypeError("delivery review port is required");
  if (!state || typeof state.transition !== "function") throw new TypeError("state transition port is required");
  return Object.freeze({
    async run({ itemId, cwd, runDirectory, repositoryOverridePath, evidenceManifestPath, targetBranch } = {}) {
      if (typeof itemId !== "string" || itemId === "" || typeof cwd !== "string" || cwd === "" || typeof runDirectory !== "string" || runDirectory === "") return paused("invalid blueprint run input");
      const verify = () => verifyEvidenceManifest({ runDirectory, manifestPath: evidenceManifestPath ?? path.join(runDirectory, "manifest.json") });
      try {
        await loadRepositoryOverride({ repositoryRoot: cwd, repositoryOverridePath });
        await verify();
      } catch (error) {
        return paused(error instanceof Error ? error.message : "override or evidence validation failed");
      }
      try {
        await verify();
        await state.transition({ type: "evidence-verified", itemId, runDirectory });
        await verify();
        const item = await worktreeTransaction.prepareItem({ itemId, cwd, targetBranch });
        await verify();
        await state.transition({ type: "item-worktree-prepared", itemId, worktree: item.worktree });
        // The coordinator receives the same guard for its closure/remediation/integration ports.
        await verify();
        const outcome = await delivery.review({ item, verifyEvidence: verify });
        await verify();
        await state.transition({ type: "delivery-outcome", itemId, status: outcome?.status });
        return outcome;
      } catch (error) {
        return paused(error instanceof Error ? error.message : "delivery port failed");
      }
    },
  });
}
