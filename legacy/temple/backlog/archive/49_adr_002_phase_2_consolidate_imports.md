---
title: "ADR-002 Phase 2: Consolidate Compiler Imports"
id: 49
status: completed
related_commit:
  - be64512  # refactor(compiler): consolidate to single parser architecture (ADR-002 Phase 2)
dependencies:
  - "[[002-consolidate-to-single-parser.md]]"
related_backlog:
  - "[[50_adr_002_phase_3_reorganize_tests.md]]"
estimated_hours: 2
priority: high
related_backlog:
  - "[[50_adr_002_phase_3_reorganize_tests.md]]"
  - "[[51_adr_002_phase_4_remove_redundant_code.md]]"
estimated_hours: 2
priority: high
---

## Goal
Update all compiler modules to use consolidated parser infrastructure (lark_parser, typed_ast, diagnostics) per ADR-002 Phase 2.

## Work Items
1. Update `compiler/type_checker.py` to import from `temple.typed_ast` and `temple.lark_parser`
2. Update `compiler/error_formatter.py` to import from `temple.diagnostics`
3. Update `compiler/source_map.py` to import from `temple.diagnostics`
4. Update `compiler/type_errors.py` to import from `temple.diagnostics`
5. Update all serializers (base, json, yaml, html, markdown) to import from `temple.typed_ast`
6. Update `compiler/__init__.py` exports to use consolidated modules
7. Create `temple/diagnostics.py` as unified diagnostic system
8. Update `temple/__init__.py` to export unified diagnostics

## Acceptance Criteria
- All imports reference consolidated modules (temple.lark_parser, temple.typed_ast, temple.diagnostics)
- No imports from deleted modules (compiler.parser, compiler.tokenizer, compiler.diagnostics, compiler.ast_nodes)
- compiler/__init__.py exports working correctly: `from temple.compiler import *`
- All updated modules are syntactically valid and importable

## Notes
Part of ADR-002: Parser consolidation strategy. Must be completed before Phase 3 (test reorganization).
