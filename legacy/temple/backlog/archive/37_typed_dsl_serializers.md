---
title: "37_typed_dsl_serializers"
status: complete
priority: High
complexity: Medium
estimated_effort: 2 weeks
actual_effort: 1 day
completed_date: 2026-01-09
related_commit:
  - 06366df  # test: reorganize compiler tests into functional groupings (ADR-002 Phase 3)
  - 8a7ab8f  # feat(typed-ast): canonicalize AST attrs; update type checker and serializers; update tests (backlog/35_typed_dsl_type_system.md, backlog/37_typed_dsl_serializers.md)
  - 7b8f125  # MISSING-COMMIT: feat(compiler): implement multi-format serializers for JSON, Markdown, HTML, YAML
test_results: 73 tests passing
dependencies:
  - [[34_typed_dsl_parser.md]] ✅
  - [[35_typed_dsl_type_system.md]] ✅
  - [[36_typed_dsl_diagnostics.md]] ✅
related_backlog: []
related_spike:
  - archive/30_typed_dsl_prototype.md (reference implementation)

notes: |
  Item 37 is the final MVP component; integration and future epics (validation, query language, user functions) documented in archive/33_decision_snapshot.md
---

# 37 — Typed DSL: Multi-Format Serializers

Goal
----
Implement production-quality serializers that convert type-checked AST + input data into formatted output (JSON, Markdown, HTML, YAML, TOML), respecting type annotations and producing valid output.

Deliverables
----------
- `temple/src/temple/compiler/serializers/base.py` — abstract serializer interface
- `temple/src/temple/compiler/serializers/json_serializer.py` — JSON output
- `temple/src/temple/compiler/serializers/markdown_serializer.py` — Markdown output
- `temple/src/temple/compiler/serializers/html_serializer.py` — HTML output
- `temple/src/temple/compiler/serializers/yaml_serializer.py` — YAML output (optional)
- Per-serializer test suites + example templates
- Documentation: Serializer API and per-format reference

Acceptance Criteria
------------------
- Serializers produce valid output for their target format (verified by external tools)
- Type coercion follows schema (e.g., number → string with format)
- Special characters properly escaped per format
- Performance: Serialize 1MB AST in <500ms for any format
- Test coverage ≥ 80% per serializer

Serializer Features
-------------------
- **Expression Evaluation**: Resolve template variables against input data
- **Control Flow**: Execute if/for blocks, conditionally render content
- **Includes**: Load and inline external templates
- **Type Coercion**: Convert values per schema (respects constraints, enums, formats)
- **Format-Specific Features**:
  - JSON: Compact/pretty printing, number handling (int vs float)
  - Markdown: Heading levels, list nesting, code blocks
  - HTML: Tag generation, attribute escaping, void elements
  - YAML: Block/flow styles, indentation, special scalars

Tasks
-----
1. Design and implement abstract Serializer interface (evaluate, render, format)
2. Implement JSON serializer (numbers, strings, nesting, null handling)
3. Implement Markdown serializer (headings, lists, inline formatting, code)
4. Implement HTML serializer (tags, attributes, escaping, void elements)
5. Implement YAML serializer (block/flow styles, anchors, references)
6. Build per-format validators (schema against output format rules)
7. Add comprehensive test suite (edge cases, special values, format compliance)
8. Write serializer API documentation + format-specific notes

Notes
-----
- **Reference**: Spike 30 serializers provide starting point
- **Type Safety**: Use type annotations to guide serialization (e.g., date → ISO 8601)
- **Extensibility**: Serializer interface allows custom formats (protobuf, binary, etc.)
- **Format Detection**: Auto-detect output format from file extension or explicit param
- **Streaming**: Consider streaming output for large templates (future optimization)
