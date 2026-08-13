import { parseCloseResult } from "./doc-vader-contract.mjs";

/**
 * Coordinates independent review outcomes for an implementation work item.
 */
export function createReviewRemediationCoordinator({
  review,
  acceptance,
  dv,
  workspace,
  integration,
  policy,
  journal,
  globalAllowedPaths,
  maxReviewCycles = 2,
  reviewConfig,
}) {
  const findingFingerprintsByItem = new Map();
  const legacyFindingFingerprintsByItem = new Map();
  const remediationCycles = reviewConfig === undefined
    ? validReviewCycles(maxReviewCycles)
    : configuredReviewCycles(reviewConfig);

  return {
    async review({ item, implementer }) {
      if (remediationCycles === null) return { status: "paused" };
      if (!await authorizeChangedPaths({ policy, item, globalAllowedPaths, phase: "initial" })) {
        return { status: "paused" };
      }
      if (typeof journal?.append !== "function") return { status: "paused" };

      let completedCycles = 0;
      const reviewerContexts = new Set();
      while (true) {
        const result = await review.request({ item, implementer });
        if (!isValidReviewResult(result, implementer)) {
          throw new Error("Invalid verdict or non-independent reviewer");
        }
        if (result.verdict === "changes-requested" && !hasStructuredFindings(result.findings)) {
          return { status: "paused" };
        }
        if (completedCycles > 0 && reviewerContexts.has(reviewerContext(result))) {
          return { status: "paused" };
        }
        reviewerContexts.add(reviewerContext(result));

        try {
          await journal.append(reviewEvidence(item, result, completedCycles));
        } catch {
          return { status: "paused" };
        }

        if (result.verdict === "blocked") {
          return { status: "paused" };
        }

        if (result.verdict === "changes-requested") {
          if (typeof acceptance?.execute !== "function") {
            if (hasRepeatedLegacyFingerprint(item, result.findings, legacyFindingFingerprintsByItem)) {
              return { status: "paused" };
            }
            return { status: "changes-requested", findings: result.findings };
          }

          const findingFingerprints = fingerprintsFor(item, result.findings);
          if (findingFingerprints === null) return { status: "paused" };
          const key = itemKey(item);
          const persistedFingerprints = findingFingerprintsByItem.get(key) ?? new Set();
          if (
            new Set(findingFingerprints).size !== findingFingerprints.length ||
            findingFingerprints.some((fingerprint) => persistedFingerprints.has(fingerprint))
          ) {
            return { status: "paused" };
          }
          findingFingerprints.forEach((fingerprint) => persistedFingerprints.add(fingerprint));
          findingFingerprintsByItem.set(key, persistedFingerprints);

          if (completedCycles >= remediationCycles) return { status: "paused" };
          if (typeof implementer?.remediate !== "function") return { status: "paused" };
          try {
            if (await implementer.remediate({ item, findings: result.findings }) === false) {
              return { status: "paused" };
            }
            if (!await authorizeChangedPaths({ policy, item, globalAllowedPaths, phase: "post-remediation" })) {
              return { status: "paused" };
            }
            if (!isPassedAcceptance(await acceptance.execute({ item }))) return { status: "paused" };
          } catch {
            return { status: "paused" };
          }
          completedCycles += 1;
          continue;
        }

        const transactionId = item?.itemId;
        if (typeof transactionId !== "string" || transactionId.trim() === "") return { status: "paused" };

        try {
          const acknowledgement = parseCloseResult(await dv.close({ workId: transactionId, cwd: item.worktree }));
          if (acknowledgement.id !== transactionId) return { status: "paused" };
          if (!isCommitted(await workspace.commitTracked({ cwd: item.worktree }))) return { status: "paused" };
        } catch {
          return { status: "paused" };
        }
        const delivery = await integration.deliver({ item });
        if (delivery?.status !== "stale") return delivery;
        return recoverStaleDelivery({
          stale: delivery,
          item,
          implementer,
          review,
          acceptance,
          integration,
          journal,
          cycle: completedCycles + 1,
          reviewerContexts,
        });
      }
    },
  };
}

async function recoverStaleDelivery({
  stale,
  item,
  implementer,
  review,
  acceptance,
  integration,
  journal,
  cycle,
  reviewerContexts,
}) {
  if (
    typeof integration?.refreshStale !== "function" ||
    typeof integration?.retryStale !== "function" ||
    typeof acceptance?.execute !== "function"
  ) {
    return { status: "paused" };
  }

  try {
    const refreshed = await integration.refreshStale({ stale });
    if (!isRefreshedStaleCandidate(refreshed)) return { status: "paused" };
    if (!isPassedAcceptance(await acceptance.execute({ item, candidate: refreshed }))) {
      return { status: "paused" };
    }

    const result = await review.request({ item, implementer, candidate: refreshed });
    if (
      !isValidReviewResult(result, implementer) ||
      result.verdict !== "approved" ||
      reviewerContexts.has(reviewerContext(result))
    ) {
      return { status: "paused" };
    }
    reviewerContexts.add(reviewerContext(result));
    if (typeof journal?.append !== "function") return { status: "paused" };
    await journal.append(reviewEvidence(item, result, cycle));

    return await integration.retryStale({
      refreshed,
      independentReview: {
        approved: true,
        fresh: true,
        candidateSha: refreshed.candidateSha,
        reviewer: result.reviewer,
        implementer,
      },
    });
  } catch {
    return { status: "paused" };
  }
}

function reviewEvidence(item, result, cycle) {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  return {
    type: "review-evidence",
    itemId: itemKey(item),
    verdict: result.verdict,
    reviewer: result.reviewer,
    findings,
    findingFingerprints: findings.map((finding) => canonicalFingerprint(finding)),
    cycle,
  };
}

function hasRepeatedLegacyFingerprint(item, findings, fingerprintsByItem) {
  const fingerprints = legacyFingerprintsFor(findings);
  if (fingerprints.length === 0) return false;
  const key = legacyItemKey(item);
  if (key === null) return true;
  const persistedFingerprints = fingerprintsByItem.get(key) ?? new Set();
  if (fingerprints.some((fingerprint) => persistedFingerprints.has(fingerprint))) return true;
  fingerprints.forEach((fingerprint) => persistedFingerprints.add(fingerprint));
  fingerprintsByItem.set(key, persistedFingerprints);
  return false;
}

function legacyFingerprintsFor(findings) {
  return Array.isArray(findings)
    ? findings.map(canonicalFingerprint).filter(Boolean)
    : [];
}

function validReviewCycles(value) {
  return Number.isInteger(value) && value >= 0 ? value : 2;
}

function configuredReviewCycles(config) {
  return (
    config !== null &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    Object.hasOwn(config, "maxCycles") &&
    Number.isInteger(config.maxCycles) &&
    config.maxCycles > 0
  )
    ? config.maxCycles
    : null;
}

function itemKey(item) {
  const itemId = normalizeString(item?.itemId);
  return itemId === "" ? null : itemId;
}

function legacyItemKey(item) {
  const itemId = itemKey(item) ?? normalizeString(item?.id);
  return itemId === "" ? null : itemId;
}

function fingerprintsFor(item, findings) {
  if (itemKey(item) === null || !Array.isArray(findings)) return null;
  const fingerprints = findings.map(canonicalFingerprint);
  return fingerprints.some((fingerprint) => fingerprint === "") ? null : fingerprints;
}

function canonicalFingerprint(finding) {
  const path = normalizeString(finding?.path);
  const line = finding?.line;
  const message = normalizeString(finding?.message);
  if (path === "" || !Number.isInteger(line) || line < 1 || message === "") return "";
  return `${path}:${line}:${message}`;
}

function isValidReviewResult(result, implementer) {
  return (
    ["approved", "changes-requested", "blocked"].includes(result?.verdict) &&
    isIndependentReviewer(result?.reviewer, implementer)
  );
}

async function authorizeChangedPaths({ policy, item, globalAllowedPaths, phase }) {
  if (typeof policy?.changedPaths !== "function" || typeof policy.authorize !== "function") {
    return false;
  }

  try {
    const changedPaths = await policy.changedPaths({ item });
    if (!areRepositoryRelativePaths(changedPaths)) return false;
    return await policy.authorize({ item, changedPaths, globalAllowedPaths, phase }) === true;
  } catch {
    return false;
  }
}

function areRepositoryRelativePaths(paths) {
  return Array.isArray(paths) && paths.length > 0 && paths.every(isRepositoryRelativePath);
}

function isRepositoryRelativePath(path) {
  if (typeof path !== "string" || path.trim() === "") return false;
  if (/^(?:[\\/]|[A-Za-z]:)/.test(path) || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function hasStructuredFindings(findings) {
  return Array.isArray(findings) && findings.length > 0 && findings.every((finding) => canonicalFingerprint(finding) !== "");
}

function reviewerContext(result) {
  return normalizeString(result?.reviewer?.context);
}

function isIndependentReviewer(reviewer, implementer) {
  const reviewerIdentity = normalizeString(reviewer?.identity);
  const reviewerContext = normalizeString(reviewer?.context);
  const implementerIdentity = normalizeString(implementer?.identity);
  const implementerContext = normalizeString(implementer?.context);

  return (
    reviewerIdentity !== "" &&
    reviewerContext !== "" &&
    implementerIdentity !== "" &&
    implementerContext !== "" &&
    reviewerIdentity !== implementerIdentity &&
    reviewerContext !== implementerContext
  );
}

function isRefreshedStaleCandidate(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    candidate.status === "refreshed" &&
    normalizeString(candidate.candidateSha) !== ""
  );
}

function isPassedAcceptance(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.hasOwn(result, "passed") &&
    result.passed === true &&
    Reflect.ownKeys(result).length === 1
  );
}

function isCommitted(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.hasOwn(result, "committed") &&
    result.committed === true &&
    Reflect.ownKeys(result).length === 1
  );
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}
