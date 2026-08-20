---
title: "29_render_time_validation"
status: archived
priority: Low
complexity: Medium
estimated_effort: 1 week
related_backlog:
  - [[30_typed_dsl_prototype.md]]
  - [[31_constraint_driven_templates.md]]
---

# 29 — Render-time Validation (Archived / Superseded)

Status: archived

Context
-------
This item originally described a spike to instrument the renderer to emit an output→template position map, render sample templates and run format validators (JSON Schema, htmlhint), and map validator diagnostics back to template positions.

Reason for archival
-------------------
- Per project direction during scoping, the team chose to prioritize the `Structured/typed template AST` and `Declarative, constraint-driven templates` spikes (backlog items [[30_typed_dsl_prototype.md]] and [[31_constraint_driven_templates.md]]). Those approaches offer stronger compile-time guarantees and are a better fit for the current architectural goals.
- The render-time validation idea remains valid but is deprioritized and can be reconsidered later or explored as part of spike 30 if useful.

If needed later
---------------
- Restore this file to active status and add concrete tasks/test harness under `examples/`.
- Alternatively, include selective render-time instrumentation as part of the `typed AST` prototype if run-time mapping is required for diagnostics.
