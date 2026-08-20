---
title: "Optimize Base Linting Diagnostics"
status: completed
priority: LOW
complexity: Low
estimated_effort: 1 day
dependencies: []
related_backlog:
  - "[[05_output_format_linters.md]]"
  - "[[23_refactor_tokenizer_to_core.md]]"
related_commit: 
  - 3b913ab  # feat(linter): strip temple suffix from URIs in base linting request
  - cd69df9  # feat(linter): optimize base linting with format hints and type safety
---

# 24: Optimize Base Linting Diagnostics

## Overview
Enhance base format linting with two optimizations:
1. Pass detected format hint to VS Code extension for better fallback handling
2. Coerce dict diagnostics into LSP Diagnostic objects for type safety

## Problem
- When filename is ambiguous (e.g., `data.tmpl` → `data`), VS Code has no format hint
- Protocol responses may return raw dicts instead of typed Diagnostic objects, causing downstream failures

## Solution

### Enhancement 1: Add `detectedFormat` hint
Include detected format in request payload:
```python
lc.protocol.send_request("temple/requestBaseDiagnostics", {
    "uri": target_uri,
    "content": cleaned_text,
    "detectedFormat": detected_format,  # Add this
})
```

VS Code extension can use this as a fallback when filename is unknown.

### Enhancement 2: Coerce diagnostics to LSP type
Accept both Diagnostic objects and raw dicts:
```python
for d in diagnostics:
    if isinstance(d, Diagnostic):
        valid_diagnostics.append(d)
    elif isinstance(d, dict):
        try:
            valid_diagnostics.append(Diagnostic(**d))
        except Exception:
            continue
```

Ensures downstream code always receives typed LSP objects.

## Acceptance Criteria
- ✅ `detectedFormat` included in request payload
- ✅ Dict-to-Diagnostic coercion with error handling
- ✅ All tests pass (42+)
- ✅ No breaking changes to public API
