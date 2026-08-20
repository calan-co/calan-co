---
title: "Refactor: Move Tokenizer to Temple Core"
status: complete
priority: CRITICAL
complexity: High
estimated_effort: 1 day
dependencies: []
related_backlog:
  - "[[19_unified_token_model.md]]"
  - "[[20_regex_caching.md]]"
completed_date: 2026-01-08
related_commit:
  - 9e38e7b  # refactor(core)!: move tokenizer to temple core engine
---

# Refactor: Move Tokenizer to Temple Core

## Context

Architecture was inverted: `temple-linter` owned the authoritative tokenizer while `temple` (the core engine) had only reference implementations. This violated proper dependency flow and prevented `temple` from fulfilling its role as the core templating engine.

## Problem Statement

- `temple/` was marked as "specification phase" but should be the production core engine
- `temple-linter/src/temple_linter/template_tokenizer.py` was the real implementation
- `temple/src/parser.py` was a "reference implementation" with duplicate logic
- Dependency flow was backwards: linter shouldn't own core functionality
- Prevented proper layering: core → linting → editor integration

## Solution

Moved tokenizer to `temple/` as authoritative implementation:
1. Used `git mv` to preserve commit history
2. Moved `template_tokenizer.py` → `temple/src/temple/template_tokenizer.py`
3. Moved `test_tokenizer.py` → `temple/tests/test_tokenizer.py`
4. Created `temple/src/temple/__init__.py` package exports
5. Updated `temple-linter` to depend on `temple>=0.1.0`
6. Updated all imports: `temple_linter.template_tokenizer` → `temple.template_tokenizer`
7. Removed old `temple/src/parser.py` and `temple/src/linter.py`
8. Updated documentation across all components

## Files Changed

### Moved (with git history preserved)
- `temple-linter/src/temple_linter/template_tokenizer.py` → `temple/src/temple/template_tokenizer.py`
- `temple-linter/tests/test_tokenizer.py` → `temple/tests/test_tokenizer.py`

### Created
- `temple/src/temple/__init__.py` - Package initialization

### Updated
- `temple/pyproject.toml` - Updated description, added pytest config
- `temple/README.md` - Marked "Active Development", added usage examples
- `temple-linter/pyproject.toml` - No changes needed (dependencies already correct)
- `temple-linter/requirements.txt` - Added `temple>=0.1.0` dependency
- `temple-linter/src/temple_linter/services/diagnostic_mapping_service.py` - Import from temple
- `temple-linter/src/temple_linter/services/token_cleaning_service.py` - Import from temple
- `temple-linter/README.md` - Updated dependencies and install order
- `.github/copilot-instructions.md` - Updated architecture descriptions
- `ARCHITECTURE_ANALYSIS.md` - Updated component roles, resolved critical issues

### Deleted
- `temple/src/parser.py` - Replaced by core tokenizer
- `temple/src/linter.py` - Replaced by core tokenizer

## Test Results

- **temple**: 10/10 tests passing
- **temple-linter**: 39/39 tests passing
- **vscode-temple-linter**: TypeScript compiles without errors

## Architecture After Refactor

```
temple (core tokenizer)
  ↓ depends on
temple-linter (linting using core)
  ↓ depends on
vscode-temple-linter (editor integration)
```

## Acceptance Criteria

- [x] Git history preserved using `git mv`
- [x] temple/ owns authoritative tokenizer
- [x] temple-linter imports from temple.template_tokenizer
- [x] All tests passing in both projects
- [x] Documentation updated to reflect new architecture
- [x] Proper dependency flow: core → linter → editor
- [x] No duplicate tokenizer code

## Commit Message

```
refactor(core)!: move tokenizer to temple core engine

BREAKING CHANGE: temple-linter now depends on temple>=0.1.0

- Move template_tokenizer.py to temple/src/temple/ (git mv, history preserved)
- Move test_tokenizer.py to temple/tests/ (git mv, history preserved)
- Create temple.template_tokenizer package with proper exports
- Update temple-linter to import from temple.template_tokenizer
- Remove old temple/src/parser.py (replaced by tokenizer)
- Update all documentation to reflect correct architecture

Architecture corrected:
  temple (core) → temple-linter (linting) → vscode-temple-linter (editor)

Tests: temple 10/10, temple-linter 39/39
```

## Impact

- **Users**: None (internal refactor)
- **Developers**: Must install `temple` before `temple-linter`
- **CI/CD**: Update build order if needed
- **Documentation**: Updated across all components

## Related Issues

Resolves architecture inversion identified in ARCHITECTURE_ANALYSIS.md:
- Priority 1: Critical - Architecture Refactored ✅
- Priority 2: Issue 2.1 - Unified Token Model ✅
