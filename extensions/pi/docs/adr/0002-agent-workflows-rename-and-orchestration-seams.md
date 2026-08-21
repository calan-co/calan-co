# Agent Workflows rename and orchestration seams

## Status

Accepted

## Context

The component previously called Pi-Sandcastle exposed `/backlog:*` commands and inherited several concepts from Sandcastle templates and Doc-Vader-backed backlog processing. That naming made the product appear Pi-only, Sandcastle-owned, and backlog-specific, even though the intended model is broader: configurable agent workflows over units of Work, with Pi as one host and Sandcastle as one execution adapter.

The prior implementation also blurred responsibilities between planner roles, orchestration, work-source access, execution contexts, run records, and tracker mutations.

## Decision

Rename the product/domain to **Agent Workflows** and use **Work** as the broad user-facing concept.

- The command namespace is `/work:*`.
- The old `/backlog:*` namespace is removed outright because there are no external users.
- A **Work Item** is one discrete addressable unit of Work from a source such as GitHub Issues, Beads, Doc-Vader, or a custom source.
- A **Work Source Adapter** reads Work Items and maps native structured data into Agent Workflows' smaller canonical Work Item Detail schema while preserving source material for fidelity.
- A deterministic **Work Brief** renderer produces role-facing prose from normalized Work Item data and preserved source material.

ADR 0004 refines this Work Source seam: each repository selects exactly one named Work Source Registration, runtime-pack registrations use the same schema as repo-local registrations, and unselected registrations are dormant.

Agent Workflows owns a deterministic **Orchestrator**. The Orchestrator is not a configurable role. It owns workflow control, pipeline policy, branch naming, fan-out/fan-in, durable Run Records, resume/cancel state, and execution-context lifecycle.

ADR 0003 amends this pipeline model: graph-native workflow config is the authoritative pipeline representation. Pipelines are concrete graph node maps with typed results rather than typed Pipeline Steps as the current Runtime Config surface. Historical step terms in this ADR remain useful for orchestration ownership, but ADR 0003 is normative for the executable pipeline shape.

Planning remains a bounded reasoning step:

- `planWork` must explicitly reference a configured planner Role.
- Planner output is read-only and schema-validated into a Plan Artifact.
- Invalid planner output fails closed: preserve raw output/logs, but do not create an executable Plan Artifact.
- The planner classifies constraints such as risk, dependencies, parallelizability, HITL needs, and affected areas.
- The Orchestrator deterministically derives branch names, execution groups, and pipeline selection from the Plan Artifact plus Runtime Config policy.

Execution contexts are owned by the Orchestrator:

- Context identity is tied to each fan-out item; branch is a property of that context.
- Sequential phases for the same item reuse the same context.
- Parallel items get separate contexts.
- Context metadata is persisted in Run Records, while git/worktree remains the source of code durability.
- Missing/stale context recovery is deterministic and fail-closed.

Run Records are written only by the Orchestrator. Steps, adapters, and role runners return normalized results/events for the Orchestrator to validate and persist. Run Record lifecycle is unified behind the generic run-management module and only `.pi/sandcastle/runs/` is supported during active Agent Workflows development. Obsolete Work Process record directories and backlog compatibility aliases are not compatibility surfaces; Work Process views add only projection, formatting, and Work Source Registration drift checks on top of unified Run Records.

Sandcastle templates are a one-time port source, not an ongoing product model or library to mirror. Sandcastle remains an execution adapter behind Agent Workflows seams.

## Consequences

- Documentation, glossary, and command surface move from backlog/Pi-Sandcastle language to Work/Agent Workflows language.
- Existing `/backlog:*` tests and command registrations must move to `/work:*`.
- The first implementation slice is a rename-and-seam pass, not a big-bang orchestrator rewrite.
- Deeper runtime modules can be introduced incrementally behind the renamed surface.
- The local Markdown/backlog reader and source-specific mutation hooks are not compatibility fallbacks; ADR 0004 owns their removal.
