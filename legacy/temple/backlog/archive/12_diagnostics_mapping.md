---
title: "Map Diagnostics to Original Template"
status: complete
priority: CRITICAL
complexity: High
estimated_effort: 1 week
dependencies: ["11_integrate_base_linters.md", "09_template_preprocessing.md"]
related_backlog: ["07_error_reporting.md", "13_combine_template_and_base_diagnostics.md"]
related_commit: "a9e45fb"
---
# Map Diagnostics to Original Template

## Prompt
Implement logic to map diagnostics from the base linter (run on preprocessed content) back to the original template file positions. Ensure error messages are clear and actionable.

## Context files
- 07_error_reporting.md
- temple.md
