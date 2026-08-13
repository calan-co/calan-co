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

test("pauses and preserves the workspace when an independent reviewer is blocked", async () => {
  const calls = [];
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({
        verdict: "blocked",
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

  assert.equal(result?.status, "paused");
  assert.deepEqual(calls, []);
});

test("pauses and preserves the workspace when a finding fingerprint repeats", async () => {
  const calls = [];
  const fingerprint = "src/widget.js:17:missing-widget-id";
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({
        verdict: "changes-requested",
        findings: [
          {
            path: "src/widget.js",
            line: 17,
            message: "Handle the missing widget ID.",
            fingerprint,
          },
        ],
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
  const input = {
    item: { id: "wi-004" },
    implementer: { identity: "implementer", context: "implementation-context" },
  };

  const first = await coordinator.review(input);
  const repeated = await coordinator.review(input);

  assert.equal(first.status, "changes-requested");
  assert.equal(repeated?.status, "paused");
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

test("closes a valid independently approved git-worktree transaction item by itemId, commits tracked closure changes, then integrates", async () => {
  const calls = [];
  const item = { itemId: "wi-004", worktree: "/items/wi-004" };
  const acknowledgement = {
    schemaVersion: "task-close/v1",
    id: item.itemId,
    status: "closed",
    lifecycle: "closed",
  };
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({
        verdict: "approved",
        reviewer: { identity: "reviewer", context: "review-context" },
      }),
    },
    dv: {
      close: async ({ workId, cwd }) => {
        calls.push({ operation: "close", workId, cwd });
        return acknowledgement;
      },
    },
    workspace: {
      commitTracked: async ({ cwd }) => {
        calls.push({ operation: "commit", cwd });
        return { committed: true };
      },
    },
    integration: {
      deliver: async ({ item: deliveredItem }) => calls.push({ operation: "integration", item: deliveredItem }),
    },
  });

  await coordinator.review({
    item,
    implementer: { identity: "implementer", context: "implementation-context" },
  });

  assert.deepEqual(calls, [
    { operation: "close", workId: "wi-004", cwd: "/items/wi-004" },
    { operation: "commit", cwd: "/items/wi-004" },
    { operation: "integration", item },
  ]);
});

test("pauses without committing or integrating when a close acknowledgement names a different itemId", async () => {
  const calls = [];
  const item = { itemId: "wi-004", worktree: "/items/wi-004" };
  const coordinator = createReviewRemediationCoordinator({
    review: {
      request: async () => ({
        verdict: "approved",
        reviewer: { identity: "reviewer", context: "review-context" },
      }),
    },
    dv: {
      close: async ({ workId, cwd }) => {
        calls.push({ operation: "close", workId, cwd });
        return {
          schemaVersion: "task-close/v1",
          id: "wi-005",
          status: "closed",
          lifecycle: "closed",
        };
      },
    },
    workspace: {
      commitTracked: async () => calls.push({ operation: "commit" }),
    },
    integration: {
      deliver: async () => calls.push({ operation: "integration" }),
    },
  });

  const result = await coordinator.review({
    item,
    implementer: { identity: "implementer", context: "implementation-context" },
  });

  assert.deepEqual(result, { status: "paused" });
  assert.deepEqual(calls, [{ operation: "close", workId: "wi-004", cwd: "/items/wi-004" }]);
});

test("requires an explicit committed true result before integrating an approved closure", async () => {
  const item = { itemId: "wi-004", worktree: "/items/wi-004" };
  const implementer = { identity: "implementer", context: "implementation-context" };

  for (const commitResult of [undefined, false, {}, { committed: false }, { committed: "true" }]) {
    const calls = [];
    const coordinator = createReviewRemediationCoordinator({
      review: {
        request: async () => ({
          verdict: "approved",
          reviewer: { identity: "reviewer", context: "review-context" },
        }),
      },
      dv: {
        close: async ({ workId, cwd }) => {
          calls.push({ operation: "close", workId, cwd });
          return {
            schemaVersion: "task-close/v1",
            id: item.itemId,
            status: "closed",
            lifecycle: "closed",
          };
        },
      },
      workspace: {
        commitTracked: async ({ cwd }) => {
          calls.push({ operation: "commit", cwd });
          return commitResult;
        },
      },
      integration: {
        deliver: async () => calls.push({ operation: "integration" }),
      },
    });

    const result = await coordinator.review({ item, implementer });

    assert.deepEqual(result, { status: "paused" }, JSON.stringify(commitResult));
    assert.deepEqual(calls, [
      { operation: "close", workId: "wi-004", cwd: "/items/wi-004" },
      { operation: "commit", cwd: "/items/wi-004" },
    ], JSON.stringify(commitResult));
  }
});

test("fails closed without committing or integrating when close throws or returns an invalid acknowledgement", async () => {
  const item = { id: "wi-004", worktree: "/items/wi-004" };
  const implementer = { identity: "implementer", context: "implementation-context" };

  for (const close of [
    async () => { throw new Error("DV close failed"); },
    async () => ({ schemaVersion: "task-close/v1", id: item.id, status: "ready", lifecycle: "active" }),
  ]) {
    const calls = [];
    const coordinator = createReviewRemediationCoordinator({
      review: {
        request: async () => ({
          verdict: "approved",
          reviewer: { identity: "reviewer", context: "review-context" },
        }),
      },
      dv: {
        close: async ({ workId, cwd }) => {
          calls.push({ operation: "close", workId, cwd });
          return close();
        },
      },
      workspace: {
        commitTracked: async () => calls.push({ operation: "commit" }),
      },
      integration: {
        deliver: async () => calls.push({ operation: "integration" }),
      },
    });

    const result = await coordinator.review({ item, implementer });
    assert.deepEqual(result, { status: "paused" });
    assert.deepEqual(calls, [{ operation: "close", workId: "wi-004", cwd: "/items/wi-004" }]);
  }
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
