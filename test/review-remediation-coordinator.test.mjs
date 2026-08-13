import assert from "node:assert/strict";
import test from "node:test";

import { createReviewRemediationCoordinator } from "../src/review-remediation-coordinator.js";

function successfulReviewPorts() {
  return {
    policy: { authorize: async () => true },
    journal: { append: async () => {} },
  };
}

test("returns a changes-requested review's exact findings without closing or integrating", async () => {
  const calls = [];
  const findings = [
    { path: "src/widget.js", line: 17, message: "Handle the missing widget ID." },
    { path: "test/widget.test.mjs", line: 42, message: "Cover the missing-ID case." },
  ];
  const coordinator = createReviewRemediationCoordinator({
    ...successfulReviewPorts(),
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
    ...successfulReviewPorts(),
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
    ...successfulReviewPorts(),
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
    ...successfulReviewPorts(),
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
    ...successfulReviewPorts(),
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
    ...successfulReviewPorts(),
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
      ...successfulReviewPorts(),
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
  const item = { itemId: "wi-004", worktree: "/items/wi-004" };
  const implementer = { identity: "implementer", context: "implementation-context" };

  for (const close of [
    async () => { throw new Error("DV close failed"); },
    async () => ({ schemaVersion: "task-close/v1", id: item.itemId, status: "ready", lifecycle: "active" }),
  ]) {
    const calls = [];
    const coordinator = createReviewRemediationCoordinator({
      ...successfulReviewPorts(),
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

test("remediates changes-requested findings before each fresh review, uses two default cycles, and pauses only repeated canonical findings for the same item", async () => {
  const calls = [];
  const finding = { path: "src/widget.js", line: 17, message: "Handle the missing widget ID." };
  const resultsByItem = new Map([
    ["wi-004", [
      { verdict: "changes-requested", findings: [finding] },
      { verdict: "changes-requested", findings: [{ ...finding }] },
    ]],
    ["wi-005", [
      { verdict: "changes-requested", findings: [finding] },
      { verdict: "changes-requested", findings: [{ path: "src/widget.js", line: 18, message: "Handle the missing widget ID." }] },
      { verdict: "changes-requested", findings: [{ path: "src/widget.js", line: 19, message: "Handle the missing widget ID." }] },
    ]],
  ]);
  const coordinator = createReviewRemediationCoordinator({
    ...successfulReviewPorts(),
    review: {
      request: async ({ item }) => {
        calls.push(`review:${item.itemId}`);
        return {
          ...resultsByItem.get(item.itemId).shift(),
          reviewer: { identity: "reviewer", context: "review-context" },
        };
      },
    },
    acceptance: {
      execute: async ({ item }) => calls.push(`acceptance:${item.itemId}`),
    },
    dv: { close: async () => calls.push("dv-close") },
    workspace: { commitTracked: async () => calls.push("commit") },
    integration: { deliver: async () => calls.push("integration") },
  });
  const implementer = { identity: "implementer", context: "implementation-context" };

  assert.deepEqual(
    await coordinator.review({ item: { itemId: "wi-004" }, implementer }),
    { status: "paused" },
  );
  assert.deepEqual(
    await coordinator.review({ item: { itemId: "wi-005" }, implementer }),
    { status: "paused" },
  );
  assert.deepEqual(calls, [
    "review:wi-004",
    "acceptance:wi-004",
    "review:wi-004",
    "review:wi-005",
    "acceptance:wi-005",
    "review:wi-005",
    "acceptance:wi-005",
    "review:wi-005",
  ]);
});

test("delivers exact changes-requested findings to implementer remediation before affected acceptance and a fresh reviewer context", async () => {
  const calls = [];
  const item = { itemId: "wi-004" };
  const findings = [
    { path: "src/widget.js", line: 17, message: "Handle the missing widget ID." },
    { path: "test/widget.test.mjs", line: 42, message: "Cover the missing-ID case." },
  ];
  const reviewResults = [
    {
      verdict: "changes-requested",
      findings,
      reviewer: { identity: "reviewer", context: "initial-review-context" },
    },
    {
      verdict: "blocked",
      reviewer: { identity: "reviewer", context: "fresh-review-context" },
    },
  ];
  const remediationCalls = [];
  const coordinator = createReviewRemediationCoordinator({
    ...successfulReviewPorts(),
    review: {
      request: async () => {
        const result = reviewResults.shift();
        calls.push(`review:${result.reviewer.context}`);
        return result;
      },
    },
    acceptance: {
      execute: async () => {
        calls.push("acceptance");
        return { passed: true };
      },
    },
  });
  const implementer = {
    identity: "implementer",
    context: "implementation-context",
    remediate: async (request) => {
      remediationCalls.push(request);
      calls.push("remediate");
    },
  };

  assert.deepEqual(await coordinator.review({ item, implementer }), { status: "paused" });
  assert.deepEqual(remediationCalls, [{ item, findings }]);
  assert.strictEqual(remediationCalls[0].findings, findings);
  assert.deepEqual(calls, [
    "review:initial-review-context",
    "remediate",
    "acceptance",
    "review:fresh-review-context",
  ]);
});

test("pauses before fresh review, closure, or integration unless acceptance returns exactly passed true", async () => {
  const item = { itemId: "wi-004", worktree: "/items/wi-004" };
  const findings = [{ path: "src/widget.js", line: 17, message: "Handle the missing widget ID." }];
  const implementer = {
    identity: "implementer",
    context: "implementation-context",
    remediate: async () => {},
  };

  for (const acceptanceResult of [
    undefined,
    null,
    false,
    true,
    {},
    { passed: false },
    { passed: true, unexpected: true },
  ]) {
    const calls = [];
    const coordinator = createReviewRemediationCoordinator({
      ...successfulReviewPorts(),
      review: {
        request: async () => {
          calls.push("review");
          return {
            verdict: "changes-requested",
            findings,
            reviewer: { identity: "reviewer", context: "review-context" },
          };
        },
      },
      acceptance: {
        execute: async () => {
          calls.push("acceptance");
          return acceptanceResult;
        },
      },
      dv: { close: async () => calls.push("close") },
      workspace: { commitTracked: async () => calls.push("commit") },
      integration: { deliver: async () => calls.push("integration") },
    });

    assert.deepEqual(
      await coordinator.review({ item, implementer }),
      { status: "paused" },
      JSON.stringify(acceptanceResult),
    );
    assert.deepEqual(calls, ["review", "acceptance"], JSON.stringify(acceptanceResult));
  }
});

test("uses injected policy authorization to deny protected and non-global changed paths before review, close, or integration", async () => {
  const protectedPaths = [
    "backlog/004-review-remediation-and-closure-transaction.md",
    "policy/unattended-authorization.json",
    "overrides/repository-doc-vader.json",
    "config/acceptance-commands.json",
    "evidence/controls.json",
    "scripts/not-globally-allowed.js",
  ];
  const globalAllowedPaths = ["src/**", "test/**"];
  const implementer = { identity: "implementer", context: "implementation-context" };

  for (const changedPath of protectedPaths) {
    const calls = [];
    const item = { itemId: "wi-004", changedPaths: [changedPath] };
    const coordinator = createReviewRemediationCoordinator({
      policy: {
        authorize: async (authorization) => {
          calls.push({ operation: "authorize", authorization });
          return authorization.changedPaths.every((path) =>
            globalAllowedPaths.some((pattern) => path.startsWith(pattern.slice(0, -2))),
          );
        },
      },
      globalAllowedPaths,
      review: {
        request: async () => {
          calls.push({ operation: "review" });
          return {
            verdict: "blocked",
            reviewer: { identity: "reviewer", context: "review-context" },
          };
        },
      },
      dv: { close: async () => calls.push({ operation: "close" }) },
      integration: { deliver: async () => calls.push({ operation: "integration" }) },
    });

    assert.deepEqual(await coordinator.review({ item, implementer }), { status: "paused" }, changedPath);
    assert.deepEqual(calls, [{
      operation: "authorize",
      authorization: { item, changedPaths: [changedPath], globalAllowedPaths },
    }], changedPath);
  }
});

test("authorizes configured global paths and journals canonical review evidence before remediation or closure transitions", async () => {
  const calls = [];
  const item = {
    itemId: "wi-004",
    worktree: "/items/wi-004",
    changedPaths: ["src/widget.js", "test/widget.test.mjs"],
  };
  const implementer = { identity: "implementer", context: "implementation-context" };
  const reviewer = { identity: "reviewer", context: "review-context" };
  const finding = { path: "src/widget.js", line: 17, message: "Handle the missing widget ID." };
  const reviewResults = [
    { verdict: "changes-requested", findings: [finding], reviewer },
    { verdict: "approved", findings: [], reviewer },
  ];
  const coordinator = createReviewRemediationCoordinator({
    policy: {
      authorize: async (authorization) => {
        calls.push({ operation: "authorize", authorization });
        return authorization.changedPaths.every((path) =>
          authorization.globalAllowedPaths.some((pattern) => path.startsWith(pattern.slice(0, -2))),
        );
      },
    },
    globalAllowedPaths: ["src/**", "test/**"],
    journal: {
      append: async (event) => calls.push({ operation: "journal", event }),
    },
    review: {
      request: async () => {
        calls.push({ operation: "review" });
        return reviewResults.shift();
      },
    },
    acceptance: { execute: async () => calls.push({ operation: "acceptance" }) },
    dv: {
      close: async () => {
        calls.push({ operation: "close" });
        return { schemaVersion: "task-close/v1", id: item.itemId, status: "closed", lifecycle: "closed" };
      },
    },
    workspace: { commitTracked: async () => { calls.push({ operation: "commit" }); return { committed: true }; } },
    integration: { deliver: async () => calls.push({ operation: "integration" }) },
  });

  await coordinator.review({ item, implementer });

  assert.deepEqual(calls, [
    {
      operation: "authorize",
      authorization: {
        item,
        changedPaths: item.changedPaths,
        globalAllowedPaths: ["src/**", "test/**"],
      },
    },
    { operation: "review" },
    {
      operation: "journal",
      event: {
        type: "review-evidence",
        itemId: "wi-004",
        verdict: "changes-requested",
        reviewer,
        findings: [finding],
        findingFingerprints: ["src/widget.js:17:Handle the missing widget ID."],
        cycle: 0,
      },
    },
    { operation: "acceptance" },
    { operation: "review" },
    {
      operation: "journal",
      event: {
        type: "review-evidence",
        itemId: "wi-004",
        verdict: "approved",
        reviewer,
        findings: [],
        findingFingerprints: [],
        cycle: 1,
      },
    },
    { operation: "close" },
    { operation: "commit" },
    { operation: "integration" },
  ]);
});

test("fails closed without closing or integrating for non-independent or malformed reviewer verdicts", async () => {
  const calls = [];
  const implementer = { identity: "implementer", context: "implementation-context" };
  const validReviewer = { identity: "reviewer", context: "review-context" };
  const coordinator = createReviewRemediationCoordinator({
    ...successfulReviewPorts(),
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
