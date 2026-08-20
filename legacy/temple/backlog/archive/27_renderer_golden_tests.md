---
title: "Renderer Golden Tests"
status: not_started
priority: MEDIUM
complexity: Low
estimated_effort: 3 days
dependencies:
  - [[06_rendering_engine.md]]
  - [[05_output_format_linters.md]]
related_backlog:
  - [[15_testing_and_validation.md]]
  - [[07_error_reporting.md]]
related_commit: null
---
# Renderer Golden Tests

## Goal
Add golden tests for end-to-end rendering across formats (Markdown, HTML, JSON) with sample data.

## Deliverables
- Fixtures: input data, templates, expected outputs
- Tests that assert exact rendered output and pass base format linting
- CI hook to prevent regressions

## Acceptance Criteria
- Golden tests cover expressions, control-flow, nested blocks
- Outputs lint cleanly using base linters
- Easy to add new golden cases
