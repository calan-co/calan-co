---
id: wi-004
title: Add independent review, remediation, and workspace-local closure transaction
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
actual: 1
completed_date: '2026-08-13'
links:
  depends_on:
    - '[[001-dv-contract-and-ready-selection]]'
    - '[[002-node-acceptance-discovery-and-affected-workspaces]]'
    - '[[003-isolated-worktrees-and-cas-integration]]'
  evidence:
    - '[[record-wi-004-implementation-validated-and-independently-approved-after-remediation]]'
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

- [x] Define and validate reviewer verdicts: `approved`, `changes-requested`, and `blocked`.
- [x] Require reviewer identity/context distinct from the implementer.
- [x] Implement remediation cycles with configurable count, default two, plus repeated-finding/churn detection.
- [x] Re-run affected checks and use a fresh independent review after each remediation or target-branch refresh.
- [x] Run workspace-local DV close only after reviewer approval; require its tracked changes to commit successfully before integration.
- [x] Enforce protected control-file and global allowed-path policies for profile-enabled unattended authorization.

## Deliverables

- [ ] Review/remediation coordinator and structured evidence artifacts.
- [ ] Workspace-local close/commit transaction.
- [ ] Tests for verdicts, churn, refresh, and closure failure.

## Acceptance Criteria

- [x] `blocked`, churn, closure failure, or exhausted repository-configured review cycles pauses and preserves the item workspace.
- [x] `changes-requested` returns exact findings to the implementer and cannot bypass fresh checks/review.
- [x] The final item branch contains both implementation and tracked closure changes before it becomes integration-eligible.
- [x] The implementer cannot modify DV work items, policy/override files, acceptance commands, or evidence controls.

## Dependencies

[[001-dv-contract-and-ready-selection]]
[[002-node-acceptance-discovery-and-affected-workspaces]]
[[003-isolated-worktrees-and-cas-integration]]

- 2026-08-13: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
