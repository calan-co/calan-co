---
title: "Integrate Base Format Linters"
status: complete
priority: HIGH
complexity: Medium
estimated_effort: 1 week
dependencies: ["09_template_preprocessing.md", "10_base_format_detection.md"]
related_backlog: ["05_output_format_linters.md", "12_diagnostics_mapping.md", "18_format_detector_registry.md"]
related_commit: "a9e45fb"
---
# Integrate Base Format Linters

## Prompt
Integrate open-source linters (ajv for JSON, yamllint for YAML, htmlhint for HTML) into the LSP server. Run the linter on the preprocessed content and collect diagnostics.

## Context files
- 05_output_format_linters.md
- temple.md
