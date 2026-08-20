---
title: "Combine Template and Base Format Diagnostics"
status: complete
priority: HIGH
complexity: Medium
estimated_effort: 3 days
dependencies: ["04_template_parser_linter.md", "12_diagnostics_mapping.md"]
related_backlog: ["07_error_reporting.md", "08_cli_editor_integration.md"]
related_commit: 659f208 # refactor(temple-linter): extract LSP server logic into service classes
---
# Combine Template and Base Format Diagnostics

## Prompt
Combine diagnostics from the template parser/linter and the base format linter. Return all diagnostics to the VS Code client via LSP.

## Implementation Status

**Completed during Work Item #17 (LSP Server Refactoring)**

The diagnostic combination workflow is implemented in `LintOrchestrator` (lines 45-75):

1. **Template linting**: `TemplateLinter.lint()` returns template syntax diagnostics
2. **Token cleaning**: Strips DSL tokens for base format validation
3. **Format detection**: Detects base format or triggers VS Code passthrough
4. **Base linting**: `BaseLintingService` requests diagnostics from VS Code native linters
5. **Diagnostic mapping**: `DiagnosticMappingService` maps base diagnostics to original positions
6. **Merge**: `all_diagnostics = template_diagnostics + mapped_base_diagnostics`
7. **Return via LSP**: `lsp_server.py` publishes combined diagnostics to VS Code client

## Files

- `temple-linter/src/temple_linter/services/lint_orchestrator.py` - Orchestrates complete workflow
- `temple-linter/src/temple_linter/lsp_server.py` - LSP handlers publish diagnostics
- `temple-linter/src/temple_linter/services/base_linting_service.py` - Requests base diagnostics
- `temple-linter/src/temple_linter/services/diagnostic_mapping_service.py` - Maps positions

## Context files
- 04_template_parser_linter.md
- 07_error_reporting.md
- temple.md

