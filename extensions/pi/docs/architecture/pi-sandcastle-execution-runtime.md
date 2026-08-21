# Agent Workflows execution runtime

## Decision

Agent Workflows defines a host-portable, deterministic graph workflow model and uses Sandcastle as a runtime adapter for concrete workspace, sandbox, and provider execution. Sandcastle is not the source of product-level workflow semantics.

In this split:

- **Pi extension layer** owns `/work:*` commands, completions, TUI config editing, schema validation, freshness checks, and user-facing formatting.
- **Agent Workflows runtime model** owns roles, prompts, graph pipelines, Work Sources, branch policy, image policy, completion policy, and durable execution records.
- **Orchestrator** owns deterministic workflow control around Work Items: pipeline selection, plan validation, execution contexts, branch naming, fan-out/fan-in inputs, status rows, and run-record writes.
- **Graph executor** owns concrete-node execution order, sibling `needs`, loop semantics, typed result coercion, and fail-closed mergeability/effect checks.
- **Sandcastle adapter** owns the low-level runtime primitive: create this git worktree, run this agent provider with this prompt in this sandbox/worktree, close the worktree, and return branch, commits, logs, and errors.

This preserves Sandcastle's execution strengths while removing Sandcastle template shape from the user-facing workflow model.

## Current architectural state

Agent Workflows is now **graph-native by default**:

- Default runtime packs define `kind: composite` pipelines with map-form `nodes`.
- Generated default config rendered via `configToYaml(packsToConfig())` emits graph-native pipeline definitions.
- Repo config must validate against the current graph schema and policy checks before execution.
- New friendly-config TUI pipelines are graph-native `git.worktree` pipelines.
- Graph-node role/prompt config paths are supported for deterministic raw config edits.

## Run records

All durable execution state is a unified Run Record under `.pi/sandcastle/runs/`. Records carry a `kind` discriminator:

- `direct-role` for `/work:run` ad hoc role execution.
- `pipeline` for `/work:pipeline` executions, including step and graph node records.
- `work-process` for `/work:process` records with query, resolved Work Items, selected pipeline, execution contexts, branches, logs, node/lane statuses, and resume metadata.

Command-specific views filter these Run Records instead of maintaining separate lifecycle stores.

Run Record lifecycle is unified behind `run-management.mjs`. Only `.pi/sandcastle/runs/` is supported for durable direct-role, pipeline, and Work Process records; obsolete `.pi/sandcastle/backlog-runs/` and `.pi/sandcastle/results/` Work Process record directories are ignored during active Agent Workflows development. `work-runs.mjs` provides Work Process-specific projection, status formatting, and Work Source Registration drift checks on top of unified Run Records rather than owning a separate compatibility store. The Orchestrator remains the writer for durable Work Process Run Records; adapters, graph nodes, and role runners return normalized events/results instead of owning lifecycle persistence.

## Runtime objects

The stable, reusable, overrideable objects are:

1. `runtimeVersion`
   - Version of the Agent Workflows runtime contract.

2. `metadata`
   - Human-readable pack identity and provenance notes.

3. `defaults`
   - Global fallbacks for sandbox provider, agent provider, model, Work Source, image policy, branch policy, worker cap, iteration cap, and completion policy.

4. `providers`
   - Named adapters that Agent Workflows can resolve.
   - Includes `agentProviders` and `sandboxProviders`.
   - Provider entries describe capabilities/defaults; they do not execute workflows themselves.

5. `workSources`
   - Typed Work Source adapters such as `github-issues`, `beads`, `doc-vader`, or `custom`.

6. `roles`
   - Reusable named execution identities.
   - Roles are globally scoped because they are reused across pipelines and surfaced in `/work:run`.
   - Pipeline nodes reference roles by name.

7. `prompts`
   - Named prompt modules with inline text, file references, or generated templates.
   - Prompt modules are top-level because they are reviewable product behavior and independently reusable.

8. `pipelines`
   - User-facing workflows composed from deterministic concrete graph nodes.
   - Pipelines are command targets for `/work:pipeline` and `/work:process`.

9. `policies`
   - Reusable named policies for branches, images, completion, and future checks.

10. `adapters`
    - Runtime adapter bindings, initially including `sandcastle`.

## Role and setting resolution

Use a hybrid model:

- Top-level `roles` define reusable execution identities and defaults.
- Pipeline agent nodes reference a top-level role by name.
- Node/pipeline overrides may provide `model`, `sandbox`, `maxIterations`, prompt selection, or prompt override without mutating the shared role.

Resolution order:

```text
node override > pipeline default > referenced role > global defaults > provider defaults
```

Runtime pack and config files use `role:` for role references. `agent:` is not part of persisted runtime language; agent providers are selected via provider/model settings.

`Agent Default` is presentation-only. Internally, inherited model settings normalize to undefined so host/provider defaults can propagate naturally.

## Graph workflow model

### Top-level shape

Top-level workflows are `kind: composite`:

```yaml
pipelines:
  example:
    kind: composite
    nodes:
      workspace:
        kind: git.worktree
        nodes:
          run:
            kind: agent.pi
            role: worker
            prompt: blank
```

Rules:

- Node ids are map keys.
- `kind` is the only globally reserved concrete-node discriminator.
- `needs` is scoped to sibling nodes in the current `nodes` map.
- If the runtime cannot instantiate a concept directly, it should not be a `kind`.
- Concrete provider-backed kinds are provider-first namespaced, e.g. `agent.pi`, `git.worktree`, `git.merge`, `docker.container`, `podman.container`.
- Abstract concepts such as `WorkspaceResult`, `AgentResult`, and `GitMergeResult` are typed results, not node kinds.

### Built-in concrete node kinds

- `composite`
  - Executes a child `nodes` map by sibling `needs`.
- `loop`
  - Executes `node` or `nodes` repeatedly.
  - `mode` defaults to `sequential`; `parallel` respects `max` as concurrency.
  - `each` resolves the input collection for per-item lanes.
- `agent.pi`
  - Runs a configured role/prompt through the Pi provider via the runtime adapter.
  - Produces an `AgentResult` and may report branch, commits, log path, stdout, item/lane metadata.
- `git.worktree`
  - Opens an isolated workspace branch/worktree, runs child nodes inside it, closes it, and returns `WorkspaceResult`.
- `git.merge`
  - Consumes mergeable/effectful `WorkspaceResult` inputs and merges branches into the target worktree.
- `work.close`
  - Mutates the configured Work Source to close the current Work Item.
  - Interprets `maxIterations` as maximum close attempts.
  - May declare an optional `finalize` role/prompt that runs after each failed provider close attempt before the final attempt.
  - This finalizer is intentionally scoped to close-node preparation and is not a generic hook or capability negotiation layer.
- `docker.container` / `podman.container`
  - Reserved concrete container nodes for future direct container execution.

## Typed results and effect rules

Every graph node produces a strongly typed result:

- `AgentResult` is role/agent output. It is not mergeable by itself.
- `WorkspaceResult` is produced by `git.worktree`. It is mergeable only when trusted by the graph executor and backed by commits or non-log repository effects.
- `GitMergeResult` is produced by `git.merge` after deterministic git merge commands.
- `LoopResult` aggregates iteration results and mergeable workspace children.
- `CompositeResult` aggregates child node results.

Effect rules:

- Commits count as repository effects.
- Non-log repository effects count as effects.
- `logPath` and log artifacts do **not** count as effects.
- Logs and log paths remain observable artifacts, but they do not count as repository effects.
- Non-empty graph pipeline/process execution fails closed when no repository effect is produced.
- `git.merge` fails closed on no mergeable inputs, no effects, log-only inputs, missing branch, and merge conflict.

## Declarative → imperative → runtime → reasoning

The system intentionally separates declarative workflow data, deterministic imperative orchestration, runtime adapter execution, and LLM reasoning.

### Declarative layer

Source: runtime pack plus `.pi/sandcastle/config.yaml`.

Responsibilities:

- Define roles, prompts, defaults, providers, Work Sources, and graph pipelines.
- Describe desired topology with `kind`, `nodes`, `needs`, `loop`, `git.worktree`, and `git.merge`.
- Remain reviewable and deterministic.

### Imperative orchestration layer

Source: `/work:*` commands and Orchestrator.

Responsibilities:

- Parse user command intent.
- Load/merge/validate config.
- Select pipeline.
- Resolve Work Items or Plan Artifacts.
- Build execution contexts with `itemId`, `laneId`, `contextId`, branch, and group metadata.
- Pass graph input to `executeGraphWorkflow`.
- Persist Run Records and render status rows from graph node/lane updates.

### Runtime adapter layer

Source: graph executor plus Sandcastle-backed handlers.

Responsibilities:

- Execute graph nodes by `needs`.
- Create/close per-lane worktrees.
- Run role providers in selected sandboxes.
- Merge workspace branches.
- Normalize low-level execution output into typed graph results.

### Reasoning layer

Source: LLM roles invoked by `agent.pi` nodes.

Responsibilities:

- Reason about the assigned prompt, Work Brief, branch/worktree context, and repository.
- Produce code/review/planning output.
- Leave durable code effects in git commits when implementation succeeds.

The reasoning layer does not own branch names, merge policy, effect classification, stale-plan checks, or durable run state.

## End-to-end examples

### Example 1: direct graph pipeline (`/work:pipeline simple-loop`)

Declarative config:

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

Imperative flow:

1. `/work:pipeline simple-loop "fix auth bug"` loads the repo config merged with runtime defaults.
2. `executePipeline` detects a graph-shaped pipeline and selects the graph executor.
3. `root.nodes.workspace` opens a Sandcastle worktree.
4. `root.nodes.workspace.nodes.run` resolves the `worker` role and `simple-loop` prompt.
5. The selected provider runs through Sandcastle inside the worktree.
6. The agent returns commits/logs; the `git.worktree` node aggregates commits/effects into `WorkspaceResult`.
7. The pipeline succeeds only if the graph produced repository effects.

Runtime effects:

- One workspace branch/worktree is created and closed.
- Run Record includes graph node records and step/agent log metadata.

Reasoning boundary:

- The worker reasons about the task.
- The Orchestrator decides success from typed effects, not prose or logs.

### Example 2: durable process fan-out with review and merge

Declarative config excerpt:

```yaml
pipelines:
  parallel-planner-with-review:
    kind: composite
    nodes:
      implement:
        kind: loop
        mode: parallel
        each: $.executionContexts
        node:
          kind: git.worktree
          nodes:
            implement:
              kind: agent.pi
              role: implementer
              prompt: implement-work
      review:
        kind: loop
        mode: parallel
        needs: [implement]
        each: $.executionContexts
        node:
          kind: git.worktree
          nodes:
            review:
              kind: agent.pi
              role: reviewer
              prompt: review-work
      merge:
        kind: git.merge
        needs: [review]
```

Imperative flow:

1. `/work:process ready-items --pipeline parallel-planner-with-review` resolves and validates Work Items.
2. The Orchestrator derives execution groups and `WorkExecutionContext` records.
3. Each context owns a deterministic branch such as `agent-workflows/<pipeline>/<run>/<item>`.
4. Graph input includes `prompt`, `items`, `executionContexts`, and `executionGroups`.
5. Parallel loop lanes create per-item `git.worktree` worktrees using orchestrator-owned branches.
6. Implementer/reviewer roles run in their lane worktrees.
7. Parallel loop execution waits for all started lanes to settle before surfacing a failure, so cleanup runs.
8. `git.merge` merges effectful workspace branches into the target branch.
9. `/work:process` rows and summaries come from real graph node/lane metadata: item id, node path, lane id, branch, commits, and log path.

Runtime effects:

- Each lane gets an isolated worktree/branch.
- Merge commits/effects are recorded on the merge node.
- Conflicts fail closed with best-effort abort and no conflict heroics.

Reasoning boundary:

- Roles reason within delegated prompts and lane context.
- Branch selection, merge selection, status, and stale-plan handling are deterministic.

### Example 3: graph config editing from root-only defaults

Starting config:

```yaml
runtimeVersion: 1
defaultPipeline: simple-loop
defaultAgent: claude-code
```

Command:

```text
/work:config set pipelines.simple-loop.nodes.workspace.nodes.run.role reviewer
```

Imperative flow:

1. The config command sees a graph-node path.
2. It merges runtime-pack defaults into the root-only config before editing.
3. `ConfigShadowModel` updates only the nested role field.
4. `configToYaml` writes a complete graph pipeline with required `kind` fields preserved.
5. Validation succeeds.

Reasoning boundary:

- Config mutation is deterministic; no role/LLM participates.

### Example 4: config validation boundary

Declarative config requirements:

```yaml
pipelines:
  issue-work:
    kind: composite
    nodes:
      workspace:
        kind: git.worktree
        nodes:
          run:
            kind: agent.pi
            role: worker
            prompt: implement-work
```

Imperative flow:

1. The loader parses repo config and overlays runtime-pack defaults where root-only edits require them.
2. Validation applies the current schema and policy checks before any worktree or agent is created.
3. `/work:pipeline` and `/work:process` stop at the config boundary when validation fails.

Config boundary:

- Generated defaults and new TUI-created pipelines are graph-native.
- Config errors are user-owned and must be fixed in `.pi/sandcastle/config.yaml`.

## Config and TUI behavior

- `/work:config` is graph-aware.
- New TUI-created pipelines use `kind: composite` + `git.worktree` + `agent.pi`.
- Graph pipeline role/prompt fields can be edited by deterministic config paths.
- Pipeline editing targets graph nodes.
- Root-only config edits to graph-node paths merge runtime defaults first to avoid partial/corrupt graphs.

## Non-goals

- Do not infer deterministic workflow semantics from upstream Sandcastle template folders at runtime.
- Do not copy generated `.sandcastle/main.ts` as the authoritative pipeline model.
- Do not make PR lifecycle commands part of this runtime; future PR workflow belongs under `/pr:*`.
- Do not let LLM roles own branch names, merge policy, or durable Run Record state.
- Do not count logs as repository effects.

## Migration path

Completed:

1. Rename command/domain language to `/work:*` and Agent Workflows.
2. Add runtime pack/schema support for graph-native concrete nodes.
3. Execute graph-shaped `/work:pipeline` and `/work:process` through the graph executor.
4. Add true per-lane `git.worktree` lifecycle.
5. Add real minimal local `git.merge` behavior.
6. Make default runtime config generation graph-native.
7. Make config TUI/shadow model graph-safe for graph pipeline preservation and basic role/prompt edits.

Still optional/future:

- Rich graph node create/delete/reorder editing in the friendly TUI.
- Additional runtime adapters beyond Sandcastle.
