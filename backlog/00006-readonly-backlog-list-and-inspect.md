---
id: wi-00006
title: Read-only Backlog List and Inspect
summary: Implement ephemeral /backlog:list and /backlog:inspect commands.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 4
completed_date: '2026-07-08'
links:
  depends_on:
    - '[[00002-sandcastle-config-scaffolding-and-validation]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - backlog
  - readonly
  - inspect
---

## Goal

Expose backlog discovery and item inspection without creating durable execution state.

## Background

The backlog read commands should help users and agents understand candidate work while avoiding persistent selection state and retention complexity.

## Tasks

- [x] Register /backlog:list and /backlog:inspect in the dev extension.
- [x] Create a backlog capability that reads configured backlog sources through injected filesystem/path dependencies.
- [x] Implement /backlog:list [query] with deterministic filtering, sorting, and missing-source diagnostics.
- [x] Implement /backlog:inspect <item> to resolve by id, numeric id, title slug, or file path.
- [x] Return inspection output with summary, dependency state, risks, relevant files, testing notes, and recommended pipeline without writing durable records.
- [x] Add behavior tests proving both commands are read-only and handle missing-source/missing-item cases.

## Deliverables

- Backlog list command.
- Backlog inspect command.
- Tests proving read-only behavior.

## Acceptance Criteria

- [x] After reload, /backlog:list and /backlog:inspect are registered.
- [x] /backlog:list [query] returns matching backlog items in deterministic order and reports a clear missing-source error when no backlog source is configured.
- [x] /backlog:inspect <item> returns analysis, risks, relevant files, testing notes, and recommended pipeline for a resolvable item.
- [x] /backlog:inspect <item> reports a clear missing-item error when the target cannot be resolved.
- [x] Neither command creates or modifies run records, selection records, claims, or backlog markdown.
- [x] Tests use a fake backlog filesystem and fail if the command writes state.
