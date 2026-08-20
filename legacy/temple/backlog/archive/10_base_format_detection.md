---
title: "Detect Base Format of Templated Files"
status: complete
priority: HIGH
complexity: Low
estimated_effort: 2 days
dependencies: ["03_data_format_parsers.md"]
related_backlog: ["11_integrate_base_linters.md", "18_format_detector_registry.md"]
related_commit: "a9e45fb"
---
# Detect Base Format of Templated Files

## Prompt
Implement logic to detect the base format (JSON, YAML, HTML, etc.) of a templated file based on its extension and/or content. This should work for any *.tmpl or *.template file.

## Context files
- 03_data_format_parsers.md
- temple.md
