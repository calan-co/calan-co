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
}) {
  const findingFingerprintsByItem = new Map();
  const legacyFindingFingerprintsByItem = new Map();
  const remediationCycles = validReviewCycles(maxReviewCycles);

  return {
    async review({ item, implementer }) {
      if (typeof policy?.authorize !== "function") return { status: "paused" };

      try {
        const authorized = await policy.authorize({
          item,
          changedPaths: item?.changedPaths,
          globalAllowedPaths,
        });
        if (authorized !== true) return { status: "paused" };
      } catch {
        return { status: "paused" };
      }
      if (typeof journal?.append !== "function") return { status: "paused" };

      let completedCycles = 0;
      while (true) {
        const result = await review.request({ item, implementer });
        if (
          !["approved", "changes-requested", "blocked"].includes(result?.verdict) ||
          !isIndependentReviewer(result?.reviewer, implementer)
        ) {
          throw new Error("Invalid verdict or non-independent reviewer");
        }

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
          try {
            if (await acceptance.execute({ item }) === false) return { status: "paused" };
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
        return integration.deliver({ item });
      }
    },
  };
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
    ? findings.map((finding) => normalizeString(finding?.fingerprint)).filter(Boolean)
    : [];
}

function validReviewCycles(value) {
  return Number.isInteger(value) && value >= 0 ? value : 2;
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
