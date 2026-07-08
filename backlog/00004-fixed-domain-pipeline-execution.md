---
id: wi-00004
title: Fixed-Domain Pipeline Execution
summary: Implement configured fixed-domain pipeline execution through createWorktree and worktree.run.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-07-08'
links:
  depends_on:
    - '[[00002-sandcastle-config-scaffolding-and-validation]]'
    - '[[00003-sandcastle-api-adapter-and-sc-run]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - sandcastle
  - pipeline
  - worktree
---

## Goal

Execute configured multi-step Sandcastle pipelines directly from Pi.

## Background

Pipelines are extension-level orchestration over Sandcastle primitives. They should be fixed domain options, not arbitrary inline pipeline definitions.

## Tasks

- [x] Register /sc:pipeline in extensions/pi-sandcastle/index.ts and parse <pipeline> plus optional prompt text.
- [x] Extend config loading to expose fixed pipeline definitions with ordered agent steps, branch strategy, and sandbox options.
- [x] Use injected Sandcastle createWorktree/worktree.run capability to create or reuse the configured branch/worktree.
- [x] Execute each configured pipeline step in order, passing role-specific prompts and preserving per-step logs.
- [x] Record per-step status, agent role, branch, commits, log path, and errors in durable run records.
- [x] Add behavior tests for known pipeline success, unknown pipeline errors, failed steps, and no arbitrary inline pipeline execution.

## Deliverables

- [x] /sc:pipeline command.
- [x] Pipeline run records with per-step details.
- [x] Tests for success, failure, and unknown pipeline cases.

## Acceptance Criteria

- [x] After reload, /sc:pipeline is registered by the dev extension.
- [x] /sc:pipeline validates the requested pipeline against repo config and rejects unknown names with available options.
- [x] Pipeline execution uses the injected Sandcastle worktree capability and creates/reuses the expected branch strategy.
- [x] Each pipeline step records status, agent role, log path, commits, and errors.
- [x] Arbitrary inline pipeline definitions are not accepted from the command line.
- [x] Tests cover success, unknown pipeline, and failed-step behavior without real containers.
