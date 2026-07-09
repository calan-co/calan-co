---
id: wi-00002
title: Sandcastle Config Scaffolding and Validation
summary: Implement /backlog:config-raw subcommands for init, show, get, set, edit, editor, reset, and validate.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-07-08'
links:
  reference:
    - '[[sandcastle-backlog-processing]]'
  parent:
    - '[[00001-sandcastle-backlog-processing-command-surface-prd]]'
tags:
  - afk
  - sandcastle
  - config
  - validation
---

## Goal

Implement the repo-local Sandcastle configuration command surface.

## Background

The command surface should organize init-style hydration, full config display, targeted get/set operations, terminal editing, editor preference, reset, and validation under one deterministic /backlog:config-raw command.

## Tasks

- [x] Register /backlog:config-raw in extensions/pi-sandcastle/index.ts and route show/init/get/set/edit/editor/reset/validate subcommands through one handler.
- [x] Create a config capability that reads and writes .pi/sandcastle/agents.yaml through injected filesystem/path dependencies.
- [x] Implement init idempotency so missing scaffold files are created while existing user edits are preserved unless reset/force is explicit.
- [x] Implement show/get/set/reset for supported scalar config paths with clear missing-path and unsupported-path errors.
- [x] Implement validate diagnostics for agents, prompts, pipelines, sandbox providers, model references, and missing runner files.
- [x] Add fake ExtensionAPI tests that prove command registration and observable /backlog:config-raw behavior without loading Pi or Sandcastle containers.

## Deliverables

- Repo-local config scaffold.
- Prompt/pipeline/agent defaults.
- Validation diagnostics.
- Tests for the config command surface.

## Acceptance Criteria

- [x] After reload, /backlog:config-raw is registered by the dev extension and /backlog:config-raw show displays effective repo config.
- [x] /backlog:config-raw init creates missing .pi/sandcastle scaffold files and does not overwrite existing edited files without an explicit reset/force path.
- [x] /backlog:config-raw get <path> returns one value, and missing/unsupported paths return clear user-facing errors.
- [x] /backlog:config-raw set <path> <value> persists supported scalar values and leaves unrelated YAML content intact.
- [x] /backlog:config-raw reset restores supported paths to repo defaults without deleting unrelated project files.
- [x] /backlog:config-raw validate reports invalid agents, prompts, pipelines, models, sandbox providers, and missing runner/config files through the command response.
- [x] Tests instantiate the extension through a fake ExtensionAPI and fail if /backlog:config-raw is not registered.

