---
id: wi-003
title: Implement isolated worktree lifecycle and CAS-protected integration
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: recoverable
priority: high
links:
  depends_on:
    - '[[001-dv-contract-and-ready-selection]]'
    - '[[002-node-acceptance-discovery-and-affected-workspaces]]'
  evidence:
    - '[[record-wi-003-git-worktree-transaction-validation]]'
tags:
  - afk
  - babysitter
  - git
  - worktree
  - concurrency
---

## Goal

Implement isolated item worktrees and temporary integration worktrees that publish only validated candidates through compare-and-swap branch updates.

## Background

Concurrent item work must never overwrite target-branch progress. Workspace commits have blanket authorization because they remain isolated. Failed or paused item worktrees must be retained; successful item worktrees are cleaned up only after delivery. Integration candidates must leave the real target unchanged until root checks pass.

## Tasks

- [x] Default target branch from invocation PWD; permit explicit override.
- [x] Create and journal isolated item worktrees with target base SHA, branch, and paths.
- [x] Support configurable `merge-commit`, `squash`, and `rebase` integration; default to merge commit.
- [x] Create temporary integration worktrees, integrate candidates, and run root checks there.
- [x] Atomically publish only when target still equals the expected base SHA.
- [x] Handle stale candidates by refreshing, rechecking, and re-reviewing; preserve conflicts and failed candidates.

## Deliverables

- [x] Git/worktree transaction module.
- [x] CAS publication evidence and recovery state.
- [x] Concurrency and merge-strategy tests.

## Acceptance Criteria

- [x] A failed merge or root check leaves the target branch unchanged.
- [x] A failed CAS update does not lose item work and produces a stale-candidate recovery state.
- [x] Merge conflicts are never auto-resolved and preserve the item workspace/evidence.
- [x] Successful delivery cleans item and temporary integration worktrees; failed or paused items remain inspectable.

## Dependencies

[[001-dv-contract-and-ready-selection]]
[[002-node-acceptance-discovery-and-affected-workspaces]]
