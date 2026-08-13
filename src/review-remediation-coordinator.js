/**
 * Coordinates independent review outcomes for an implementation work item.
 */
export function createReviewRemediationCoordinator({ review }) {
  const findingFingerprints = new Set();

  return {
    async review({ item, implementer }) {
      const result = await review.request({ item, implementer });
      if (
        !["approved", "changes-requested", "blocked"].includes(result?.verdict) ||
        !isIndependentReviewer(result?.reviewer, implementer)
      ) {
        throw new Error("Invalid verdict or non-independent reviewer");
      }

      if (result.verdict === "blocked") {
        return { status: "paused" };
      }

      if (result.verdict === "changes-requested") {
        const fingerprints = result.findings
          .map((finding) => normalizeString(finding?.fingerprint))
          .filter(Boolean);
        if (fingerprints.some((fingerprint) => findingFingerprints.has(fingerprint))) {
          return { status: "paused" };
        }
        fingerprints.forEach((fingerprint) => findingFingerprints.add(fingerprint));
        return { status: "changes-requested", findings: result.findings };
      }
    },
  };
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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}
