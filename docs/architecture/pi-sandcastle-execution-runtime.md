# Pi-Sandcastle execution runtime

## Decision

Pi-Sandcastle should define a Pi-native, deterministic workflow model and use Sandcastle as an execution-runtime adapter, not as the source of product-level workflow semantics.

In this split:

- **Pi extension layer** owns slash commands, completions, TUI config editing, schema validation, run records, state freshness, and user-facing formatting.
- **Pi-Sandcastle runtime model** owns typed definitions for agents, prompts, pipelines, issue trackers, branch policy, image policy, completion policy, and execution records.
- **Sandcastle adapter** owns the low-level primitive: run this agent provider with this prompt in this sandbox/worktree and return branch, commits, logs, and errors.

This preserves the strengths observed from Sandcastle AFK use—robust sandboxed execution, extensibility, tailored prompts, and resilient post-processing—while removing the recurring init/post-processing friction from the user-facing model.

## Non-goals

- Do not infer deterministic workflow semantics from upstream Sandcastle template folders at runtime.
- Do not copy generated `.sandcastle/main.ts` as the authoritative pipeline model.
- Do not make PR lifecycle commands part of this runtime; future PR workflow belongs under `/pr:*`.
- Do not expose reusable low-level step modules as first-class top-level user config until the top-level runtime objects stabilize.

## Top-level runtime objects

The stable, reusable, overrideable objects are:

1. `runtimeVersion`
   - Version of the Pi-Sandcastle runtime contract.
   - Enables migration independent of the extension package version.

2. `metadata`
   - Human-readable pack identity, provenance, and compatibility notes.

3. `defaults`
   - Global fallbacks for sandbox, agent provider, model, issue tracker, image policy, branch policy, and completion policy.

4. `providers`
   - Named adapters that Pi-Sandcastle can resolve.
   - Includes `agentProviders` and `sandboxProviders`.
   - Provider entries describe capabilities and defaults; they do not execute workflows themselves.

5. `issueTrackers`
   - Typed issue/backlog adapters such as `github-issues`, `beads`, `doc-vader`, or `custom`.
   - Replaces template placeholder substitution with an explicit contract.

6. `agents`
   - Reusable named execution identities.
   - Agents are globally scoped by default because they are reused across pipelines and surfaced in `/backlog:run`.
   - Pipelines may override agent settings per step without mutating the shared agent.

7. `prompts`
   - Named prompt modules with inline text, file references, or generated templates.
   - Prompt modules are top-level because they are reviewable product behavior and should be independently reusable.

8. `pipelines`
   - User-facing workflows composed from prompt+agent execution steps and deterministic control steps.
   - Pipelines are the primary command targets for `/backlog:pipeline` and `/backlog:process`.

9. `policies`
   - Reusable named policies for branches, images, concurrency, retry, completion, and post-processing.
   - Policies can be referenced by defaults, pipelines, and steps.

10. `adapters`
    - Runtime adapter bindings, initially including `sandcastle`.
    - This is the explicit seam that lets Pi-Sandcastle keep Sandcastle now and replace or supplement it later.

## Agent scoping

Use a **hybrid** model:

- Top-level `agents` define reusable identities and defaults.
- Pipeline steps reference a top-level agent by name.
- Step-local overrides are allowed for `model`, `sandbox`, `maxIterations`, `systemPrompt`, `copyToWorktree`, and `branchPolicy`.
- Pipeline-local anonymous agents are allowed only for pack authors, not for the initial user-facing config editor.

Resolution order:

```text
step override > pipeline default > referenced agent > global defaults > provider defaults
```

This keeps the TUI simple while preserving enough flexibility for specialized review, merge, and planner roles.

## Execution node kinds

Pipelines should support a small closed set of node kinds before adding generic workflow features:

- `runAgent`: invoke an agent through the selected execution adapter.
- `selectWork`: resolve backlog/issue input into work items.
- `fanOut`: dispatch independent work items with a concurrency limit.
- `fanIn`: collect child results and normalize statuses.
- `review`: run reviewer semantics over branch diffs or artifacts.
- `merge`: merge accepted child branches through a controlled strategy.
- `postProcess`: summarize logs, classify failures, and write durable results.
- `gate`: evaluate deterministic predicates such as required checks or unresolved blockers.

Step modules may exist inside bundled packs, but they should compile to these node kinds rather than becoming user-facing top-level primitives immediately.

## YAML sketch

```yaml
runtimeVersion: 1
metadata:
  id: pi-sandcastle.default
  label: Pi-Sandcastle Default Runtime
  inspiredBy:
    - sandcastle@0.12.0 templates/simple-loop
    - sandcastle@0.12.0 templates/parallel-planner-with-review

defaults:
  agentProvider: pi
  sandboxProvider: podman
  model: Agent Default
  issueTracker: doc-vader
  imagePolicy: repo-default
  branchPolicy: branch-per-run
  completionPolicy: promise-complete

providers:
  agentProviders:
    pi:
      adapter: sandcastle
      defaultModel: Agent Default
      capabilities: [streaming, tools]
    codex:
      adapter: sandcastle
      defaultModel: gpt-5.5
      capabilities: [streaming, tools]
  sandboxProviders:
    podman:
      adapter: sandcastle
      imagePolicy: repo-default
    no-sandbox:
      adapter: sandcastle

issueTrackers:
  doc-vader:
    kind: filesystem-backlog
    listCommand: /backlog:list
    inspectCommand: /backlog:inspect

agents:
  planner:
    role: planner
    provider: default
    model: default
    sandbox: default
    maxIterations: 1
    systemPrompt: You are the planning agent. Produce dependency-aware work selection.
  implementer:
    role: implementer
    provider: default
    model: default
    sandbox: default
    maxIterations: 100
  reviewer:
    role: reviewer
    provider: default
    model: default
    sandbox: default
    maxIterations: 1

prompts:
  implement-backlog-item:
    format: markdown
    template: |
      Implement the selected backlog item.

      Item:
      {{ inputs.item.markdown }}
  review-branch:
    format: markdown
    template: |
      Review the branch for correctness, tests, regressions, and merge blockers.

policies:
  branch:
    branch-per-run:
      type: branch
      pattern: sandcastle/{{ pipeline.id }}/{{ run.id }}
    merge-to-head:
      type: merge-to-head
  image:
    repo-default:
      providerFrom: defaults.sandboxProvider
      namePattern: sandcastle:<repo-dir-name>
      build: if-missing-or-stale
  completion:
    promise-complete:
      promise: COMPLETE

pipelines:
  simple-loop:
    description: Pick and close one open task at a time.
    defaults:
      branchPolicy: merge-to-head
    inputs:
      query:
        type: string
    steps:
      - id: select
        kind: selectWork
        issueTracker: default
        limit: 1
      - id: implement
        kind: runAgent
        needs: [select]
        agent: implementer
        prompt: implement-backlog-item
      - id: post-process
        kind: postProcess
        needs: [implement]

  parallel-planner-with-review:
    description: Plan, fan out implementation, review child branches, then merge accepted work.
    defaults:
      branchPolicy: branch-per-run
    steps:
      - id: plan
        kind: runAgent
        agent: planner
        prompt: plan-backlog-iterations
      - id: implement
        kind: fanOut
        needs: [plan]
        over: $.steps.plan.outputs.items
        concurrency: 4
        step:
          kind: runAgent
          agent: implementer
          prompt: implement-backlog-item
      - id: review
        kind: fanOut
        needs: [implement]
        over: $.steps.implement.outputs.branches
        step:
          kind: review
          agent: reviewer
          prompt: review-branch
      - id: merge
        kind: merge
        needs: [review]
        strategy: accepted-only
      - id: post-process
        kind: postProcess
        needs: [merge]
```

## Sandcastle adapter contract

The first adapter should be thin and explicit:

```ts
interface ExecutionAdapter {
  id: string;
  runAgent(input: RunAgentInput): Promise<RunAgentResult>;
  buildImage?(input: BuildImageInput): Promise<BuildImageResult>;
  cancel?(runId: string): Promise<void>;
  resume?(runId: string): Promise<RunAgentResult>;
}
```

The Sandcastle implementation maps `runAgent` onto `@ai-hero/sandcastle.run()` with provider and sandbox constructors. It must not know about `/backlog:*`, TUI state, config editing, or pipeline planning.

## Migration path

1. Freeze current config and command surface at `v0.1.0`.
2. Add `execution-runtime.schema.json` as the new contract for packs.
3. Convert current Sandcastle-inspired packs into explicit Pi-Sandcastle runtime YAML fixtures.
4. Compile runtime pipelines into the existing `executePipeline` path.
5. Move prompt and policy editing into `/backlog:config` once shadow-model editing can operate on runtime objects.
6. Keep the Sandcastle CLI scaffold path as compatibility-only until no command requires it.

## Open questions

- Should `prompts` remain top-level for all users, or should simple users only see prompt references inside pipelines?
- Should `fanOut` be a first-class pipeline step or compiled from a higher-level `matrix` field?
- Should `issueTrackers` include command strings, TypeScript adapter IDs, or both?
- Should branch policies be globally reusable or mostly pipeline-owned?
- What is the minimum runtime fixture set needed before replacing template-pack derivation?
