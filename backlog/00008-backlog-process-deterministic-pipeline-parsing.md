---
id: wi-00008
title: Backlog Process with Deterministic Pipeline Parsing
summary: Implement /backlog:process [query] --pipeline <pipeline>.
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
    - '[[00004-fixed-domain-pipeline-execution]]'
    - '[[00006-readonly-backlog-list-and-inspect]]'
    - '[[00007-backlog-plan-and-next-alias]]'
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - backlog
  - process
  - pipeline
---

## Goal

Start durable Sandcastle-backed backlog processing from a free-form query or item ID.

## Background

Process is the primary backlog execution command. Query text must never be confused with pipeline names, so pipeline selection is explicit through --pipeline or -p.

## Tasks

- [x] Register /backlog:process in the dev extension.
- [x] Implement deterministic parser where all non-flag text is query and only --pipeline/-p selects a pipeline.
- [x] Use the backlog planning capability to infer the recommended pipeline when --pipeline is omitted.
- [x] Resolve broad queries to the first recommended processing iteration and support multi-item iterations when the selected pipeline allows parallel work.
- [x] Create durable backlog run records with query, resolved items, pipeline, status, branches, logs, and timestamps.
- [x] Dispatch selected work through injected Sandcastle pipeline/run capabilities rather than constructing concrete runtimes inline.
- [x] Add behavior tests for query parsing, pipeline selection, inferred pipeline, multi-item dispatch, and run-record creation.

## Deliverables

- /backlog:process command.
- Durable backlog run records.
- Tests for parsing, inference, and multi-item processing.

## Acceptance Criteria

- [x] After reload, /backlog:process is registered.
- [x] /backlog:process review treats review as query text, not a pipeline name.
- [x] /backlog:process auth --pipeline implement uses auth as query and implement as pipeline.
- [x] If no pipeline is supplied, process uses the recommended pipeline from the first planning iteration.
- [x] Durable run records contain query, resolved items, pipeline, status, branches, logs, and timestamps.
- [x] Tests prove the command uses injected backlog and Sandcastle capabilities without real containers.

