# Contributing to Agent Workflows

This guide is for humans maintaining `extensions/agent-workflows`. It complements the repo-level instructions and the package-local `AGENTS.md` used by AI coding sessions.

## Development principles

- Preserve the product boundary: Agent Workflows owns workflow semantics; Pi is the host; Sandcastle is an execution adapter.
- Keep workflows graph-native: persisted pipelines use `kind: composite` with map-form `nodes`.
- Prefer deterministic code over role reasoning for orchestration decisions: branch names, Work contexts, plan validation, mergeability, stale state, and Run Records are code-owned.
- Fail closed at boundaries: config validation, dynamic refs, no-effect execution, unmergeable outputs, stale plans, and merge conflicts should stop before mutation when possible.
- Use TDD by default. Add or update a focused failing test first, implement the smallest fix, then refactor after tests are green.

## Setup

```bash
pnpm install
pnpm run check
pnpm test
```

Reload Pi from this repo after extension changes:

```text
/reload
```

## Common validation commands

Focused package tests:

```bash
node --import tsx --test test/execution-runtime.test.mjs
node --import tsx --test test/graph-executor.test.mjs
node --import tsx --test test/agent-workflows-model-validator.test.mjs
node --import tsx --test test/process-graph.test.mjs
node --import tsx --test test/config-yaml-composite.test.mjs
node --import tsx --test test/agent-workflows-orchestrator.test.mjs
```

Config, run-management, and Work Source coverage often lives in root-level `test/*.mjs` files even when filenames still carry historical `backlog` or `pi-sandcastle` names.

Before handing off changes, run at least:

```bash
pnpm run check
git diff --check
```

Run `pnpm test` when the change crosses module boundaries, changes runtime schema/config behavior, or touches the graph executor/orchestrator.

## Change checklists

### Runtime pack or schema changes

Update and validate together:

- `runtime-packs/sandcastle-templates.json`
- `schema/execution-runtime.schema.json`
- `schema/config.schema.json` when repo config shape changes
- `execution-runtime.ts` validation/normalization
- `pipeline-packs.mjs` YAML rendering if generated config changes
- Focused tests in `test/execution-runtime.test.mjs` and `test/config-yaml-composite.test.mjs`
- README/architecture docs when user-facing semantics change

### Graph executor changes

Check:

- `graph-executor.ts`
- `workflow-model.ts` if static validation must change
- `test/graph-executor.test.mjs`
- `test/agent-workflows-model-validator.test.mjs`
- `test/process-graph.test.mjs` for `/work:process` integration behavior

Preserve typed-result and effect rules: logs are artifacts, not repository effects; `git.merge` must fail closed on empty/log-only/unmergeable inputs and conflicts.

### Orchestrator or `/work:process` changes

Check:

- `orchestrator.ts`
- `index.ts` command handling and config/plan loading
- `work-runs.mjs` / `run-management.mjs` for status/list/resume formatting
- `test/agent-workflows-orchestrator.test.mjs`
- `test/process-graph.test.mjs`
- Work Source mutation tests when source state can change

Keep the Orchestrator responsible for Work execution contexts, branch names, selected pipelines, plan validation, stale-plan handling, and Run Record writes.

### Config UI/path changes

Check:

- `config-shadow-model.ts`
- `shadow-model.ts`
- `pipeline-packs.mjs`
- `index.ts` config command paths
- Config/TUI tests such as `test/config-command-collapse.test.mjs`, `test/config-yaml-composite.test.mjs`, and historical `backlog-config-*` tests

Root-only config edits to graph-node paths should merge defaults first so writes preserve complete graph shape.

### Documentation-only changes

Tests may not be necessary for pure prose edits, but still run:

```bash
git diff --check
```

If docs include command examples, verify names and paths against the current code or runtime pack.

## Artifact conventions

- Repo config: `.pi/sandcastle/config.yaml`
- Run Records: `.pi/sandcastle/runs/`
- Plan Artifacts: `.pi/sandcastle/plans/`
- Default runtime pack: `extensions/agent-workflows/runtime-packs/sandcastle-templates.json`
- Architecture docs: `docs/architecture/pi-sandcastle-execution-runtime.md`
- ADRs: `docs/adr/0002-agent-workflows-rename-and-orchestration-seams.md`, `docs/adr/0003-graph-native-workflow-runtime.md`

Do not commit generated local run records, plan artifacts, subagent scratch directories, or logs unless a test fixture explicitly requires them.

## Handoff expectations

A useful handoff includes:

- Changed files
- Tests added or updated
- Commands run and results
- Validation output or relevant excerpts
- Tests not run and why
- Residual risks
- Scope notes, especially when preserving backward compatibility or intentionally not widening behavior

For review-oriented work, include exact file/line references for blockers and distinguish correctness issues from future improvements.
