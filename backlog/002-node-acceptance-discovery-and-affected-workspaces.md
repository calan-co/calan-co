---
id: wi-002
title: Add Node acceptance discovery and affected-workspace checks
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
actual: 1
completed_date: '2026-08-12'
links:
  evidence:
    - '[[record-wi-002-node-acceptance-discovery-passed-validation-and-independent-review]]'
tags:
  - afk
  - babysitter
  - acceptance
  - node
  - workspaces
---

## Goal

Implement the first stack adapter: deterministic Node package-manager, script, workspace-ownership, and reverse-dependent acceptance discovery.

## Background

The delivery pack is stack-neutral. Node support is an initial adapter, not a privileged core policy. Repository-specific acceptance commands may override it. An implementation workspace should check only changed workspace owners plus reverse dependents; an integration candidate must run root repository-wide checks.

## Tasks

- [x] Detect a single supported root Node package-manager/lockfile configuration and fail closed for ambiguity.
- [x] Discover root-declared workspaces without filesystem guessing.
- [x] Determine changed-path owning workspaces and reverse workspace dependents from the declared dependency graph.
- [x] Select present scripts in fixed `check`, `build`, `test`, `lint` order for affected workspaces.
- [x] Run root repository-wide scripts for integration candidates.
- [x] Expose an adapter interface so non-Node conventions can become peers later.

## Deliverables

- [x] Node acceptance-discovery adapter.
- [x] Structured command plan/result artifact.
- [x] Fixture-driven tests for single-package and workspace repositories.

## Acceptance Criteria

- [x] Per-item checks include every changed workspace and all reverse dependents, but not unrelated workspaces.
- [x] Paths outside declared workspaces and unparseable/ambiguous workspace graphs fail closed.
- [x] Root integration checks run in the prescribed script order.
- [x] No agent selects acceptance commands through reasoning or README interpretation.

## Dependencies

None.

- 2026-08-12: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
