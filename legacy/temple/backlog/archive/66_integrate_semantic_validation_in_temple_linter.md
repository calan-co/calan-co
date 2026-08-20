---
title: "Integrate Semantic Validation in temple-linter"
id: 66
status: completed
state_reason: success
priority: high
complexity: high
estimated_hours: 20
actual_hours: 5
completed_date: 2026-02-13
related_commit:
  - 2fe2810  # feat(temple-linter): integrate semantic diagnostics
test_results: "temple-linter semantic suites: 32 tests pass (test_semantic_linter, test_linter, test_integration). Ruff passes on updated linter/orchestrator files."
dependencies:
  - "[[65_complete_temple_native_language_core.md]]"
  - "[[44_implement_semantic_validation.md]]"
related_backlog:
  - "44_implement_semantic_validation.md"
related_spike: []
notes: |
  Moves temple-linter from syntax-only diagnostics to schema-aware semantic diagnostics.
  Extended TemplateLinter API to accept semantic context/schema and emit merged syntax+semantic diagnostics.
  Added semantic short-circuit behavior when syntax errors are present.
  Wired LintOrchestrator to forward semantic inputs into template linting.
  Added integration tests for missing property, type mismatch, syntax short-circuit, and orchestrator pass-through.
---

## Goal

Integrate temple core type-checking and schema-aware validation into `temple-linter` so users receive semantic diagnostics (undefined variables, missing properties, type mismatches) in editor and CLI flows.

## Background

Current linter behavior is syntax-centric. Semantic validation work is designed in backlog but not wired into the active linter pipeline.

## Tasks

1. **Extend TemplateLinter API**
   - Accept schema/context parameters
   - Return merged syntax + semantic diagnostics

2. **Add schema loading path for linter context**
   - Implement minimal schema input/discovery path for MVP
   - Support explicit schema injection in tests and integration points

3. **Integrate TypeChecker into lint orchestration**
   - Run semantic validation on parse-success paths
   - Surface semantic codes/messages with source ranges

4. **Add semantic test coverage**
   - Undefined variable, property, and type mismatch cases
   - Ensure diagnostics remain stable with mixed syntax+semantic errors

## Deliverables

- Updated `temple-linter/src/temple_linter/linter.py`
- Supporting schema/semantic integration modules as needed
- Expanded linter/integration tests for semantic diagnostics

## Acceptance Criteria

- [x] Semantic diagnostics are emitted for schema-aware template errors
- [x] Syntax errors still report correctly and do not regress
- [x] Diagnostic ranges map correctly for semantic findings
- [x] New semantic integration tests pass
