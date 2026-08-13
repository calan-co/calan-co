import assert from "node:assert/strict";
import test from "node:test";

import { createReviewRemediationCoordinator } from "../src/review-remediation-coordinator.js";

test("returns a changes-requested review's exact findings without closing or integrating", async () => {
  const calls = [];
  const findings = [
    { path: "src/widget.js", line: 17, message: "Handle the missing widget ID." },
    { path: "test/widget.test.mjs", line: 42, message: "Cover the missing-ID case." },
  ];
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({ verdict: "changes-requested", findings }),
    },
    dv: {
      close: async () => calls.push("dv-close"),
    },
    integration: {
      deliver: async () => calls.push("integration"),
    },
  });

  const result = await coordinator.review({
    item: { id: "wi-004" },
    implementer: { identity: "implementer", context: "implementation-context" },
  });

  assert.deepEqual(result, { status: "changes-requested", findings });
  assert.deepEqual(calls, []);
});
