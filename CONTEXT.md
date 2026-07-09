# Pi Extensions

Pi Extensions provides project-local Pi command surfaces and runtime models for delegating backlog work to sandboxed coding tools.

## Language

**Role**:
A reusable execution identity in a Pi-Sandcastle runtime, such as planner, implementer, reviewer, or merger. A Role defines behavior and defaults for a unit of delegated work and is referenced as `roles` or `role` in runtime language.
_Avoid_: Agent, persona, worker

**Agent Provider**:
An external coding-agent implementation that can execute a Role, such as Pi, Claude Code, Codex, Cursor, OpenCode, or Copilot.
_Avoid_: Role, agent

**Execution Runtime**:
The Pi-Sandcastle model that defines roles, prompts, pipelines, policies, issue trackers, providers, and adapters for backlog work.
_Avoid_: Sandcastle config, template pack

**Pipeline Step**:
A declarative unit inside a Pipeline that describes one piece of workflow behaviour, such as `selectWork`, `runRole`, reviewing results, or merging output. Common workflow fields are first-class, while provider-specific inputs live under `with` and are validated by the Step Provider.
_Avoid_: Step module, command

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
The repo-local Execution Runtime document that makes global values, roles, task prompts, pipelines, and named policies visible and editable. Runtime Config may reference built-in or provider-qualified Step Provider kinds, but it does not define provider source code or provider catalog metadata.
_Avoid_: Provider catalog, provider source, legacy config, generated scaffold

**Direct Role Run**:
An advanced utility execution of a single Role with ad hoc prompt text. Direct Role Runs are useful for debugging Role behaviour but bypass Pipeline-specific policy composition.
_Avoid_: Pipeline run, backlog process

**Run Record**:
A durable record of execution with a kind such as direct role, pipeline, or backlog process. Command-specific run views filter Run Records rather than using separate lifecycle concepts.
_Avoid_: Result file, job file, per-command store

**Backlog Process**:
A Pipeline-driven execution started from backlog query/context. Work selection belongs inside the Pipeline through steps such as `selectWork`, not as hidden command pre-processing.
_Avoid_: Preselected run, command-selected process

**Policy**:
A named reusable runtime choice for cross-cutting workflow behaviour such as branch handling, image building, completion, retries, or concurrency. Defaults, Pipelines, and Pipeline Steps reference Policies by id.
_Avoid_: Inline setting, provider config

**Provider Catalog**:
An extension-owned, read-only metadata reference for built-in Agent Providers, sandbox providers, adapters, and built-in Step Providers. Runtime Config references built-in provider ids and may register custom installed providers, but it does not copy or override the built-in Provider Catalog.
_Avoid_: Provider source, copied built-in provider metadata, copied provider code

**Custom Provider**:
A user-installed extension provider that can be registered in Runtime Config for backlog management or execution. A Custom Provider is declared with package registration metadata such as kind, package, export, and id; its source code lives in the installed provider package, not in Runtime Config.
_Avoid_: Built-in provider override, provider catalog patch

**Issue Tracker Settings**:
Repo-specific configuration for the selected backlog source, such as labels, queries, project identifiers, or custom provider registration. Built-in issue tracker implementation metadata remains in the Provider Catalog.
_Avoid_: Built-in tracker template, issue tracker source
