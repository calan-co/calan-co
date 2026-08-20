---
title: "ADR-002 Phase 3: Reorganize Test Structure"
id: 50
status: completed
related_commit:
  - 06366df  # test: reorganize compiler tests into functional groupings (ADR-002 Phase 3)
dependencies:
  - "[[49_adr_002_phase_2_consolidate_imports.md]]"
related_backlog:
  - "[[51_adr_002_phase_4_remove_redundant.md]]"
estimated_hours: 2
priority: high
related_backlog:
  - "[[51_adr_002_phase_4_remove_redundant_code.md]]"
estimated_hours: 2
priority: high
---

## Goal
Reorganize compiler tests into functional groupings per ADR-002 Phase 3, preserving 176 unique tests covering type system, serializers, schema validation, and error handling.

## Work Items
1. Create `temple/tests/types/` directory with 3 test files (71 tests total):
   - test_types.py (38 tests)
   - test_type_checker.py (16 tests)
   - test_schema.py (17 tests)

2. Create `temple/tests/serializers/` directory with 5 test files (73 tests total):
   - test_serializers_base.py (10 tests)
   - test_serializers_json.py (14 tests)
   - test_serializers_yaml.py (19 tests)
   - test_serializers_html.py (15 tests)
   - test_serializers_markdown.py (15 tests)

3. Move error handling tests to root test directory:
   - test_error_formatter.py (14 tests)
   - test_source_map.py (13 tests)

4. Move integration tests to root test directory:
   - test_integration_pipeline.py (5 tests)

5. Move diagnostics tests to root test directory:
   - test_diagnostics.py (new location)

6. Update all test imports:
   - `temple.compiler.ast_nodes` → `temple.typed_ast`
   - `temple.compiler.diagnostics` → `temple.diagnostics`
   - Position tracking: `SourceRange(Position(...), Position(...))` → `start=(line, col)`

## Acceptance Criteria
- All 176 unique tests migrated to new locations
- Test imports updated to use consolidated modules
- All tests executable from new locations
- Test discovery works correctly: `pytest temple/tests/types/ temple/tests/serializers/`
- 48 redundant tests identified and ready for deletion (test_parser.py, test_diagnostics.py)

## Notes
Part of ADR-002 Phase 3. Creates logical organization by functionality (types, serializers, error handling, integration) rather than source location. Must be completed before Phase 4 (removal of redundant modules).
