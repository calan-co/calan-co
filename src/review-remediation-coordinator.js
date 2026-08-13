/**
 * Coordinates independent review outcomes for an implementation work item.
 */
export function createReviewRemediationCoordinator({ review }) {
  return {
    async review({ item, implementer }) {
      const result = await review.request({ item, implementer });
      if (
        !["approved", "changes-requested", "blocked"].includes(result?.verdict) ||
        !isIndependentReviewer(result?.reviewer, implementer)
      ) {
        throw new Error("Invalid verdict or non-independent reviewer");
      }

      if (result.verdict === "changes-requested") {
        return { status: "changes-requested", findings: result.findings };
      }
    },
  };
}

function isIndependentReviewer(reviewer, implementer) {
  return (
    isNonEmptyString(reviewer?.identity) &&
    isNonEmptyString(reviewer?.context) &&
    isNonEmptyString(implementer?.identity) &&
    isNonEmptyString(implementer?.context) &&
    reviewer.identity !== implementer.identity &&
    reviewer.context !== implementer.context
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
