---
id: wi-00009
title: Backlog Run Management Commands
summary: Implement backlog-specific runs, status, and resume commands.
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
    - '[[00008-backlog-process-deterministic-pipeline-parsing]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - backlog
  - runs
  - resume
---

## Goal

Manage durable backlog processing runs from the backlog namespace.

## Background

Backlog run commands should be backlog-specific views over durable Sandcastle processing records with inference for current/latest runs.

## Tasks

- [x] Register /backlog:runs, /backlog:status, and /backlog:resume in the dev extension.
- [x] Implement backlog-run store queries over durable backlog process records.
- [x] Implement /backlog:runs [query] to filter and list backlog processing runs.
- [x] Implement /backlog:status [run-id] with active/latest inference and ambiguity handling.
- [x] Implement /backlog:resume <run-id> to continue only resumable backlog process runs through injected Sandcastle capabilities.
- [x] Add tests for filtering, status inference, resume eligibility, missing-run errors, and non-resumable runs.

## Deliverables

- Backlog run listing.
- Backlog status view.
- Backlog resume behavior.
- Tests for inference and ambiguity.

## Acceptance Criteria

- [x] After reload, /backlog:runs, /backlog:status, and /backlog:resume are registered.
- [x] /backlog:runs lists backlog process runs and supports deterministic filtering by query text or item id.
- [x] /backlog:status infers active/latest backlog run when safe and reports ambiguity when multiple candidates exist.
- [x] /backlog:resume resumes only durable process runs with resumable provider/session metadata.
- [x] Missing or non-resumable runs return clear user-facing errors without mutating records.
- [x] Tests cover run-store behavior with no real Sandcastle containers.

