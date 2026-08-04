# Agent Workflows extension

Agent Workflows is a project-local Pi extension for running deterministic, reviewable workflows over units of **Work**. It exposes `/work:*` commands in Pi, but the workflow model is intentionally portable: Pi is the host integration layer, and Sandcastle is only the current execution adapter for sandbox/worktree/provider operations.

Use this README as the quick reference for comparing Agent Workflows/Vitae-style objectives, architecture, standards, and extension points against other agent-workflow systems.

## Objectives

Agent Workflows exists to make agent execution:

- **Deterministic at the workflow boundary** — pipelines, branches, fan-out/fan-in, stale-plan checks, run records, and merge decisions are owned by code, not by LLM prose.
- **Graph-native and portable** — workflows are declared as concrete graph nodes (`kind`, `nodes`, `needs`, `loop`, `git.worktree`, `git.merge`, `agent.pi`) instead of as Sandcastle template internals.
- **Adapter-backed, not adapter-defined** — Sandcastle creates worktrees, runs provider agents, closes worktrees, and reports results; it does not define product semantics.
- **Durable and inspectable** — direct runs, pipelines, and work-process runs are persisted as Run Records under `.pi/sandcastle/runs/`.
- **Safe by default** — validation happens before execution; graph execution fails closed on no effects, unmergeable results, unknown dynamic refs, ref cycles, max-depth violations, and merge conflicts.
- **Useful for multi-session handoff** — runtime packs, schemas, docs, run records, and local `AGENTS.md`/`CONTRIBUTORS.md` files give future sessions a compact reference point.

## Install/runtime prerequisites

This repo uses `pnpm` and Node's built-in test runner with `tsx`.

```bash
pnpm install
pnpm run check
pnpm test
```

The extension depends on Sandcastle for the default runtime adapter:

```bash
pnpm add -D @ai-hero/sandcastle
```

Then reload Pi from this repo with `/reload`.

## Command surface

### Config and runtime inventory

- `/work:config [show|init|get|set|edit|editor|reset|validate]` — friendly graph-aware config utility and BIOS-style TUI.
- `/work:config-raw show|init|get|set|edit|editor|reset|validate` — deprecated compatibility alias for config utility actions.
- `/work:build-image [docker|podman]` — build the repo execution sandbox image.

Examples:

```text
/work:config show
/work:config validate
/work:config set pipelines.simple-loop.nodes.workspace.nodes.run.role reviewer
/work:build-image docker
```

### Direct execution

- `/work:run [role] <prompt>` — run one configured Role directly.
- `/work:pipeline <pipeline> [prompt]` — run a graph-native runtime Pipeline.

Examples:

```text
/work:run worker fix the flaky parser test
/work:pipeline simple-loop add focused coverage for config validation
```

### Work Source and planning

- `/work:list [query]` — list Work Items without mutation.
- `/work:inspect <item-id>` — inspect one Work Item without mutation.
- `/work:ready [query]` — list deterministic ready Work candidates from the configured Work Source.
- `/work:plan [query] --iterations N` — run the configured read-only planning phase and cache a Plan Artifact under `.pi/sandcastle/plans/`.
- `/work:next [query]` — plan the next Work iteration.

Examples:

```text
/work:list label:ready
/work:inspect ISSUE-123
/work:plan label:ready --iterations 3
```

### Durable Work processing

- `/work:process [query] --pipeline <pipeline>` — start durable Work processing through graph lanes, per-lane worktrees, and the runtime adapter boundary.
- `/work:process --plan <plan-id> [--pipeline <pipeline>]` — process a cached Plan Artifact, optionally overriding its selected pipeline for this transition slice.
- `/work:runs [query]` — list Work Process runs.
- `/work:status [run-id]` — inspect a Work Process run.
- `/work:logs [run-id]` — show recorded log paths for a Work Process run.
- `/work:cancel [run-id]` — reserved cancellation utility.
- `/work:resume [run-id]` — resume a resumable Work Process run.

Examples:

```text
/work:process label:ready --pipeline parallel-planner-with-review
/work:process --plan 2026-08-04T120000Z-ready --pipeline work-process-waves
/work:runs
/work:status <run-id>
/work:logs <run-id>
```

## Architecture at a glance

```text
Pi /work:* command
  -> config/runtime-pack loader + schema/policy validation
  -> Orchestrator for Work Source, plan, context, branch, run-record decisions
  -> graph executor for concrete nodes, needs ordering, loops, refs, typed results
  -> Sandcastle adapter for worktree/sandbox/provider primitives
  -> LLM roles for bounded reasoning inside assigned prompts/worktrees
```

Primary modules:

| Module | Responsibility |
| --- | --- |
| `index.ts` | Pi extension integration: command/tool registration, config loading, user-facing command handlers, pipeline dispatch, and Sandcastle/Pi adapter bridge. |
| `execution-runtime.ts` | Runtime pack types, validation, normalization, and conversion into config inventory. |
| `workflow-model.ts` | Portable static graph model validator and graph-node rules. |
| `graph-executor.ts` | Concrete graph execution: `needs`, composites, loops, dynamic refs, provider-backed nodes, typed results, hooks, and fail-closed effect/merge checks. |
| `orchestrator.ts` | Durable `/work:process` planning/execution records, Work execution contexts, branch naming, entrypoint/wave pipeline selection, and status metadata. |
| `pipeline-packs.mjs` | Runtime-pack-to-config rendering and YAML serialization. |
| `work-source.mjs`, `work-source-adapters.mjs`, `work-brief.mjs` | Work Source adapters, normalized Work Item details, and role-facing Work Brief rendering. |
| `work-runs.mjs`, `run-management.mjs` | Run Record formatting, listing, inspection, resume/cancel support. |
| `config-shadow-model.ts`, `shadow-model.ts` | Friendly config/TUI editing model and graph-safe path mutations. |
| `build-image.ts` | Sandbox image build command support. |

Deeper rationale is documented in:

- `docs/architecture/pi-sandcastle-execution-runtime.md`
- `docs/adr/0002-agent-workflows-rename-and-orchestration-seams.md`
- `docs/adr/0003-graph-native-workflow-runtime.md`

## Runtime packs and graph model

The default runtime pack lives at `extensions/agent-workflows/runtime-packs/sandcastle-templates.json`. It includes:

- `runtimeVersion` and metadata
- defaults for providers, models, Work Sources, policies, worker caps, and iteration caps
- provider metadata (`agentProviders`, `sandboxProviders`)
- Work Source definitions
- reusable Roles and Prompts
- graph-native Pipelines
- policies and adapter metadata

The schemas are:

- `extensions/agent-workflows/schema/execution-runtime.schema.json`
- `extensions/agent-workflows/schema/config.schema.json`

Pipeline overrides in `.pi/sandcastle/config.yaml` must use graph-native map form:

```yaml
pipelines:
  simple-loop:
    kind: composite
    nodes:
      workspace:
        kind: git.worktree
        nodes:
          run:
            kind: agent.pi
            role: worker
            prompt: simple-loop
```

Graph conventions:

- Node ids are map keys; do not add `id` inside node bodies.
- `kind` is the concrete-node discriminator.
- `needs` references sibling node ids in the current `nodes` map.
- Provider-backed node kinds are namespaced, e.g. `agent.pi`, `git.worktree`, `git.merge`, `docker.container`, `podman.container`.
- Abstract concepts such as `AgentResult`, `WorkspaceResult`, and `GitMergeResult` are typed result contracts, not YAML `kind` values.
- Logs are artifacts, not repository effects.

## Dynamic refs and loops

Agent Workflows supports runtime named-pipeline references for wrapper pipelines and work-wave selection.

Preferred dynamic ref shape:

```yaml
nodes:
  selected-wave:
    $:
      ref: $.selectedPipeline
      default: simple-loop
```

Rules:

- Dynamic refs resolve at execution time to named pipelines only.
- Static validation checks structure and literal/default refs where possible; it must not claim to prove all dynamic cycles/depth ahead of time.
- Runtime guards fail closed before entering an unknown target, active ref cycle, or max ref depth violation.
- `$` is a reserved meta namespace for runtime node metadata.

Loop rules:

- `kind: loop` defaults to sequential mode.
- Sequential/no-mode loops may omit `each`; in that case `max` is the iteration count.
- Parallel loops require `each`; for parallel loops `max` caps lane concurrency.
- `/work:process` uses a wrapper pipeline such as `work-process-waves` to run sequential work waves while demoting legacy `maxIterations` into workflow input/loop `max` rather than first-class orchestrator wave semantics.

## Typed results and safety contracts

The executor normalizes node outputs into typed results:

- `AgentResult` — role/provider output; not mergeable by itself.
- `WorkspaceResult` — produced by `git.worktree`; mergeable only when trusted and backed by commits or non-log repository effects.
- `GitMergeResult` — produced by `git.merge` after deterministic local merge commands.
- `LoopResult` / `CompositeResult` — aggregate lane/child results and mergeable workspace children.

Effect and merge checks fail closed when inputs are empty, log-only, missing a branch, untrusted, unmergeable, or conflicting. Parallel loops wait for all started lanes to settle so cleanup can run before failure is reported.

## Config and artifacts

Edit `.pi/sandcastle/config.yaml` for repo-local overrides. Runtime inventory is compiled from the default Agent Workflows pack and can be overridden by repo config.

Artifact locations:

- `.pi/sandcastle/runs/` — Run Records with `kind` values such as `direct-role`, `pipeline`, and `work-process`.
- `.pi/sandcastle/plans/` — cached Plan Artifacts reusable through `/work:process --plan <plan-id>`.
- Per-run log paths — surfaced by `/work:logs` and Run Record node/lane metadata.

Config mutation is deterministic. Root-only config edits to graph-node paths merge runtime defaults before mutation so writes preserve complete graph shape.

## LLM tool

`delegate_agent({ agent, task })` lets a primary Pi agent delegate self-contained tasks to configured execution roles.

Use delegation for bounded implementation, review, or research tasks where the prompt includes all necessary context and expected artifacts. Do not delegate decisions that must stay with the orchestrating session, such as branch protection, merge policy, stale-plan acceptance, or final user-facing attestation.

## Testing and validation

Focused tests commonly used for this package:

```bash
node --import tsx --test test/execution-runtime.test.mjs
node --import tsx --test test/graph-executor.test.mjs
node --import tsx --test test/agent-workflows-model-validator.test.mjs
node --import tsx --test test/process-graph.test.mjs
node --import tsx --test test/config-yaml-composite.test.mjs
```

Broader validation:

```bash
pnpm run check
pnpm test
git diff --check
```

See `extensions/agent-workflows/CONTRIBUTORS.md` for contributor workflow and `extensions/agent-workflows/AGENTS.md` for agent-session guardrails.
