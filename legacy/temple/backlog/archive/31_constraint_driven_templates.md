---
title: "31_constraint_driven_templates"
status: archived
priority: Medium
complexity: Medium
estimated_effort: 2 weeks
dependencies:
  - [[06_rendering_engine.md]]
related_backlog:
  - [[30_typed_dsl_prototype.md]]
---

# 31 — Declarative, Constraint-Driven Templates (Spike)

Goal
----
Prototype a declarative template flavor where templates declare the desired output shape and constraints (schema-first). The spike explores verifying template-produced IR against declared constraints at "compile time" and surfaces actionable diagnostics mapped to template locations.

Deliverables
----------
- `temple/src/temple/constraint_dsl.py` — constraint declaration loader / checker
- Example constraint-driven templates in `examples/constraint/`
- Tests that demonstrate constraint checking rejecting invalid templates or template branches
- `backlog/31_constraint_driven_templates.md` (this file) with acceptance criteria and tasks

Acceptance criteria
-------------------
- Templates can declare an expected JSON schema (or simplified shape) alongside template logic
- The constraint checker verifies the template's IR against the declared shape and fails fast with diagnostics
- Diagnostics include mapping to template node positions (or example template line ranges in example parser)

Tasks
-----
1. Design a small constraint language or reuse JSON Schema subset for the spike.
2. Implement a constraint checker that accepts IR and a constraint and performs structural validation.
3. Add example templates + constraints in `examples/constraint/`.
4. Add unit tests demonstrating constraint failures and diagnostic mapping.

Notes / Trade-offs
-----------------
- Constraint-first templates give stronger guarantees to consumers but require template authors to think schema-first.
- This spike is focused on compile-time checks and diagnostic quality — not user ergonomics or migration tooling.


Reason for archival
-------------------
- Per project direction during scoping, the team chose to prioritize the `Structured/typed template AST` ~~and `Declarative, constraint-driven templates`~~ spikes (backlog items [[30_typed_dsl_prototype.md]] ~~and 31~~). Those approaches offer stronger compile-time guarantees and are a better fit for the current architectural goals.
- The render-time validation idea remains valid but is deprioritized and can be reconsidered later or explored as part of spike 30 if useful.