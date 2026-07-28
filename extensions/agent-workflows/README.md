# Agent Workflows extension

Project-local Pi extension that exposes a Pi-hosted `/work:*` command surface backed by the Agent Workflows runtime model. The core runtime language is intentionally portable: Pi is the host integration layer, and Sandcastle is an execution adapter for sandboxed agent execution rather than the product model.

## Install/runtime prerequisites

```bash
npm install --save-dev @ai-hero/sandcastle
```

Then reload Pi from this repo with `/reload`.

## Work commands

- `/work:config [show|init|get|set|edit|editor|reset|validate]` — friendly BIOS-style TUI with canonical config utility subcommands.
- `/work:config-raw show|init|get|set|edit|editor|reset|validate` — deprecated compatibility alias for config utility actions.
- `/work:build-image [docker|podman]` — build the repo execution sandbox image.
- `/work:run [role] <prompt>` — run one configured Role directly.
- `/work:pipeline <pipeline> [prompt]` — run a graph-native runtime Pipeline (`kind: composite`/`nodes`).
- `/work:list [query]` — list Work Items without mutation.
- `/work:inspect <item-id>` — inspect one Work Item without mutation.
- `/work:ready [query]` — list deterministic ready Work candidates from the configured Work Source.
- `/work:plan [query] --iterations N` — run the configured read-only planning phase and cache a Plan Artifact under `.pi/sandcastle/plans/`.
- `/work:next [query]` — plan the next Work iteration.
- `/work:process [query] --pipeline <pipeline>` — start durable Work processing through graph lanes, per-lane worktrees, and the runtime adapter boundary.
- `/work:process --plan <plan-id> [--pipeline <pipeline>]` — process a previously cached Plan Artifact, optionally overriding its selected pipeline during this transition slice.
- `/work:runs [query]` — list Work Process runs.
- `/work:status [run-id]` — inspect a Work Process run.
- `/work:logs [run-id]` — show recorded log paths for a Work Process run.
- `/work:cancel [run-id]` — reserved cancellation utility.
- `/work:resume [run-id]` — resume a resumable Work Process run.

## Runtime packs

The default runtime pack lives at `extensions/agent-workflows/runtime-packs/sandcastle-templates.json`. It defines graph-native Agent Workflows pipelines. Sandcastle remains an execution adapter for concrete workspace/sandbox operations, not the workflow model itself. The pack includes:

- prompts
- roles
- graph pipelines (`kind: composite`, `loop`, `git.worktree`, `git.merge`, provider-backed agent nodes)
- providers
- Work Sources
- policies
- adapter metadata

The schema is `extensions/agent-workflows/schema/execution-runtime.schema.json`. The current architecture is documented in `docs/architecture/pi-sandcastle-execution-runtime.md` and ADR `docs/adr/0003-graph-native-workflow-runtime.md`.

## LLM tool

`delegate_agent({ agent, task })` lets the primary Pi agent delegate self-contained tasks to configured execution roles.

## Config and artifacts

Edit `.pi/sandcastle/config.yaml` for local overrides. Runtime inventory is compiled from the default Agent Workflows pack as graph-native pipelines and can be overridden by repo config. Pipeline overrides must use map-form `kind: composite` with `nodes`.

Run records are written under `.pi/sandcastle/runs/` with a `kind` field (`direct-role`, `pipeline`, or `work-process`). Cached Plan Artifacts are written under `.pi/sandcastle/plans/` and can be reused with `/work:process --plan <plan-id>`. Command-specific views such as `/work:runs` filter Run Records.
