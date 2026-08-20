---
title: "42_integrate_temple_core_dependency"
status: complete
priority: High
complexity: Low
estimated_effort: 2 hours
actual_effort: 30 minutes
completed_date: 2026-01-15
related_commit:
  - c3119b7  # feat(temple-linter): integrate temple core dependency (#42)
test_results: 42 tests passing
dependencies:
  - [[archive/34_typed_dsl_parser.md]] ✅
  - [[archive/35_typed_dsl_type_system.md]] ✅
  - [[archive/36_typed_dsl_diagnostics.md]] ✅
  - [[archive/37_typed_dsl_serializers.md]] ✅
related_backlog: []
related_spike: []

notes: |
  First step in temple-linter integration - establishes dependency on temple core package.
  Completed faster than estimated due to requirements.txt already having temple dependency.
---

## Goal

Properly integrate temple core package as a dependency in temple-linter, enabling access to parser, type checker, diagnostics, and serialization APIs.

## Background

Currently, temple-linter only imports `temple.template_tokenizer` for basic token stripping. The linter needs full access to temple core's compiler infrastructure to provide comprehensive template validation and diagnostics.

## Tasks

### 1. Update pyproject.toml Dependency
- Add `temple>=0.1.0` to dependencies array in `pyproject.toml`
- Ensure temple is installed in editable mode for development: `pip install -e ../temple`
- Verify dependency resolution works correctly

### 2. Update Package Imports
Update `temple_linter/__init__.py` to expose core temple types:
```python
# Re-export commonly used temple core types
from temple.compiler import (
    TypedTemplateParser,
    TypeChecker,
    Diagnostic,
    DiagnosticSeverity,
    Schema,
    SchemaParser,
)
```

### 3. Update requirements.txt
Ensure `requirements.txt` includes temple for CI/CD:
```
temple>=0.1.0
pygls>=1.0.0
```

### 4. Verify Import Paths
Test that all temple core modules are accessible:
- `temple.compiler.parser`
- `temple.compiler.type_checker`
- `temple.compiler.diagnostics`
- `temple.compiler.schema`
- `temple.compiler.serializers`

### 5. Update Development Setup Documentation
Update `temple-linter/README.md` with:
- Installation steps for temple core dependency
- Development setup instructions (editable install)
- Import examples for common temple core APIs

## Acceptance Criteria

- ✓ `pyproject.toml` includes temple dependency
- ✓ `pip install -e .` succeeds without errors
- ✓ All temple core imports work in temple_linter modules
- ✓ README includes setup instructions with temple core dependency
- ✓ CI/CD can install and test with temple core

## Testing

```bash
# Install temple core first
cd temple && pip install -e .

# Install temple-linter with temple dependency
cd temple-linter && pip install -e .

# Verify imports work
python -c "from temple_linter import TypedTemplateParser, Diagnostic"
```

## Implementation Notes

- Temple core must be installed before temple-linter
- Use editable installs (`-e`) for development to see live changes
- Consider adding temple as a git submodule if not using monorepo structure
- May need to update Python version requirements to match temple core (>=3.8)

## Related Work

- Backlog #34: Typed DSL Parser (provides parser API)
- Backlog #35: Typed DSL Type System (provides type checker)
- Backlog #36: Typed DSL Diagnostics (provides diagnostic system)
- Backlog #37: Typed DSL Serializers (provides serialization APIs)
