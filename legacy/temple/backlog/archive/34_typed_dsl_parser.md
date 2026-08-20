---
title: "34_typed_dsl_parser"
status: complete
priority: High
complexity: Medium
estimated_effort: 2 weeks
dependencies:
  - Architectural decision documented in archive/33_decision_snapshot.md
related_backlog:
  - [[35_typed_dsl_type_system.md]]
  - [[36_typed_dsl_diagnostics.md]]
related_spike: 
  - archive/30_typed_dsl_prototype.md (reference implementation)
related_commit:
  - 0ccdf09  # feat(compiler): implement typed DSL parser with AST and position tracking
  - 6c5c7f8  # docs(compiler): add progress summary and export walk_ast utility
---

# 34 — Typed DSL: Parser & AST Construction

Goal
----
Build a production-grade parser and AST representation for the typed template DSL, with robust position tracking for error diagnostics.

Deliverables
----------
- `temple/src/temple/compiler/parser.py` — tokenizer + parser (Lark-based or hand-rolled)
- `temple/src/temple/compiler/ast_nodes.py` — comprehensive AST node types with position tracking
- `temple/src/temple/compiler/ast_builder.py` — parser → AST transformation
- Comprehensive unit tests covering edge cases and error recovery
- Documentation: DSL syntax specification and grammar reference

Acceptance Criteria
------------------
- Parser handles all core DSL constructs (expressions, conditionals, loops, includes, blocks)
- Every AST node tracks source position (line, column) for error reporting
- Parser recovers gracefully from syntax errors
- Test coverage ≥ 90% for parser and AST modules
- Performance: Parse 1MB template in <100ms

Key Features
-----------
- **Tokenization**: Lexing with configurable delimiters (default: {% %}, {{ }}, {# #})
- **Error Recovery**: Partial parsing with helpful error messages
- **Position Tracking**: (line, col) tuples on every node for diagnostics mapping
- **Whitespace Handling**: Consistent whitespace stripping rules
- **Grammar**: Clear specification suitable for Lark + hand-written parser as fallback

Tasks
-----
1. Define comprehensive DSL grammar (Lark `.g` file or grammar doc)
2. Evaluate Lark vs. hand-rolled parser; choose based on grammar complexity
3. Implement tokenizer with position tracking
4. Implement parser with error recovery
5. Build AST node classes (Text, Expression, If, For, Include, Block, Array, Object, etc.)
6. Add comprehensive test suite (syntax, edge cases, error messages)
7. Document grammar and parsing strategy

Notes
-----
- **Reference**: Spike 30 prototype (`typed_grammar.lark`, `lark_parser.py`) provides starting point
- **Key Decision**: Position tracking is critical; build this in from day one
- **No semantic analysis**: Parser output is raw AST; type checking happens in item 35
