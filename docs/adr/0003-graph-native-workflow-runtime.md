# Graph-native workflow runtime

## Status

Accepted

## Context

Agent Workflows needs a deterministic workflow model that can describe parallel Work processing, per-item branches, typed mergeability, and fail-closed no-effect behavior without coupling product semantics to an adapter template shape.

The product model is concrete workflow nodes with typed results:

- `kind: composite` is the top-level workflow shape.
- `nodes` is a map keyed by node id; node ids are not stored inside node bodies.
- `needs` is scoped to sibling nodes inside the current `nodes` map.
- `kind` is the only globally reserved concrete-node discriminator.
- Concrete provider-backed kinds are provider-first namespaced, such as `agent.pi`, `git.worktree`, `git.merge`, `docker.container`, and `podman.container`.
- Abstract concepts such as `WorkspaceResult`, `AgentResult`, and `GitMergeResult` are typed result contracts, not YAML node kinds.
- Logs are artifacts, not repository effects.

## Decision

Agent Workflows uses graph-native workflow config as the authoritative pipeline representation. Pipelines are valid only when they satisfy the current schema and policy checks.

The runtime is split into four layers:

1. **Declarative layer**
   - Runtime packs and repo config define roles, prompts, defaults, policies, and graph pipelines.
   - Graph pipelines use `kind: composite` and map-form `nodes`.
   - `loop` describes repeated or per-item execution.
   - `git.worktree` declares an isolated workspace boundary.
   - `git.merge` declares merge fan-in over effectful workspace results.

2. **Imperative orchestration layer**
   - `/work:*` commands parse user intent, load config, validate Work/Plan state, select a pipeline, derive execution contexts, and write durable Run Records.
   - The Orchestrator owns branch names, lane identities, item/context metadata, graph input, status rows, and run-record persistence.
   - Roles and agents do not invent branch identity for `/work:process` lanes.

3. **Runtime adapter layer**
   - The graph executor executes concrete nodes deterministically by `needs`.
   - The Sandcastle adapter backs concrete workspace and agent execution today: it creates worktrees, runs provider agents in sandboxes, closes worktrees, and returns commits/logs/errors.
   - `git.merge` performs deterministic local git merges of effectful `WorkspaceResult` branches into the target branch and fails closed on no inputs, no effects, log-only results, and conflicts.

4. **Reasoning layer**
   - LLM roles receive prompts plus deterministic context produced by orchestration.
   - LLM output is normalized into typed results and validated before it can affect later graph nodes.
   - Repository effects are established by git commits/merge effects, not by prose or log files.

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

1. `/work:pipeline simple-loop "fix auth bug"` loads the graph pipeline.
2. The graph executor enters `root.nodes.workspace`.
3. The `git.worktree` handler creates a Sandcastle worktree/branch and executes child nodes inside that workspace context.
4. The `agent.pi` node resolves the worker role and prompt, runs the selected provider through Sandcastle, and returns an `AgentResult` with commits/logs.
5. `git.worktree` aggregates child commits into a `WorkspaceResult` with repository effects.
6. The pipeline run succeeds only if at least one node produced repository effects.

Reasoning boundary:

- The worker reasons about the prompt and repository inside its assigned worktree.
- The Orchestrator decides success from typed commits/effects, not from the worker's summary text.

### Example 2: durable Work processing with per-item lanes (`/work:process --pipeline parallel-planner-with-review`)

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

1. `/work:process ready-items --pipeline parallel-planner-with-review` resolves Work Items and groups them by readiness/parallelizability.
2. The Orchestrator creates `WorkExecutionContext` records with stable `contextId`, `itemId`, `laneId`, and branch names such as `agent-workflows/<pipeline>/<run>/<item>`.
3. Graph input includes the prompt, `items`, `executionContexts`, and `executionGroups`.
4. Each loop lane opens a `git.worktree` using the orchestrator-owned branch for that item.
5. Agent nodes run inside their lane worktree; status rows and summaries are derived from actual graph node/lane updates.
6. Parallel loop execution waits for all started lanes to settle before surfacing a failure, so worktree cleanup can complete.
7. `git.merge` consumes effectful `WorkspaceResult` inputs and merges accepted/effectful branches into the target branch.

Reasoning boundary:

- The planner/reviewer/implementer roles reason only within delegated prompts and lane context.
- Branch ownership, fan-out, merge order, stale-plan rejection, and durable status are deterministic Orchestrator responsibilities.

### Example 3: config editing from root-only defaults

Declarative starting config:

```yaml
runtimeVersion: 1
defaultPipeline: simple-loop
defaultAgent: claude-code
```

Imperative flow:

1. `/work:config set pipelines.simple-loop.nodes.workspace.nodes.run.role reviewer` targets a graph node path.
2. The config command merges runtime-pack defaults before applying the edit, so the complete graph is present.
3. The shadow model updates only the targeted nested role field.
4. `configToYaml` writes a graph-native pipeline with required `kind` fields preserved.
5. Validation succeeds because the edit did not create a partial graph.

Reasoning boundary:

- Config editing is deterministic and schema/validator-backed.
- No LLM role participates in config mutation.

## Consequences

- Runtime packs define graph nodes directly.
- `configToYaml(packsToConfig())` renders graph-native default workflows.
- The friendly config TUI preserves graph nodes and mutates graph-node fields only.
- `/work:process` status rows and run summaries are graph-event/node/lane based, not synthetic role placeholders.
- Sandcastle remains an adapter dependency for concrete workspace/sandbox/provider execution, but not the source of workflow semantics.

## Compatibility

- Repo config must validate against the current graph-native schema and policy checks before execution.
- Runtime packs contain graph-native node definitions only.
- Logs and log paths remain observable artifacts, but they do not count as repository effects.

## Follow-ups

- Add richer graph-node editing in the friendly config TUI beyond basic role/prompt fields.
- Consider extracting the graph executor and runtime adapter interfaces into a smaller module boundary once more adapters exist.
