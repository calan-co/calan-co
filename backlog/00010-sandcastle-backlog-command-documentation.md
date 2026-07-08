---
id: wi-00010
title: Sandcastle Backlog Command Documentation
summary: Document the Sandcastle and backlog command model.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 3
completed_date: '2026-07-08'
links:
  depends_on:
    - '[[00002-sandcastle-config-scaffolding-and-validation]]'
    - '[[00003-sandcastle-api-adapter-and-sc-run]]'
    - '[[00004-fixed-domain-pipeline-execution]]'
    - '[[00005-sandcastle-run-management-commands]]'
    - '[[00006-readonly-backlog-list-and-inspect]]'
    - '[[00007-backlog-plan-and-next-alias]]'
    - '[[00008-backlog-process-deterministic-pipeline-parsing]]'
    - '[[00009-backlog-run-management-commands]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - documentation
  - sandcastle
  - backlog
---

## Goal

Document the final command surface and conceptual model for users and future implementers.

## Background

The documentation should make the deterministic parsing rules, read-only versus durable command split, config semantics, and PR boundary explicit.

## Tasks

- [x] Document the implemented /sc:config, /sc:run, /sc:pipeline, and /sc run-management commands with examples tied to the actual extension behavior.
- [x] Document /backlog:list, /backlog:inspect, /backlog:plan, /backlog:next, /backlog:process, and backlog run-management commands.
- [x] Document deterministic parsing rules, especially that --pipeline/-p is the only pipeline selector.
- [x] Document read-only versus durable commands and where run records/logs are stored.
- [x] Document setup, validation, troubleshooting, and the boundary that PR lifecycle commands are future /pr:* work.
- [x] Add documentation tests or link checks that fail when documented commands are not registered by the extension.

## Deliverables

- User/developer documentation.
- Examples for common commands.
- Out-of-scope PR boundary note.

## Acceptance Criteria

- [x] Docs list every registered /sc:* and /backlog:* command with one working example each.
- [x] Docs explain read-only versus durable commands and state that durable state starts at process/resume or direct Sandcastle runs.
- [x] Docs explain deterministic parsing rules and show --pipeline/-p examples.
- [x] Docs identify run record and log locations used by the implementation.
- [x] Docs reserve PR lifecycle commands for a future /pr:* namespace.
- [x] Documentation tests or command-registration checks fail if docs mention a command the extension does not register.
