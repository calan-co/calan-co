---
id: wi-00007
title: Backlog Plan and Next Alias
summary: Implement /work:plan and /work:next as ephemeral planning commands.
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
    - '[[00006-readonly-backlog-list-and-inspect]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - backlog
  - planning
  - next
---

## Goal

Plan backlog processing iterations without starting work.

## Background

Planning should describe recommended processing iterations. Next should remain a thin ergonomic alias over the first planned iteration.

## Tasks

- [x] Register /work:plan and /work:next in the dev extension.
- [x] Build a planning capability over the read-only backlog capability from wi-00006.
- [x] Implement /work:plan [query] --iterations N to group ready work by dependencies, risk, and configured pipeline fit.
- [x] Implement /work:next [query] as the same planner with --iterations 1.
- [x] Return item groups, rationale, dependency notes, and recommended pipelines without durable selection state.
- [x] Add tests for query parsing, iteration limits, dependency grouping, /work:next aliasing, and read-only behavior.

## Deliverables

- Backlog planning command.
- Next alias.
- Tests for alias equivalence and read-only behavior.

## Acceptance Criteria

- [x] After reload, /work:plan and /work:next are registered.
- [x] /work:plan accepts free-form query text and --iterations N controls the number of recommended processing iterations.
- [x] /work:next uses the same implementation as /work:plan --iterations 1.
- [x] Planner output includes item groups, rationale, dependency notes, and recommended pipelines.
- [x] Planning remains ephemeral and creates no durable selection or run records.
- [x] Tests prove command parsing does not confuse query text with flags except for documented options.

