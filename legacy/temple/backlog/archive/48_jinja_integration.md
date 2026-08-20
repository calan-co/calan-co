---
title: Jinja2 Filters Integration
id: 48
status: proposed
related_commit:
  - 035d45c  # docs(adr): document parser consolidation architecture decision (ADR-002)
dependencies:
  - "[[19_unified_token_model.md]]"
  - "[[37_typed_dsl_serializers.md]]"
related_backlog:
  - "[[38_integration_and_e2e_tests.md]]"
estimated_hours: 24
priority: high
---

## Goal

Add optional, safe filter support (Jinja2-style) to Temple so templates can use `selectattr`, `map`, `join`, and similar filters while retaining Temple's typed parsing, AST-based validation, and diagnostics.

## Overview

- Preserve Temple's core pipeline: Lark parser → Typed AST → Type checking → Typed renderer.
- Layer filter evaluation on top of evaluated Python values instead of handing off entire templates to Jinja.
- Provide an adapter path that uses either a small built-in filter engine or a restricted Jinja `Environment` for extra filters.

## Approach Options

1) Adapter Mode (recommended)
   - Extend `Expression` AST nodes to carry a `filters` list.
   - Implement a `FilterAdapter` that applies filters to Python values after expression evaluation.
   - Optionally back `FilterAdapter` with a restricted `jinja2.Environment` configured with a whitelist.

2) Preprocess Mode
   - Translate filter expressions into Jinja snippets evaluated off-line, then insert results back into context/AST.
   - Harder to map diagnostics to original template positions.

3) Full Jinja Embedding (not recommended)
   - Delegate evaluation to Jinja for expressions or whole templates; Temple retains only validation.
   - Loses typed AST benefits and fine-grained diagnostics.

## Security & Safety

- Use `SandboxedEnvironment` or a restricted `Environment` with whitelisted filters.
- Disable or override filters that allow code execution.
- Wrap filter runtime errors with Temple source ranges for diagnostics.

## Diagnostics & Mapping

- Keep source positions on `Expression` nodes.
- When applying filters, catch exceptions and return diagnostics referencing the original expression start/end.

---

## Implementation Analysis

### Required Syntax Support

#### 1. List Literals (`["Added", "Changed"]`)

**Grammar Changes** (`typed_grammar.lark`):
```lark
expression: OPEN_EXPR | list_literal
list_literal: "[" [value ("," value)*] "]"
value: STRING | NUMBER | NAME_PATH
```

**AST Changes** (`typed_ast.py`):
```python
class ListLiteral(Node):
    def __init__(self, items: List[Any]):
        self.items = items
    
    def evaluate(self, context, includes=None, path="", mapping=None):
        return self.items
```

**Complexity**: Low-Medium (2-4 hours)

#### 2. `{% set %}` Statement (Variable Assignment)

**Grammar Changes**:
```lark
block: (text | expression | if_block | for_block | include | set_statement)*
set_statement: OPEN_SET
OPEN_SET: /\{\%[^%]*set[^%]*\%\}/
```

**AST Changes**:
```python
class Set(Node):
    def __init__(self, var_name: str, value_expr: str, start=None):
        super().__init__(start)
        self.var_name = var_name
        self.value_expr = value_expr
    
    def evaluate(self, context, includes=None, path="", mapping=None):
        value = Expression(self.value_expr).evaluate(context, includes, path, mapping)
        context[self.var_name] = value
        return None
```

**Challenges**:
- Scope management (local vs global)
- Context mutability during rendering
- Interaction with `{% for %}` loop contexts

**Complexity**: Medium (4-6 hours)

#### 3. Jinja2 Filters (`| selectattr("type", "equalto", value)`)

**Filter Engine Implementation** (`filters.py`):
```python
class FilterEngine:
    def __init__(self):
        self.filters = {
            'selectattr': self._selectattr,
            'rejectattr': self._rejectattr,
            'map': self._map,
            'join': self._join,
            'default': self._default,
        }
    
    def _selectattr(self, items, attr_name, test='truthy', value=None):
        result = []
        for item in items:
            attr_value = self._get_attr(item, attr_name)
            if test == 'equalto' and attr_value == value:
                result.append(item)
            elif test == 'truthy' and attr_value:
                result.append(item)
        return result
    
    def apply(self, value, filter_name, args):
        if filter_name not in self.filters:
            raise ValueError(f"Unknown filter: {filter_name}")
        return self.filters[filter_name](value, *args)
```

**Expression Changes**:
```python
class Expression(Node):
    def __init__(self, expr: str, filters: List[Tuple[str, List[Any]]] = None):
        self.expr = expr
        self.filters = filters or []
    
    def evaluate(self, context, includes=None, path="", mapping=None):
        value = self._resolve(context)
        filter_engine = FilterEngine()
        for filter_name, args in self.filters:
            value = filter_engine.apply(value, filter_name, args)
        return value
```

**Complexity**: High (12-20 hours)
- Parser complexity for filter arguments
- Multiple Jinja2-compatible filters
- Edge cases (nested filters, mixed argument types)

### Related Issue: `{% elif %}` Grammar Bug

**Current Problem**: Grammar doesn't support `{% elif %}` after nested blocks.

**Fix** (`typed_grammar.lark`):
```lark
// Current:
if_block: OPEN_IF block (OPEN_ELSE block)? OPEN_end

// Fixed:
if_block: OPEN_IF block elif_chain? (OPEN_ELSE block)? OPEN_end
elif_chain: OPEN_ELIF block (OPEN_ELIF block)*
OPEN_ELIF: /\{\%[^%]*elif[^%]*\%\}/
```

**Complexity**: Low-Medium (2-4 hours) - This should be fixed first as it's a bug, not a feature.

### Total Implementation Effort
- **Elif fix**: 2-4 hours (bug fix, high priority)
- **List literals**: 2-4 hours (quick value)
- **Set statement**: 4-6 hours (core feature)
- **Jinja2 filters**: 12-20 hours (advanced feature)
- **Total**: 20-34 hours

### Recommended Phases

**Phase 1 - Bug Fix** (2-4 hours):
1. Fix `{% elif %}` grammar - unblocks large templates

**Phase 2 - Core Features** (6-10 hours):
2. Implement list literals
3. Implement `{% set %}` statement

**Phase 3 - Advanced** (12-20 hours):
4. Implement filter engine with core filters (selectattr, map, join)
5. Add additional filters incrementally

**Alternative**: Use Jinja2 library for filter support (trade-off: external dependency vs implementation time)

## Incremental Implementation Plan

1. Parse: Add lightweight grammar support for filter syntax (e.g., `| name(arg, ...)`) and include `filters` in `Expression` AST.
2. Adapter: Implement `FilterAdapter` with a small set of filters (`selectattr`, `map`, `join`, `default`) and unit tests.
3. Wire-in: Apply filters during `evaluate_ast` after base evaluation of expressions.
4. Tests: Add unit and integration tests (use `examples/templates/bench/real_medium.md.tmpl`).
5. Swap-in: Optionally add a `JINJA_FILTERS_ENABLED` config that swaps `FilterAdapter` internals with a restricted `jinja2.Environment`.

## Estimated Effort

- Parsing & AST: 4-6 hours
- FilterAdapter core (selectattr + basic): 6-10 hours
- Optional Jinja swap-in: 3-6 hours
- Tests & diagnostics: 3-5 hours

## Acceptance Criteria

- Expressions without filters remain unchanged.
- `selectattr` and basic filters function and preserve diagnostics.
- Jinja integration is behind a configurable flag.

## Notes

- Adapter Mode minimizes surface area and keeps Temple's typed features intact.
- Consider community demand before implementing the full Jinja feature set.
