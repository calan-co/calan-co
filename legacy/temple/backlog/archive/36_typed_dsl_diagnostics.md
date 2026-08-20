---
title: "36_typed_dsl_diagnostics"
status: complete
priority: High
complexity: Medium
estimated_effort: 1 week
actual_effort: 1 day
completed_date: 2026-01-09
related_commit:
  - be64512  # refactor(compiler): consolidate to single parser architecture (ADR-002 Phase 2)
  - d391a99  # MISSING-COMMIT: feat(compiler): implement error diagnostics, source mapping, and error formatting
test_results: 47 tests passing
dependencies:
  - [[34_typed_dsl_parser.md]] ✅
  - [[35_typed_dsl_type_system.md]] ✅
related_backlog:
  - [[37_typed_dsl_serializers.md]]
---

# 36 — Typed DSL: Error Diagnostics & Source Mapping

Goal
----
Build a comprehensive error reporting system that maps all template compilation errors back to their source locations, enabling precise IDE feedback and actionable error messages.

Deliverables
----------
- `temple/src/temple/compiler/diagnostics.py` — diagnostic types (errors, warnings, hints)
- `temple/src/temple/compiler/source_map.py` — position tracking and error ↔ source mapping
- `temple/src/temple/compiler/error_formatter.py` — human-readable error messages with context
- LSP diagnostic bridge (for VS Code integration)
- Unit tests for error mapping and message quality
- Documentation: Diagnostic API and error reference

Acceptance Criteria
------------------
- All syntax errors include (line, col) and source snippet
- Type errors include variable/path that failed and suggested fix
- Error messages are actionable and suggest corrections
- Diagnostic severity levels (error, warning, info)
- Support for error suppression comments
- Performance: Format 100 errors in <10ms

Error Categories
-----------------
- **Syntax Errors**: Unexpected token, unclosed block, malformed expression
- **Type Errors**: Type mismatch, undefined variable, missing schema
- **Semantic Errors**: Circular includes, duplicate block names, invalid operations
- **Data Errors**: Query path doesn't exist in schema, missing required field
- **Warning**: Shadowed variables, unused includes, deprecated syntax

Tasks
-----
1. Design diagnostic model (position, message, severity, suggestions, context)
2. Implement source mapping (AST ↔ source positions + source snapshots)
3. Build error formatter with context display (show 2-3 lines of source)
4. Implement diagnostic collectors (parser, type checker, semantic analyzer)
5. Add suppression comments syntax (`{# @suppress TYPE_ERROR #}`)
6. Build LSP bridge for IDE integration
7. Add comprehensive test suite for error formatting
8. Document error types and troubleshooting guide

Notes
-----
- **Position Tracking**: Every error must preserve (line, col) through compilation pipeline
- **Context**: Show source snippet + pointer to exact error location
- **Suggestions**: Type mismatch → suggest expected type; undefined var → suggest nearest match
- **LSP Integration**: Use standard LSP Diagnostic type for editor compatibility
