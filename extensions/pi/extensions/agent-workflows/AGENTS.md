# Agent instructions for `extensions/agent-workflows`

These instructions apply when an AI coding session works on the Agent Workflows extension or its tests/docs.

## Read first

- `extensions/agent-workflows/README.md` for objectives, command surface, architecture, graph model, and validation commands.
- `extensions/agent-workflows/CONTRIBUTORS.md` for contributor checklists.
- `docs/architecture/pi-sandcastle-execution-runtime.md` and `docs/adr/0003-graph-native-workflow-runtime.md` before changing architecture, runtime semantics, graph nodes, or `/work:process` behavior.

## Non-negotiable boundaries

- Agent Workflows owns workflow semantics. Pi is the host integration layer; Sandcastle is an adapter for worktrees, sandboxes, and provider execution.
- Do not make Sandcastle template shape the authoritative workflow model.
- Persisted pipelines must remain graph-native: `kind: composite` plus map-form `nodes`.
- Node ids are map keys. Do not add persisted `id` fields inside graph node bodies.
- `kind` is the concrete-node discriminator. Result types such as `AgentResult`, `WorkspaceResult`, and `GitMergeResult` are not node kinds.
- The Orchestrator owns Work execution contexts, branch names, fan-out/fan-in metadata, plan validation, stale-plan checks, selected pipelines, and Run Record writes.
- LLM roles reason inside assigned prompts/worktrees; they do not own merge policy, branch identity, effect classification, or durable run state.

## TDD and validation

Default to TDD:

1. Add or update a focused failing test.
2. Implement the smallest behavior change.
3. Refactor only after tests are green.
4. Validate focused tests first, then broader tests as needed.

If TDD is impractical, state why before editing.

Common focused tests:

```bash
node --import tsx --test test/execution-runtime.test.mjs
node --import tsx --test test/graph-executor.test.mjs
node --import tsx --test test/agent-workflows-model-validator.test.mjs
node --import tsx --test test/process-graph.test.mjs
node --import tsx --test test/config-yaml-composite.test.mjs
node --import tsx --test test/agent-workflows-orchestrator.test.mjs
```

Always consider:

```bash
pnpm run check
git diff --check
```

Run `pnpm test` for cross-module runtime, schema, config, or orchestrator changes.

## Dynamic ref guardrails

- Prefer runtime ref nodes shaped as `{ "$": { "ref": "...", "default": "..." } }`.
- Runtime refs resolve to named pipelines only.
- Static validation may check structure and literal/default refs, but must not pretend to prove all dynamic cycles/depth ahead of time.
- Runtime must fail closed before entering an unknown ref target, active ref cycle, or max ref depth violation.
- Keep `$` reserved as the graph-node meta namespace.

## Loop guardrails

- `kind: loop` defaults to sequential mode.
- Sequential/no-mode loops may omit `each`; `max` is iteration count.
- Parallel loops require `each`; `max` is lane concurrency.
- Do not reintroduce first-class orchestrator work-wave semantics for `maxIterations`; compatibility should feed workflow variables or loop `max`.

## Effect and merge guardrails

- Logs and log paths are artifacts, not repository effects.
- `AgentResult` is not mergeable by itself.
- `WorkspaceResult` is mergeable only when trusted and backed by commits or non-log repository effects.
- `git.merge` must fail closed on no mergeable inputs, no effects, log-only inputs, missing branches, and merge conflicts.
- Parallel loop failures should still allow already-started lanes to settle and clean up.

## File coupling to remember

When changing one of these, inspect the others:

- Runtime pack/schema: `runtime-packs/sandcastle-templates.json`, `schema/*.json`, `execution-runtime.ts`, `pipeline-packs.mjs`, config tests.
- Graph semantics: `graph-executor.ts`, `workflow-model.ts`, `test/graph-executor.test.mjs`, `test/agent-workflows-model-validator.test.mjs`.
- `/work:process`: `orchestrator.ts`, `index.ts`, `work-runs.mjs`, `run-management.mjs`, `test/process-graph.test.mjs`, `test/agent-workflows-orchestrator.test.mjs`.
- Config UI/path edits: `config-shadow-model.ts`, `shadow-model.ts`, `pipeline-packs.mjs`, config/TUI tests.
- Work Source behavior: `work-source.mjs`, `work-source-adapters.mjs`, `work-brief.mjs`, source mutation tests.

## Handoff requirements

End with a concise handoff containing:

- Changed files
- Tests added/updated
- Commands run and pass/fail result
- Tests not run and reason
- Residual risks
- Scope notes

Do not claim validation that was not run. Do not hide pre-existing working-tree changes.
