---
id: wi-002
title: Add Node acceptance discovery and affected-workspace checks
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
links:
  depends_on: []
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

- [ ] Detect a single supported root Node package-manager/lockfile configuration and fail closed for ambiguity.
- [ ] Discover root-declared workspaces without filesystem guessing.
- [ ] Determine changed-path owning workspaces and reverse workspace dependents from the declared dependency graph.
- [ ] Select present scripts in fixed `check`, `build`, `test`, `lint` order for affected workspaces.
- [ ] Run root repository-wide scripts for integration candidates.
- [ ] Expose an adapter interface so non-Node conventions can become peers later.

## Deliverables

- [ ] Node acceptance-discovery adapter.
- [ ] Structured command plan/result artifact.
- [ ] Fixture-driven tests for single-package and workspace repositories.

## Acceptance Criteria

- [ ] Per-item checks include every changed workspace and all reverse dependents, but not unrelated workspaces.
- [ ] Paths outside declared workspaces and unparseable/ambiguous workspace graphs fail closed.
- [ ] Root integration checks run in the prescribed script order.
- [ ] No agent selects acceptance commands through reasoning or README interpretation.

## Dependencies

None.
