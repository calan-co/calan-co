---
title: "Integrate Output Format Linters"
status: not_started
priority: HIGH
complexity: Medium
dependencies:
  - [[10_base_format_detection.md]]
  - [[11_integrate_base_linters.md]]
related_backlog:
  - [[07_error_reporting.md]]
  - [[13_combine_template_and_base_diagnostics.md]]
estimated_effort: 1 week
related_commit: null
---
# Integrate Output Format Linters

## Goal
Integrate standard linters for target output formats (markdownlint, htmlhint, JSON Schema, etc.) to validate both templates and rendered output.

## Deliverables
- List of supported output format linters
- Integration plan for each linter
- Example linting results for templates and outputs
- Strategy for ignoring or handling DSL tokens in linters

## Acceptance Criteria
- Linters validate templates and outputs correctly
- DSL overlays do not break format linting
- Error messages are clear and actionable
- Adding new linters is straightforward
