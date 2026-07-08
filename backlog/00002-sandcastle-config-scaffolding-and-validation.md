---
id: wi-00002
title: Sandcastle Config Scaffolding and Validation
summary: Implement /sc:config subcommands for setup, show, get, set, reset, and validate.
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

The command surface should organize setup-style hydration, full config display, targeted get/set operations, reset, and validation under one deterministic /sc:config command.

## Tasks

- [x] Register /sc:config in extensions/pi-sandcastle/index.ts and route show/setup/get/set/reset/validate subcommands through one handler.
- [x] Create a config capability that reads and writes .pi/sandcastle/agents.yaml through injected filesystem/path dependencies.
- [x] Implement setup idempotency so missing scaffold files are created while existing user edits are preserved unless reset/force is explicit.
- [x] Implement show/get/set/reset for supported scalar config paths with clear missing-path and unsupported-path errors.
- [x] Implement validate diagnostics for agents, prompts, pipelines, sandbox providers, model references, and missing runner files.
- [x] Add fake ExtensionAPI tests that prove command registration and observable /sc:config behavior without loading Pi or Sandcastle containers.

## Deliverables

- Repo-local config scaffold.
- Prompt/pipeline/agent defaults.
- Validation diagnostics.
- Tests for the config command surface.

## Acceptance Criteria

- [x] After reload, /sc:config is registered by the dev extension and /sc:config show displays effective repo config.
- [x] /sc:config setup creates missing .pi/sandcastle scaffold files and does not overwrite existing edited files without an explicit reset/force path.
- [x] /sc:config get <path> returns one value, and missing/unsupported paths return clear user-facing errors.
- [x] /sc:config set <path> <value> persists supported scalar values and leaves unrelated YAML content intact.
- [x] /sc:config reset restores supported paths to repo defaults without deleting unrelated project files.
- [x] /sc:config validate reports invalid agents, prompts, pipelines, models, sandbox providers, and missing runner/config files through the command response.
- [x] Tests instantiate the extension through a fake ExtensionAPI and fail if /sc:config is not registered.

