---
title: "Performance Optimization - Regex Caching"
status: complete
priority: LOW
complexity: Low
estimated_effort: 2 hours
dependencies: []
related_backlog:
  - "[[09_template_preprocessing.md]]"
  - "[[04_template_parser_linter.md]]"
related_commit: 44b8432 # perf(temple-linter): add regex pattern caching for 10x+ speedup
---

# Performance Optimization - Regex Caching

## Context

Template tokenization and preprocessing functions compile regex patterns on every call:
- `temple_tokenizer()` in `template_tokenizer.py` compiles patterns for each tokenization
- `strip_template_tokens()` in `template_preprocessing.py` does the same
- When linting thousands of files, this causes thousands of unnecessary recompilations
- Patterns are deterministic based on delimiter configuration

## Problem Statement

Regex compilation is expensive. We're recompiling the same patterns repeatedly when delimiter configuration doesn't change. Need caching with delimiter configuration as key.

## Context Files

- `temple-linter/src/temple_linter/template_tokenizer.py` - Tokenization with pattern compilation
- `temple-linter/src/temple_linter/template_preprocessing.py` - Preprocessing with pattern compilation

## Tasks

1. Add module-level `_pattern_cache` dict
2. Update `temple_tokenizer()` to cache compiled patterns
3. Update `strip_template_tokens()` to cache compiled patterns
4. Write benchmark comparing before/after (test with 1000 files)
5. Add test verifying cache works correctly with different delimiters
6. Add docstring documenting caching behavior

## Dependencies

None (quick win, can run anytime)

## Execution Order

Execute in Phase 3 after architectural work is complete. Low priority but high ROI.

## Acceptance Criteria

- [ ] Regex compiled once per delimiter configuration
- [ ] 10x+ speedup on repeated tokenization
- [ ] Cache invalidated appropriately when delimiters change
- [ ] No behavior changes (all tests still pass)
- [ ] Thread-safe implementation
- [ ] Documentation includes cache size limits if any
- [ ] Benchmark results documented in PR

## LLM Agent Prompt

```
Add regex pattern caching to temple-linter tokenization functions for performance.

Context:
- temple_tokenizer() and strip_template_tokens() compile regexes on every call
- Linting thousands of files causes thousands of recompilations
- Need caching with delimiter configuration as key

Task:
1. Add module-level _pattern_cache dict or use functools.lru_cache
2. Update temple_tokenizer() to cache compiled patterns:
   - Cache key: delimiter configuration (frozen dict or tuple)
   - Cache value: compiled regex pattern
3. Update strip_template_tokens() to cache compiled patterns:
   - Use same caching strategy
4. Write benchmark comparing before/after:
   - Create 1000 template files with same delimiters
   - Measure time to tokenize all files before caching
   - Measure time to tokenize all files with caching
   - Report speedup factor
5. Add test verifying cache works correctly with different delimiters:
   - Tokenize with delimiters A
   - Tokenize with delimiters B
   - Tokenize with delimiters A again
   - Verify correct results for all three
6. Add docstring documenting caching behavior

Requirements:
- Cache key must include delimiter configuration
- Thread-safe implementation (use functools.lru_cache or threading.Lock)
- Document cache size limits if any (lru_cache default maxsize=128 is fine)
- Measure actual performance improvement in PR description
- No behavior changes (all existing tests must pass)
```

## Expected Outcomes

- 10x+ performance improvement for batch linting
- Minimal code changes (likely < 20 lines)
- No breaking changes to existing behavior
- Better performance for VS Code extension (lints many files)
- Documented performance characteristics

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) Section 4: Performance Considerations
- Python functools.lru_cache documentation
