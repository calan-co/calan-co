# Pi Extensions

Pi Extensions provides project-local Pi command surfaces and runtime models for delegating agent workflows to sandboxed coding tools.

## Language

**Role**:
A reusable execution identity in Agent Workflows, such as planner, implementer, reviewer, or merger. A Role defines behavior and defaults for a unit of delegated work and is referenced as `roles` or `role` in runtime language.
_Avoid_: Agent, persona, worker

**Agent Provider**:
An external coding-agent implementation that can execute a Role, such as Pi, Claude Code, Codex, Cursor, OpenCode, or Copilot.
_Avoid_: Role, agent

**Agent Workflows**:
The portable orchestration model and renamed component that defines roles, prompts, pipelines, policies, issue trackers, providers, and adapters for agent-driven work. Agent Workflows may be hosted by Pi and may use Sandcastle as an execution adapter, but neither Pi nor Sandcastle defines the core model.
_Avoid_: Agent Workflows runtime, Sandcastle config, template pack

**Orchestrator**:
The deterministic Agent Workflows module that owns workflow control: planning gates, pipeline selection policy, branch naming, fan-out/fan-in, durable Run Records, resume/cancel, and execution-context lifecycle. The Orchestrator invokes Roles for bounded reasoning or execution; it is not itself a configurable Role.
_Avoid_: Orchestrator role, planner, execution agent

**Pipeline Step**:
A typed declarative unit inside a Pipeline that describes one piece of workflow behaviour, such as `planWork`, `fanOut`, `runRole`, `review`, or `merge`. Agent Workflows uses simple typed steps as the user-facing model; capability requirements may exist as internal metadata but are not the primary configuration language. Common workflow fields are first-class, while provider-specific inputs live under `with` and are validated by the Step Provider.
_Avoid_: Step module, command, untyped role/prompt step, capability program

**Step Provider**:
Extension-owned or custom-provider TS/JS implementation code that knows how to execute a kind of Pipeline Step. Built-in step kinds are unqualified, custom Step Providers register provider-qualified kinds such as `acme.deploy`, and unknown step kinds are invalid.
_Avoid_: Pipeline step, runtime config step, prompt

**System Prompt**:
The stable identity and behavioural instruction attached to a Role.
_Avoid_: Task prompt, pipeline prompt

**Task Prompt**:
A reusable workflow instruction selected by a Pipeline step and executed by a Role. Pipeline steps normally reference Task Prompts by id; UI may expand those references read-only for full-context review and offer navigation to the canonical prompt or creation of a one-off `promptOverride`.
_Avoid_: System prompt, role prompt

**Prompt Override**:
One-off prompt text attached to a Pipeline Step while preserving the referenced Task Prompt identity. Prompt Overrides are exceptional and should be visibly distinct from canonical Task Prompts.
_Avoid_: Inline prompt, anonymous prompt

**Sandbox Default**:
The normal sandbox provider used by roles and pipelines unless an explicit override is set for an exceptional case.
_Avoid_: Role sandbox, pipeline sandbox

**Runtime Config**:
The repo-local Agent Workflows document that makes global values, roles, task prompts, pipelines, and named policies visible and editable. Runtime Config may reference built-in or provider-qualified Step Provider kinds, but it does not define provider source code or provider catalog metadata.
_Avoid_: Provider catalog, provider source, legacy config, generated scaffold

**Direct Role Run**:
An advanced utility execution of a single Role with ad hoc prompt text. Direct Role Runs are useful for debugging Role behaviour but bypass Pipeline-specific policy composition.
_Avoid_: Pipeline run, Work Process

**Run Record**:
A durable record of execution with a kind such as direct role, pipeline, or Work Process. Command-specific run views filter Run Records rather than using separate lifecycle concepts.
_Avoid_: Result file, job file, per-command store

**Plan Work Step**:
A read-only Pipeline Step that invokes an explicitly configured planning Role to analyze normalized candidate work and produce a schema-validated Plan Artifact. A Plan Work Step may classify risk, dependencies, parallelizability, HITL needs, and affected areas, but it does not authoritatively assign branches or choose execution pipelines.
_Avoid_: Orchestration step, planner pipeline, deterministic backlog planner

**Plan Artifact**:
A durable, schema-validated planning result consumed by the Orchestrator before execution begins. A Plan Artifact contains normalized work items, dependencies, classifications, and rationale; it does not contain authoritative branch names, pipeline choices, or execution mechanics. Invalid planner output is preserved for inspection but is not an executable Plan Artifact.
_Avoid_: Planner log, ad hoc JSON, cached output, execution plan

**Work Process**:
A Pipeline-driven execution started from work-item query/context. Work selection belongs inside the Pipeline through typed steps such as `planWork`, not as hidden command pre-processing. The `/work:*` command namespace exposes Work Processes to users.
_Avoid_: Backlog process, preselected run, command-selected process

**Policy**:
A named reusable runtime choice for cross-cutting workflow behaviour such as branch handling, image building, completion, retries, or concurrency. Defaults, Pipelines, and Pipeline Steps reference Policies by id.
_Avoid_: Inline setting, provider config

**Provider Catalog**:
An extension-owned, read-only metadata reference for built-in Agent Providers, sandbox providers, adapters, and built-in Step Providers. Runtime Config references built-in provider ids and may register custom installed providers, but it does not copy or override the built-in Provider Catalog.
_Avoid_: Provider source, copied built-in provider metadata, copied provider code

**Custom Provider**:
A user-installed extension provider that can be registered in Runtime Config for backlog management or execution. A Custom Provider is declared with package registration metadata such as kind, package, export, and id; its source code lives in the installed provider package, not in Runtime Config.
_Avoid_: Built-in provider override, provider catalog patch

**Work**:
The broad product and user-facing concept for agent-addressable work. Work is exposed through the `/work:*` command namespace; discrete tracker-backed units are Work Items.
_Avoid_: Backlog, issue-only work, Sandcastle task

**Work Item**:
One discrete addressable unit of Work from a tracker or work source, such as a GitHub issue, Beads task, or Doc-Vader work item.
_Avoid_: Task, issue, backlog item

**Work Item Detail**:
Agent Workflows' small canonical representation of one Work Item, independent of any specific tracker. Rich tracker-native structures such as Doc-Vader work-item JSON are mapped into Work Item Detail and preserved as source material rather than becoming the runtime's domain model.
_Avoid_: Doc-Vader item, GitHub issue, Beads task

**Work Source Settings**:
Repo-specific configuration for the selected Work source, such as labels, queries, project identifiers, or custom provider registration. Built-in Work Source implementation metadata remains in the Provider Catalog.
_Avoid_: Issue tracker settings, built-in tracker template, issue tracker source

**Work Source Adapter**:
A module that reads Work Items from a source and maps native structured data into Work Item Detail objects for Agent Workflows. Work Source Adapters preserve source fidelity and prefer deterministic field mapping; reasoning-based normalization is exceptional and not the default route. Mutable Work Sources may also expose typed mutation capabilities.
_Avoid_: Issue tracker adapter, planner, markdown parser, lossy work-item summarizer

**Work Brief**:
Deterministic role-facing prose rendered from normalized work-item data plus preserved source material. Roles consume Work Briefs; orchestration and policy consume normalized work-item data.
_Avoid_: Raw issue dump, planner summary, renormalized markdown

**Review Step**:
An optional first-class Pipeline Step that evaluates work and returns structured outcomes such as approved, changes requested, or blocked. Pipelines are not required to include review, but when they do the Orchestrator can route rework deterministically from the Review Step result.
_Avoid_: Required review phase, generic reviewer prompt, implicit merge gate

**Work Source Mutation Step**:
A typed Pipeline Step that mutates the selected Work Source through a Work Source Adapter, such as `commentWork`, `closeWork`, or `updateWorkStatus`. Roles may produce recommended mutation content as structured output, but Work Source mutations are owned by the Orchestrator and run only through explicit Work Source Mutation Steps after configured gates pass.
_Avoid_: Tracker mutation step, role-owned close, ad hoc CLI mutation, implicit close-on-success

**Phase Result**:
A normalized result from one Role execution phase, containing status, branch, commits, log reference, optional structured output, and summary. Raw logs remain available for inspection, but the Orchestrator consumes Phase Results rather than scraping logs or role prose.
_Avoid_: Agent transcript, raw log, run output
