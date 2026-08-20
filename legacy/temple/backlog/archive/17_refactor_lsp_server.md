---
title: "Refactor LSP Server into Service Classes"
status: complete
priority: HIGH
complexity: High
estimated_effort: 2-3 days
dependencies: 
 - "[[19_unified_token_model.md]]"
related_backlog: 
  - "[[08_cli_editor_integration.md]]"
  - "[[04_template_parser_linter.md]]"
related_commit:
  - 659f208  # refactor(temple-linter): extract service classes from LSP server
---

# Refactor LSP Server into Service Classes

## Context

Current implementation in `temple-linter/src/temple_linter/lsp_server.py` (241 lines) violates Single Responsibility Principle:
- `lint_template()` function does 5 different things
- Difficult to test individual components
- Hard to extend with new linting capabilities
- Tight coupling between LSP protocol and linting logic

## Problem Statement

The LSP server mixes concerns:
1. LSP protocol handling
2. Template tokenization
3. Token cleaning
4. Base format linting
5. Diagnostic mapping

This makes the code hard to maintain, test, and extend.

## Context Files

- `temple-linter/src/temple_linter/lsp_server.py` - Current monolithic implementation
- `temple-linter/src/temple_linter/linter.py` - CLI entry point
- `temple-linter/src/temple_linter/diagnostics.py` - Diagnostic mapping logic

## Tasks

1. Create `services/` directory in `temple-linter/src/temple_linter/`
2. Extract `TemplateLintingService` class
3. Extract `TokenCleaningService` class  
4. Extract `BaseLintingService` class
5. Extract `DiagnosticMappingService` class
6. Create `LintOrchestrator` to coordinate services
7. Update tests to use new structure
8. Update LSP server to use orchestrator

## Dependencies

- **19_unified_token_model.md** (recommended) - Services should use consistent token representation

## Execution Order

Execute SECOND in Phase 2, after Work Item #19 (Unified Token Model). Execute before Work Item #18 (Format Detector Registry) to establish clean service architecture.

## Acceptance Criteria

- [ ] Each service has single responsibility
- [ ] Services are independently testable
- [ ] LSP server code is < 200 lines
- [ ] All existing tests pass
- [ ] Add integration test for full workflow
- [ ] Services use dependency injection
- [ ] Clear interfaces between services

## LLM Agent Prompt

```
Refactor temple-linter LSP server following Single Responsibility Principle.

Context:
- Current implementation: temple-linter/src/temple_linter/lsp_server.py (241 lines)
- lint_template() function does 5 different things
- Hard to test, hard to extend

Task:
1. Create temple-linter/src/temple_linter/services/ directory
2. Extract 5 service classes:
   - TemplateLintingService: Orchestrates linting workflow
   - TokenCleaningService: Removes template tokens
   - BaseLintingService: Detects format and delegates to base linters
   - DiagnosticMappingService: Maps diagnostics between cleaned and original
   - LintOrchestrator: Coordinates all services
3. Each service should be < 100 lines with clear interface
4. Update lsp_server.py to use LintOrchestrator
5. Ensure all existing tests pass
6. Add unit tests for each service

Constraints:
- Maintain exact same LSP protocol behavior
- Don't break VS Code extension integration
- Follow existing error handling patterns
- Use type hints throughout
- Services should accept dependencies via __init__
```

## Expected Outcomes

- Cleaner separation of concerns
- Easier to test individual components
- Simpler to add new linting capabilities
- LSP server becomes thin protocol adapter
- Services can be reused outside LSP context

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) Section 3.1: Single Responsibility Principle
- [temple-linter/README.md](../temple-linter/README.md)
