---
title: "Implement Expression Rendering"
status: not_started
priority: HIGH
complexity: Medium
estimated_effort: 1 week
dependencies:
  - [[06_rendering_engine.md]]
  - [[02_query_language_and_schema.md]]
related_backlog:
  - [[07_error_reporting.md]]
  - [[05_output_format_linters.md]]
related_commit: null
---
# Implement Expression Rendering

## Goal
Evaluate `{{ expression }}` against provided data and substitute results into the output safely.

## Deliverables
- Expression evaluator that resolves dot-notation and JMESPath (if configured)
- Safe sandbox (no builtins/attrs escape) with explicit allowlist
- Filters/pipes scaffolding (no-op or simple built-ins)

## Acceptance Criteria
- Expressions resolve from input data and render into output
- Invalid expressions produce clear diagnostics and best-effort output
- Supports custom delimiters and position-accurate errors
