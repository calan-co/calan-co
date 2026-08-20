---
title: "Implement Control Flow Rendering"
status: not_started
priority: HIGH
complexity: Medium
estimated_effort: 1.5 weeks
dependencies:
  - [[06_rendering_engine.md]]
related_backlog:
  - [[07_error_reporting.md]]
  - [[05_output_format_linters.md]]
related_commit: null
---
# Implement Control Flow Rendering

## Goal
Support `{% if %} / {% else if %} / {% else %} / {% end %}` and `{% for %} / {% end %}` in the renderer.

## Deliverables
- Conditional evaluation with truthiness rules
- Loop evaluation with index/first/last helpers
- Scope rules for loop variables and nested blocks

## Acceptance Criteria
- Control-flow templates produce expected output against sample data
- Nested blocks and mixed expressions behave correctly
- Errors reference exact token positions with actionable messages

## References

- ADR: `temple/docs/adr/004-control-flow-closer.md`
