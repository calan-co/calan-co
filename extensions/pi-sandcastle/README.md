# Pi Sandcastle extension

Project-local Pi extension that exposes a Pi-native `/backlog:*` command surface backed by a deterministic ExecutionRuntime. Sandcastle is now a background adapter for sandboxed agent execution, not a user-facing command namespace.

## Install/runtime prerequisites

```bash
npm install --save-dev @ai-hero/sandcastle
```

Then reload Pi from this repo with `/reload`.

## Backlog execution commands

- `/backlog:config` — friendly BIOS-style TUI for runtime configuration.
- `/backlog:config-raw show|init|get|set|edit|editor|reset|validate` — advanced config utility actions.
- `/backlog:build-image [docker|podman]` — build the repo execution sandbox image.
- `/backlog:run [agent] <prompt>` — run one configured execution agent directly.
- `/backlog:pipeline <pipeline> [prompt]` — run a fixed runtime pipeline.
- `/backlog:list [query]` — list backlog items without mutation.
- `/backlog:inspect <item-id>` — inspect one backlog item without mutation.
- `/backlog:plan [query] --iterations N` — plan read-only backlog iterations.
- `/backlog:next [query]` — plan the next backlog iteration.
- `/backlog:process [query] --pipeline <pipeline>` — start durable backlog processing through the ExecutionRuntime adapter boundary.
- `/backlog:runs [query]` — list backlog processing runs.
- `/backlog:status [run-id]` — inspect a backlog processing run.
- `/backlog:logs [run-id]` — show recorded log paths for a backlog processing run.
- `/backlog:cancel [run-id]` — reserved backlog cancellation utility.
- `/backlog:resume [run-id]` — resume a resumable backlog processing run.

## Runtime packs

The default runtime pack is `extensions/pi-sandcastle/runtime-packs/sandcastle-templates.json`. It ports the current Sandcastle template concepts into explicit Pi-Sandcastle runtime data:

- prompts
- agents
- pipelines
- step modules
- providers
- issue trackers
- policies
- adapter metadata

The schema is `extensions/pi-sandcastle/schema/execution-runtime.schema.json`.

## LLM tool

`delegate_agent({ agent, task })` lets the primary Pi agent delegate self-contained tasks to configured agents without exposing legacy slash-command aliases.

## Config and artifacts

Edit `.pi/sandcastle/config.yaml` for local overrides. Runtime inventory is compiled from the default ExecutionRuntime pack and can be overridden by repo config.

Run artifacts are written under `.pi/sandcastle/results/`, `.pi/sandcastle/jobs/`, `.pi/sandcastle/runs/`, `.pi/sandcastle/pipeline-runs/`, and `.pi/sandcastle/backlog-runs/`.
