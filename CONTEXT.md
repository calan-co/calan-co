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

**Step Module**:
A pack-internal reusable step template that can be compiled into concrete pipeline steps. Step Modules are for runtime pack authors, not repo-level user configuration.
_Avoid_: User step, command, pipeline

**System Prompt**:
The stable identity and behavioural instruction attached to a Role.
_Avoid_: Task prompt, pipeline prompt

**Task Prompt**:
A reusable workflow instruction selected by a Pipeline step and executed by a Role.
_Avoid_: System prompt, role prompt

**Sandbox Default**:
The normal sandbox provider used by roles and pipelines unless an explicit override is set for an exceptional case.
_Avoid_: Role sandbox, pipeline sandbox

**Runtime Config**:
The repo-local Execution Runtime document that makes global values, roles, task prompts, and pipelines visible and editable. Runtime Config customizes workflow shape and behaviour, not provider source code or provider catalog metadata.
_Avoid_: Provider catalog, provider source, legacy config, generated scaffold

**Provider Catalog**:
An extension-owned, read-only metadata reference for built-in Agent Providers, sandbox providers, adapters, and pack-internal Step Modules. Runtime Config references built-in provider ids and may register custom installed providers, but it does not copy or override the built-in Provider Catalog.
_Avoid_: Provider source, copied built-in provider metadata, copied provider code

**Custom Provider**:
A user-installed extension provider that can be registered in Runtime Config for backlog management or execution. A Custom Provider is declared with package registration metadata such as kind, package, export, and id; its source code lives in the installed provider package, not in Runtime Config.
_Avoid_: Built-in provider override, provider catalog patch

**Issue Tracker Settings**:
Repo-specific configuration for the selected backlog source, such as labels, queries, project identifiers, or custom provider registration. Built-in issue tracker implementation metadata remains in the Provider Catalog.
_Avoid_: Built-in tracker template, issue tracker source
