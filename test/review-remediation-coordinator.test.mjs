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
      request: async () => ({
        verdict: "changes-requested",
        findings,
        reviewer: { identity: "reviewer", context: "review-context" },
      }),
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

test("rejects whitespace-equivalent reviewer identity or context before prohibited calls", async () => {
  const calls = [];
  const implementer = { identity: "implementer", context: "implementation-context" };
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({
        verdict: "approved",
        reviewer: {
          identity: ` ${implementer.identity} `,
          context: `\t${implementer.context}\n`,
        },
      }),
    },
    dv: {
      close: async () => calls.push("dv-close"),
    },
    integration: {
      deliver: async () => calls.push("integration"),
    },
  });

  await assert.rejects(
    coordinator.review({ item: { id: "wi-004" }, implementer }),
    /reviewer|independent|invalid/i,
  );

  assert.deepEqual(calls, []);
});

test("fails closed without closing or integrating for non-independent or malformed reviewer verdicts", async () => {
  const calls = [];
  const implementer = { identity: "implementer", context: "implementation-context" };
  const validReviewer = { identity: "reviewer", context: "review-context" };
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async ({ item }) => item.verdict,
    },
    dv: {
      close: async () => calls.push("dv-close"),
    },
    integration: {
      deliver: async () => calls.push("integration"),
    },
  });

  for (const verdict of [
    {
      verdict: "changes-requested",
      findings: [],
      reviewer: { identity: implementer.identity, context: validReviewer.context },
    },
    {
      verdict: "changes-requested",
      findings: [],
      reviewer: { identity: validReviewer.identity, context: implementer.context },
    },
    { verdict: "changes-requested", findings: [], reviewer: { identity: validReviewer.identity } },
    { verdict: "unknown", reviewer: validReviewer },
  ]) {
    await assert.rejects(
      coordinator.review({ item: { id: "wi-004", verdict }, implementer }),
      /reviewer|independent|verdict|invalid/i,
    );
  }

  assert.deepEqual(calls, []);
});
