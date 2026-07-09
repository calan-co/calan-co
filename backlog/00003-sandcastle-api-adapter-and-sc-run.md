---
id: wi-00003
title: Sandcastle API Adapter and /backlog:run
summary: Create the direct Sandcastle API adapter and one-shot /backlog:run command.
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
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - sandcastle
  - api
  - run
---

## Goal

Run one configured Sandcastle-backed agent through the Sandcastle TypeScript API.

## Background

The extension should stop shelling out to a Sandcastle CLI and instead resolve configured agent roles, model/provider options, sandbox provider, prompt, branch strategy, logging, and run options into direct API calls.

## Tasks

- [x] Add a SandcastleRunCapability boundary that exposes run/createSandbox operations and is supplied to command handlers at composition time.
- [x] Register /backlog:run in extensions/pi-sandcastle/index.ts and parse optional agent plus free-form prompt text deterministically.
- [x] Resolve agent defaults, model, sandbox provider, branch strategy, environment, logging path, and prompt into Sandcastle run(...) options.
- [x] Write durable run records under .pi/sandcastle/runs with started/running/completed/failed states, timestamps, branch, commits, and log path.
- [x] Return a user-visible run summary containing run id, final status, branch, commits, and log path.
- [x] Add fake Sandcastle capability tests that prove option resolution and run-record updates without real containers or agents.

## Deliverables

- Internal Sandcastle API adapter.
- /backlog:run command.
- Run record creation/update behavior.
- Tests for option resolution and run record updates.

## Acceptance Criteria

- [x] After reload, /backlog:run is registered by the dev extension.
- [x] /backlog:run resolves the default agent when omitted and accepts free-form prompt text without treating words as flags unless explicitly declared.
- [x] /backlog:run passes resolved Sandcastle options into the injected run capability without invoking real containers or agents in tests.
- [x] /backlog:run writes a durable run record with status, agent, prompt summary, branch, commits, log path, and timestamps.
- [x] /backlog:run reports the run id, final status, branch, commits, and log path to the user.
- [x] Tests fail if the handler constructs Sandcastle dependencies inline instead of using the supplied capability.

