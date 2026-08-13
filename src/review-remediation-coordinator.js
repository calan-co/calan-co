/**
 * Coordinates independent review outcomes for an implementation work item.
 */
export function createReviewRemediationCoordinator({ review }) {
  return {
    async review({ item, implementer }) {
      const result = await review.request({ item, implementer });
      if (result.verdict === "changes-requested") {
        return { status: "changes-requested", findings: result.findings };
      }
    },
  };
}
