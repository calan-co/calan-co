---
id: wi-00002
title: Sandcastle Config Scaffolding and Validation
summary: Implement /work:config-raw subcommands for init, show, get, set, edit, editor, reset, and validate.
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

The command surface should organize init-style hydration, full config display, targeted get/set operations, terminal editing, editor preference, reset, and validation under one deterministic /work:config-raw command.

## Tasks

- [x] Register /work:config-raw in extensions/agent-workflows/index.ts and route show/init/get/set/edit/editor/reset/validate subcommands through one handler.
- [x] Create a config capability that reads and writes .pi/sandcastle/agents.yaml through injected filesystem/path dependencies.
- [x] Implement init idempotency so missing scaffold files are created while existing user edits are preserved unless reset/force is explicit.
- [x] Implement show/get/set/reset for supported scalar config paths with clear missing-path and unsupported-path errors.
- [x] Implement validate diagnostics for agents, prompts, pipelines, sandbox providers, model references, and missing runner files.
- [x] Add fake ExtensionAPI tests that prove command registration and observable /work:config-raw behavior without loading Pi or Sandcastle containers.

## Deliverables

- Repo-local config scaffold.
- Prompt/pipeline/agent defaults.
- Validation diagnostics.
- Tests for the config command surface.

## Acceptance Criteria

- [x] After reload, /work:config-raw is registered by the dev extension and /work:config-raw show displays effective repo config.
- [x] /work:config-raw init creates missing .pi/sandcastle scaffold files and does not overwrite existing edited files without an explicit reset/force path.
- [x] /work:config-raw get <path> returns one value, and missing/unsupported paths return clear user-facing errors.
- [x] /work:config-raw set <path> <value> persists supported scalar values and leaves unrelated YAML content intact.
- [x] /work:config-raw reset restores supported paths to repo defaults without deleting unrelated project files.
- [x] /work:config-raw validate reports invalid agents, prompts, pipelines, models, sandbox providers, and missing runner/config files through the command response.
- [x] Tests instantiate the extension through a fake ExtensionAPI and fail if /work:config-raw is not registered.

