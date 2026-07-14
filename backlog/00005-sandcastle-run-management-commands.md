---
id: wi-00005
title: Sandcastle Run Management Commands
summary: Implement /work:runs, /work:status, /work:logs, /work:cancel, and /work:resume.
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
    - '[[00003-sandcastle-api-adapter-and-sc-run]]'
    - '[[00004-fixed-domain-pipeline-execution]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - sandcastle
  - runs
  - resume
---

## Goal

Manage Sandcastle-backed run records and active executions from Pi.

## Background

Users need deterministic ways to inspect, cancel, and resume Sandcastle work without remembering internal process details.

## Tasks

- [x] Register /work:runs, /work:status, /work:logs, /work:cancel, and /work:resume in the dev extension.
- [x] Implement a run-store capability for reading/writing .pi/sandcastle run records and supplying active process metadata.
- [x] Implement /work:runs filtering and ordering for current repo run history.
- [x] Implement /work:status active/latest inference with clear ambiguity and missing-run errors.
- [x] Implement /work:logs to return associated log paths and readable missing-log diagnostics.
- [x] Implement /work:cancel through injected active-run controllers and update run records deterministically.
- [x] Implement /work:resume only when run metadata and provider session capture support it; otherwise return a clear unsupported message.
- [x] Add fake run-store and active-run tests for list/status/logs/cancel/resume behavior.

## Deliverables

- Run management commands.
- Inference and ambiguity behavior.
- Cancellation/resume tests.

## Acceptance Criteria

- [x] After reload, /work:runs, /work:status, /work:logs, /work:cancel, and /work:resume are registered.
- [x] /work:runs lists recent runs for the current repo from durable run records.
- [x] /work:status infers active/latest run when no id is provided and reports ambiguity instead of guessing when multiple candidates exist.
- [x] /work:logs returns associated log paths for the selected run and clear errors for missing run/log records.
- [x] /work:cancel aborts active run(s) through injected controllers and updates durable run records.
- [x] /work:resume resumes only when metadata and provider support make resume possible, and otherwise returns a deterministic unsupported message.

