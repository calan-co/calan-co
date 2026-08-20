---
title: "ADR-002 Phase 4: Remove Redundant Parser Modules"
id: 51
status: completed
related_commit:
  - 74e174c  # refactor: remove redundant parser implementation (ADR-002 Phase 4)
dependencies:
  - "[[50_adr_002_phase_3_reorganize_tests.md]]"
estimated_hours: 1
priority: high
estimated_hours: 1
priority: high
---

## Goal
Complete parser consolidation by removing redundant implementations per ADR-002 Phase 4.

## Work Items
1. Delete `temple/src/temple/compiler/parser.py` (replaced by lark_parser)
2. Delete `temple/src/temple/compiler/tokenizer.py` (replaced by template_tokenizer)
3. Delete `temple/src/temple/compiler/diagnostics.py` (replaced by temple.diagnostics)
4. Delete `temple/src/temple/compiler/ast_nodes.py` (replaced by typed_ast)
5. Delete 48 redundant tests:
   - `temple/tests/compiler/test_parser.py` (28 tests)
   - `temple/tests/compiler/test_diagnostics.py` (20 tests)
6. Delete `temple/tests/compiler/` directory (empty after test migration)
7. Delete `temple/tests/integration/` directory (empty after test migration)
8. Verify all imports still working: `from temple.compiler import *`

## Acceptance Criteria
- All 4 redundant modules deleted
- All redundant test files deleted
- All empty directories removed
- Test suite runs successfully: `pytest temple/tests/ temple-linter/tests/`
- Expected result: 214 passing tests (up from 114)
- No import errors from remaining code
- Only unique, non-redundant code remains

## Notes
Part of ADR-002 Phase 4 - final cleanup. Achieves goal of single parser architecture with Lark as authoritative implementation while preserving all unique compiler functionality (type system, serializers, schema validation).

After completion:
- `temple/src/temple/lark_parser.py` - Single authoritative parser
- `temple/src/temple/template_tokenizer.py` - Single tokenizer with caching
- `temple/src/temple/typed_ast.py` - Single AST implementation
- `temple/src/temple/diagnostics.py` - Single diagnostic system
- `temple/src/temple/compiler/` - Contains only unique modules (types, schema, serializers, error formatting, source mapping)
