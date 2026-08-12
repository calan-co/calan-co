---
id: wi-004
title: Add independent review, remediation, and workspace-local closure transaction
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
tags:
  - afk
  - babysitter
  - review
  - closure
---

## Goal

Implement the independent review gate and bounded remediation loop that approves an item before workspace-local Doc-Vader closure and integration.

## Background

The implementer may create isolated workspace commits under blanket authorization. An independent reviewer in a separate context must issue a structured verdict before final item closure. A closed work item may modify tracked files, so closure runs workspace-local and its commit travels with implementation changes.

## Tasks

- [ ] Define and validate reviewer verdicts: `approved`, `changes-requested`, and `blocked`.
- [ ] Require reviewer identity/context distinct from the implementer.
- [ ] Implement remediation cycles with configurable count, default two, plus repeated-finding/churn detection.
- [ ] Re-run affected checks and use a fresh independent review after each remediation or target-branch refresh.
- [ ] Run workspace-local DV close only after reviewer approval; require its tracked changes to commit successfully before integration.
- [ ] Enforce protected control-file and global allowed-path policies for profile-enabled unattended authorization.

## Deliverables

- [ ] Review/remediation coordinator and structured evidence artifacts.
- [ ] Workspace-local close/commit transaction.
- [ ] Tests for verdicts, churn, refresh, and closure failure.

## Acceptance Criteria

- [ ] `blocked`, churn, closure failure, or exhausted repository-configured review cycles pauses and preserves the item workspace.
- [ ] `changes-requested` returns exact findings to the implementer and cannot bypass fresh checks/review.
- [ ] The final item branch contains both implementation and tracked closure changes before it becomes integration-eligible.
- [ ] The implementer cannot modify DV work items, policy/override files, acceptance commands, or evidence controls.

## Dependencies

[[001-dv-contract-and-ready-selection]]
[[002-node-acceptance-discovery-and-affected-workspaces]]
[[003-isolated-worktrees-and-cas-integration]]
