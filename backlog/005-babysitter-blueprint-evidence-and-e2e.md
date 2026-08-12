---
id: wi-005
title: Package the Babysitter blueprint with durable evidence and end-to-end tests
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
links:
  depends_on:
    - '[[001-dv-contract-and-ready-selection]]'
    - '[[002-node-acceptance-discovery-and-affected-workspaces]]'
    - '[[003-isolated-worktrees-and-cas-integration]]'
    - '[[004-review-remediation-and-closure-transaction]]'
tags:
  - afk
  - babysitter
  - blueprint
  - evidence
  - e2e
---

## Goal

Ship the versioned Babysitter blueprint/process, repository override contract, durable evidence manifest, and end-to-end validation fixtures.

## Background

Babysitter supplies the durable journal, shell gates, and approval/process runtime. The blueprint must contain executable process code and structured artifacts rather than relying on prompt-only behavior. Repositories may supply version-compatible overrides for unique DV or policy requirements.

## Tasks

- [ ] Package the process as a versioned Babysitter blueprint with documented install/run commands.
- [ ] Implement schema-validated repository override loading and compatibility checks before worktree creation.
- [ ] Produce input, command, DV, review, diff, commit, integration, and hash evidence artifacts under the run directory.
- [ ] Verify artifact existence, schema validity, and hashes before any state transition.
- [ ] Build fixture-driven E2E coverage for success, reviewer remediation, close failure, root-check failure, stale CAS candidate, and merge conflict.
- [ ] Document stack-neutral adapter seams and the Node-first acceptance adapter limits.

## Deliverables

- [ ] Installable blueprint/process package.
- [ ] Override schema and compatibility gate.
- [ ] Evidence-manifest verifier.
- [ ] End-to-end fixtures and operator documentation.

## Acceptance Criteria

- [ ] A run journal and evidence manifest permit independent reconstruction of every decision and side effect.
- [ ] The process cannot create an item worktree when contract/override compatibility fails.
- [ ] The E2E success path closes DV only through the reviewed, workspace-local branch transaction and publishes through CAS.
- [ ] Failure fixtures prove that target branch integrity and preserved item worktrees match the delivery policy.

## Dependencies

[[001-dv-contract-and-ready-selection]]
[[002-node-acceptance-discovery-and-affected-workspaces]]
[[003-isolated-worktrees-and-cas-integration]]
[[004-review-remediation-and-closure-transaction]]
