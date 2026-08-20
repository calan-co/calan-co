---
title: "33_decision_snapshot"
status: complete
completed_date: 2026-01-09
priority: Medium
complexity: Low
estimated_effort: 2 days
dependencies:
  - [[30_typed_dsl_prototype.md]]
related_backlog:
  - [[34_typed_dsl_parser.md]]
  - [[35_typed_dsl_type_system.md]]
  - [[36_typed_dsl_diagnostics.md]]
  - [[37_typed_dsl_serializers.md]]
---

# 33 — Decision Snapshot & Recommendation

Executive Summary
-----------------
After exploring three architectural approaches (typed AST, constraint-driven templates, and render-time validation), the team has selected **Typed Template Compiler** as the production path forward. The typed DSL spike (item 30) successfully validated the core concepts: AST-based compilation, schema-aware semantics, and target-neutral IR generation. Item 31 (constraint-driven) is archived as a lower-priority alternative. The production implementation will treat the spike as reference code and pursue a **greenfield implementation** emphasizing clean APIs, comprehensive error diagnostics, and extensibility.

Spike Outcomes
--------------

| Spike | Status | Key Deliverable | Outcome |
|-------|--------|-----------------|---------|
| **30 - Typed DSL** | ✅ Complete | AST nodes, Lark parser, semantics engine, schema checker, examples | Validates approach; prototype ready for reference |
| **31 - Constraints** | 🗂️ Archived | N/A (research spike) | Valid but lower priority; can revisit in future epics |

### Spike 30 Reference Artifacts
- **Code**: `temple/src/temple/typed_ast.py`, `lark_parser.py`, `typed_renderer.py`, `schema_checker.py`
- **Grammar**: `temple/src/temple/typed_grammar.lark`
- **Examples**: `examples/dsl_examples/` (8 template pairs + includes)
- **Tests**: `temple/tests/test_example_templates.py` (26 passed)

Recommendation
--------------

### Chosen Path: **Typed Template Compiler** (Greenfield Implementation)

**Rationale:**
1. **Validation**: Spike 30 proves AST + target-neutral IR approach works
2. **Extensibility**: Clean separation of concerns (parser → AST → semantics → serializers)
3. **Diagnostics**: Fine-grained error reporting with source mapping
4. **Flexibility**: Non-coupling to any single DSL syntax or base format

**Implementation Strategy:**
- Reference spike 30 for concepts and patterns
- Build production-grade parser (choose Lark or hand-rolled based on complexity)
- Implement complete type system with schema validation
- Rich error diagnostics tied to source positions
- Per-format serializers (JSON, Markdown, HTML, YAML/TOML as needed)

**Estimated Effort:**
- Parser & AST: **2 weeks**
- Type system & schema: **1.5 weeks**
- Diagnostics & error mapping: **1 week**
- Serializers (3-4 formats): **2 weeks**
- Integration & testing: **1.5 weeks**
- **Total MVP: ~8 weeks** (2 sprint cycle)

Known Risks & Mitigation
------------------------

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Parser complexity exceeds spike | High | Use Lark for stability; keep grammar minimal |
| Type system doesn't scale to all formats | Medium | Design incrementally; add formats on-demand |
| Diagnostics mapping breaks in refactors | Medium | Position tracking in AST from day one |
| Serializer proliferation | Low | Template + test suite per format; 3-4 core formats only |

Follow-up Work Items
--------------------

### Production Epics (Dependent on Item 33)

1. **Epic: Typed Template Compiler MVP** (Est. 8 weeks)
   - [[34_typed_dsl_parser.md]] — Parser & AST construction
   - [[35_typed_dsl_type_system.md]] — Type system & schema validation
   - [[36_typed_dsl_diagnostics.md]] — Error diagnostics with source mapping
   - [[37_typed_dsl_serializers.md]] — Multi-format serializers

2. **Epic: Template Validation & Linting** (Future, 4-6 weeks)
   - LSP server for typed templates
   - Real-time type checking in editor
   - Constraint checker (from spike 31 insights)

3. **Epic: Query Language & Data Binding** (Future, 3-4 weeks)
   - Advanced dot notation / JMESPath support
   - Runtime object model introspection
   - Query validation against schema

4. **Epic: User-Defined Functions & Composition** (Future, 2-3 weeks)
   - Function definitions within templates
   - Include/import mechanisms
   - Macro support

Next Steps (Immediate)
----------------------
1. Create production work items (34-37) based on this decision
2. Kick off item 34 (Parser & AST)
3. Establish pattern for weekly spike reviews during MVP development
