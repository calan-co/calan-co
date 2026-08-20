---
title: "Define Template DSL Syntax and Logic Primitives"
status: complete
priority: CRITICAL
complexity: High
estimated_effort: 1 week
dependencies: []
related_backlog: ["02_query_language_and_schema.md", "04_template_parser_linter.md", "06_rendering_engine.md"]
related_commit: "31e3c1c"
---
# Define Template DSL Syntax and Logic Primitives

## Goal
Design a minimal, consistent syntax for the templating DSL, including logic primitives (loops, conditionals, includes, user-defined functions) that overlay the target output format.

## Deliverables
- Syntax specification document
- Example templates for Markdown, HTML, JSON
- List of supported logic primitives
- Example usage of user-defined functions

## Acceptance Criteria
- Syntax is readable and overlays target format without breaking format linting
- Logic primitives are consistent across formats
- User-defined functions are supported
- Example templates pass target format linters when logic is ignored
