---
title: "Implement Format Detector Registry"
status: complete
priority: MEDIUM
complexity: Medium
estimated_effort: 1 day
dependencies:
  - "[[17_refactor_lsp_server.md]]"
related_backlog:
  - "[[10_base_format_detection.md]]"
  - "[[11_integrate_base_linters.md]]"
related_commit:
  - e40eec8  # feat(temple-linter): add format detector registry and tests
  - 6d06f33  # feat(temple-linter): add VS Code passthrough for unknown formats
---

# Implement Format Detector Registry

## Context

Current format detection in `temple-linter/src/temple_linter/base_format_linter.py` uses a giant if/elif chain in `detect_base_format()`:
- Violates Open/Closed Principle (must modify existing code to add formats)
- Hard to test individual format detectors
- No way to customize detection logic
- No priority mechanism for ambiguous cases

## Problem Statement

Adding support for new file formats requires modifying the core detection function. We need a pluggable system where format detectors can be registered independently.

## Context Files

- `temple-linter/src/temple_linter/base_format_linter.py` - Current if/elif implementation
- `temple-linter/tests/test_base_format_linter.py` - Existing tests

## Tasks

1. Define `FormatDetector` Protocol with `matches()` and `format_name()` methods
2. Create `FormatDetectorRegistry` class with `register()` and `detect()` methods
3. Implement detector classes:
   - `JsonDetector`
   - `YamlDetector`
   - `HtmlDetector`
   - `TomlDetector`
   - `XmlDetector`
   - `MarkdownDetector`
4. Update `detect_base_format()` to use registry
5. Add tests for each detector
6. Document how to add new format detectors in `temple-linter/docs/EXTENDING.md`

## Dependencies

- **17_refactor_lsp_server.md** (recommended) - Registry fits naturally into BaseLintingService

## Execution Order

Execute in Phase 3 after Work Item #17 (Refactor LSP Server) to benefit from cleaner service architecture. Can be implemented within the new BaseLintingService class.

## Acceptance Criteria

- [ ] Can add new formats without modifying existing code
- [ ] Each detector is independently testable
- [ ] Performance same or better than current implementation
- [ ] Documentation includes example of adding custom detector
- [ ] Registry supports priority ordering
- [ ] Detectors check both extension and content

## LLM Agent Prompt

```
Implement extensible format detection using Strategy pattern in temple-linter.

Context:
- Current: giant if/elif chain in base_format_linter.py detect_base_format()
- Problem: violates Open/Closed Principle, hard to extend
- Need: pluggable format detector system

Task:
1. Create FormatDetector Protocol with matches() and format_name() methods
   - matches(filename: str, content: str) -> float  # 0.0-1.0 confidence
   - format_name() -> str
2. Implement FormatDetectorRegistry with register() and detect() methods
   - register(detector: FormatDetector, priority: int = 0)
   - detect(filename: str, content: str) -> str
3. Create detector classes: JsonDetector, YamlDetector, HtmlDetector, etc.
   - Each checks extension AND content
   - Returns confidence score (0.0 = no match, 1.0 = certain)
4. Replace detect_base_format() body with FormatDetectorRegistry.detect()
5. Add comprehensive tests for each detector
6. Document extension mechanism in temple-linter/docs/EXTENDING.md

Requirements:
- Detectors should check both extension and content
- Registry should try detectors in priority order
- Default to 'txt' if no match or low confidence
- Performance: <1ms for typical files
- Allow custom detectors via plugin mechanism
```

## Expected Outcomes

- Easy to add new format support (just register new detector)
- Individual detectors are simple and testable
- Third-party extensions can add custom formats
- Clear separation between detection logic and usage
- Better handling of ambiguous cases (e.g., JSON vs JSONC)

## Related Documentation

- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) Section 3.2: Open/Closed Principle
- [temple-linter/README.md](../temple-linter/README.md)
- TODO comment in `base_format_linter.py` line 43
