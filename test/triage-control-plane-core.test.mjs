import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TriageControlPlane } from "../extensions/triage-control-plane/src/core.ts";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ttr-core-"));
  return { dir, statePath: join(dir, "state.json") };
}

const poc = { sessionId: "poc-session-123", projectBoundary: "/repo", requesterChannel: "issue:42" };

test("POC registration persists, resolves, and needs explicit replacement confirmation", async () => {
  const { statePath } = await setup();
  const plane = new TriageControlPlane({ statePath, now: () => "2026-01-01T00:00:00.000Z" });
  const registered = await plane.registerPoc("payments", poc, false);
  assert.equal(registered.active, true);
  assert.equal((await plane.resolvePoc("payments"))?.sessionId, poc.sessionId);

  await assert.rejects(() => plane.registerPoc("payments", { sessionId: "other" }, false), /explicit replacement confirmation/i);
  await plane.registerPoc("payments", { sessionId: "other" }, true);
  assert.equal((await plane.resolvePoc("payments"))?.sessionId, "other");

  const reloaded = new TriageControlPlane({ statePath });
  assert.equal((await reloaded.resolvePoc("payments"))?.sessionId, "other");
  await reloaded.deactivatePoc("payments");
  assert.equal(await reloaded.resolvePoc("payments"), undefined);
  assert.match(await readFile(statePath, "utf8"), /payments/);
});

test("non-POC intake produces an evidence-only handoff and does not claim delivery", async () => {
  const { statePath } = await setup();
  const plane = new TriageControlPlane({ statePath });
  await plane.registerPoc("payments", poc, false);
  const intake = await plane.intake({
    reporter: "customer", source: "support", domain: "payments", symptom: "card declined", impact: "checkout blocked",
    environment: "prod", reproduction: "submit card", evidenceReferences: ["ticket:123"], currentSessionId: "other-session",
  });
  assert.equal(intake.role, "non-poc");
  assert.equal(intake.handoff?.targetSessionId, poc.sessionId);
  assert.equal(intake.handoff?.delivery, "not-attempted");
  assert.deepEqual(Object.keys(intake.handoff.payload).sort(), ["defectId", "domain", "evidenceReferences", "impact", "symptom"]);
});

test("a defect has one authoritative work item and only configured lifecycle transitions", async () => {
  const { statePath } = await setup();
  const plane = new TriageControlPlane({ statePath });
  await plane.registerPoc("payments", poc, false);
  const { defect } = await plane.intake({ reporter: "r", source: "s", domain: "payments", symptom: "x", impact: "high", environment: "prod", reproduction: "r", evidenceReferences: [], currentSessionId: poc.sessionId });
  await plane.assignWorkItem(defect.id, { id: "BUG-1", path: "backlog/BUG-1.md", status: "proposed", lifecycleStates: ["proposed", "in-progress", "closed"] });
  await assert.rejects(() => plane.assignWorkItem(defect.id, { id: "BUG-2", path: "backlog/BUG-2.md", status: "proposed", lifecycleStates: ["proposed"] }), /already has an authoritative/i);
  await assert.rejects(() => plane.transitionWorkItem(defect.id, "blocked"), /not configured/i);
  const updated = await plane.transitionWorkItem(defect.id, "in-progress", { blocker: "awaiting logs", nextAction: "request logs" });
  assert.equal(updated.workItem?.status, "in-progress");
  assert.equal(updated.blocker, "awaiting logs");
});

test("requester-message categories reject noise and record accepted message evidence", async () => {
  const { statePath } = await setup();
  const plane = new TriageControlPlane({ statePath });
  await plane.registerPoc("payments", poc, false);
  const { defect } = await plane.intake({ reporter: "r", source: "s", domain: "payments", symptom: "x", impact: "high", environment: "prod", reproduction: "r", evidenceReferences: [], currentSessionId: poc.sessionId });
  await assert.rejects(() => plane.recordRequesterMessage(defect.id, "progress-update", "still looking"), /unsupported requester-message category/i);
  const evidence = await plane.recordRequesterMessage(defect.id, "request-logs", "Please provide request id.");
  assert.equal(evidence.type, "requester-message");
  assert.equal(evidence.delivery, "not-delivered");
});

test("release gate fails closed for every missing prerequisite", async () => {
  const { statePath } = await setup();
  const plane = new TriageControlPlane({ statePath, git: async () => ({ clean: false, head: "abc" }) });
  const gate = await plane.checkReleaseGate("missing", { deploymentRequired: true });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.missing, ["authoritative-work-item", "clean-working-tree", "commit-evidence", "validation-evidence", "review-evidence", "release-artifact", "deployment-evidence", "final-work-item-update", "final-post-deployment-commit-evidence"]);
});

test("release gate accepts SHA only in linked commit evidence and safe-to-proceed needs a final post-deployment commit", async () => {
  const { statePath } = await setup();
  let head = "predeploy-sha";
  const plane = new TriageControlPlane({ statePath, git: async () => ({ clean: true, head }) });
  await plane.registerPoc("payments", poc, false);
  const { defect } = await plane.intake({ reporter: "r", source: "s", domain: "payments", symptom: "x", impact: "high", environment: "prod", reproduction: "r", evidenceReferences: [], currentSessionId: poc.sessionId });
  await plane.assignWorkItem(defect.id, { id: "BUG-1", path: "backlog/BUG-1.md", status: "in-progress", lifecycleStates: ["in-progress", "closed"] });
  await plane.recordEvidence(defect.id, { type: "validation", status: "passed", path: "evidence/test.txt" });
  await plane.recordEvidence(defect.id, { type: "review", status: "passed", path: "evidence/review.txt" });
  await plane.recordCommitEvidence(defect.id, { sha: "unphased-sha", phase: "other", path: "evidence/unphased-commit.json" });
  await assert.rejects(() => plane.recordDeploymentEvidence(defect.id, { artifact: "app@1.2.3", receipt: "deploy:42", verification: "healthy" }), /pre-deployment commit evidence/i);
  await plane.recordCommitEvidence(defect.id, { sha: "predeploy-sha", phase: "pre-deployment", path: "evidence/commit.json" });
  await plane.recordDeploymentEvidence(defect.id, { artifact: "app@1.2.3", receipt: "deploy:42", verification: "healthy" });
  let gate = await plane.checkReleaseGate(defect.id, { deploymentRequired: true });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.missing, ["final-work-item-update", "final-post-deployment-commit-evidence"]);
  await assert.rejects(() => plane.recordCommitEvidence(defect.id, { sha: "final-sha", phase: "post-deployment", path: "evidence/final-commit.json" }), /final authoritative work-item transition/i);
  await plane.transitionWorkItem(defect.id, "closed", { nextAction: "none" });
  head = "final-sha";
  await assert.rejects(() => plane.recordCommitEvidence(defect.id, { sha: "predeploy-sha", phase: "post-deployment", path: "evidence/not-a-second-commit.json" }), /distinct pre-deployment commit SHA/i);
  gate = await plane.checkReleaseGate(defect.id, { deploymentRequired: true });
  assert.deepEqual(gate.missing, ["final-post-deployment-commit-evidence"]);
  await assert.rejects(() => plane.recordRequesterMessage(defect.id, "safe-to-proceed", "safe", { deploymentRequired: true }), /release gate/i);
  await plane.recordCommitEvidence(defect.id, { sha: "final-sha", phase: "post-deployment", path: "evidence/final-commit.json" });
  gate = await plane.checkReleaseGate(defect.id, { deploymentRequired: true });
  assert.equal(gate.ok, true);
  const message = await plane.recordRequesterMessage(defect.id, "safe-to-proceed", "Safe to proceed", { deploymentRequired: true });
  assert.equal(message.type, "requester-message");
  const current = await plane.getDefect(defect.id);
  assert.equal("sha" in current.workItem, false);
});
