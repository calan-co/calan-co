---
title: "User Functions and Includes"
status: not_started
priority: MEDIUM
complexity: Medium
estimated_effort: 1 week
dependencies:
  - [[06_rendering_engine.md]]
related_backlog:
  - [[01_define_dsl_syntax.md]]
  - [[07_error_reporting.md]]
related_commit: null
---
# User Functions and Includes

## Goal
Support `{% function name(args) %}...{% end %}` and `{% include "path" %}` primitives.

## Deliverables
- Function definition/registry and invocation
- Include resolution (relative to template root), with cycle detection
- Error handling for missing functions/files with positions

## Acceptance Criteria
- Functions can be defined and called within templates
- Includes resolve correctly and compose output
- Diagnostics are clear and mapped to original locations
