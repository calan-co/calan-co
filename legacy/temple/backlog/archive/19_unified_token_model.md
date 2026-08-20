---
title: "Unified Token Model"
status: complete
priority: MEDIUM
complexity: High
estimated_effort: 2 days
dependencies: []
related_backlog:
  - "[[01_define_dsl_syntax.md]]"
  - "[[04_template_parser_linter.md]]"
related_commit:
  - f72a34d  # feat(temple): unify token model with (line,col) tuples
---

# Unified Token Model

## Context

Temple core and temple-linter use different token representations:
- `temple/src/parser.py` uses `TemplateToken` with integer positions
- `temple-linter/src/temple_linter/template_tokenizer.py` uses `Token` with `(line, col)` tuple positions

This inconsistency:
- Creates confusion when reading code
- Makes it hard to share token processing logic
- Requires conversion when integrating components
- Unclear position semantics (0-indexed vs 1-indexed, line vs offset)

## Problem Statement

We need a canonical token model that both projects use. The model must support accurate position tracking for error reporting and diagnostic mapping.

## Context Files

- `temple/src/parser.py` - Core parser with TemplateToken
- `temple-linter/src/temple_linter/template_tokenizer.py` - Linter tokenizer with Token
- `temple-linter/src/temple_linter/diagnostics.py` - Uses token positions for mapping

## Tasks

1. Analyze both Token implementations and choose superior approach
2. Define canonical token model (recommend tuple positions for clarity)
3. Update `temple/src/parser.py` to match temple-linter if needed
4. OR update temple-linter to match temple if core model is superior
5. Ensure position tracking is consistent (choose 0-indexed or 1-indexed)
6. Update all tests in both projects
7. Document token model in `temple/docs/syntax_spec.md`
8. Add comment marking temple/src/ as "reference implementation matching temple-linter"

## Dependencies

None (foundational work)

## Execution Order

Execute FIRST in Phase 2 - other work items may depend on consistent token model.

## Acceptance Criteria

- [ ] Both projects use identical Token representation
- [ ] Position tracking is unambiguous (document 0-indexed vs 1-indexed)
- [ ] All tests pass in both projects
- [ ] Clear documentation of token structure
- [ ] Token supports multi-line content
- [ ] Token positions support range queries (start/end)
- [ ] Examples added to docs showing position calculation

## LLM Agent Prompt

```
Unify token models across temple and temple-linter for consistency.

Context:
- temple/src/parser.py uses TemplateToken with int positions
- temple-linter uses Token with (line, col) tuple positions
- Inconsistency creates confusion, hard to share code

Task:
1. Analyze both Token implementations:
   - temple/src/parser.py: TemplateToken class
   - temple-linter/src/temple_linter/template_tokenizer.py: Token class
2. Choose superior approach (recommend tuple positions for error reporting):
   - Tuple positions (line, col) are clearer for diagnostics
   - Support multi-line tokens with start_pos and end_pos
3. Update temple/src/parser.py to match temple-linter Token model:
   - Change TemplateToken to use (line, col) tuples
   - Update all position tracking logic
   - Update tests
4. Add clear documentation to temple/docs/syntax_spec.md:
   - Token structure
   - Position semantics (0-indexed or 1-indexed - choose consistently)
   - Examples of position calculation
5. Update all tests in both projects
6. Add comment in temple/src/ marking it as "reference implementation matching temple-linter"

Constraints:
- Maintain backward compatibility with existing temple-linter code
- Position tracking must support multi-line tokens
- Both line and column must be 0-indexed or 1-indexed (choose one, document clearly)
- Token must be serializable (for LSP communication)
```

## Expected Outcomes

- Single source of truth for token representation
- Easier to share code between projects
- Clearer error messages with consistent position reporting
- Simplified integration when temple-linter uses temple parser
- Documentation serves as reference for contributors

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) Section 2.4: Architectural Inconsistencies
- [temple/docs/syntax_spec.md](../temple/docs/syntax_spec.md) - Token DSL specification
- [temple-linter/README.md](../temple-linter/README.md)
