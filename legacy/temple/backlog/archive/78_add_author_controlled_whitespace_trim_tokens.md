---
title: "Add author-controlled whitespace trim tokens across linter and renderer"
id: 78
status: completed
state_reason: success
priority: high
complexity: high
estimated_hours: 20
actual_hours: 2.5
completed_date: 2026-02-16
related_commit:
  - 9d0f429  # feat(core): anchor trim semantics and dedupe whitespace controls
  - 7ff3552  # refactor(linter): add core span metadata cleaning contract
test_results: "Local: .ci-venv/bin/python -m pytest temple/tests/test_mvp_language_core.py temple/tests/test_tokenizer.py temple/tests/test_template_renderer.py temple/tests/test_template_spans.py temple-linter/tests/test_integration.py (53 passed)"
dependencies:
  - "[[archive/76_generalize_focus_mode_and_diagnostic_hygiene_across_base_types.md]]"
  - "[[archive/77_add_base_lint_queueing_adaptive_debounce_and_observability.md]]"
related_backlog:
  - "archive/26_control_flow_rendering.md"
  - "archive/65_complete_temple_native_language_core.md"
related_spike: []
notes: |
  Introduce reusable whitespace-control semantics so template authors can
  intentionally trim surrounding whitespace instead of relying on
  markdown-specific cleaning heuristics.
  Started implementation on 2026-02-14 after completion of archived item 77.
  Initial slice: add trim marker semantics to tokenizer, linter cleaning, and passthrough renderer.
  Follow-up refactor anchored trim marker set in shared core utility and
  removed duplicated leading/trailing whitespace regexes from renderer and linter cleaner.
  Added tilde (`~`) parity tests for tokenizer, renderer, and lint-cleaning integration.
  Completed on 2026-02-16 after validation pass of trim-aware parser,
  renderer, token-span mapping, and linter integration suites.
---

## Goal

Implement explicit whitespace-control tokens (e.g., `{{- ... -}}`, `{%- ... -%}`, `{#- ... -#}`) and apply them consistently in both lint cleaning and rendering pipelines.

## Background

Current markdown-specific cleaning behavior mitigates false positives but behaves as a heuristic. This makes behavior harder to reason about and does not generalize cleanly to all base languages. Author-controlled trim markers provide deterministic intent and a reusable cross-language feature.

## Tasks

1. **Define whitespace token semantics**
   - Extend tokenizer/parser contracts to track `trim_left` and `trim_right` around template delimiters.
   - Document default behavior vs trim-enabled behavior.

2. **Implement trimming in lint-cleaning path**
   - Apply trim flags in token cleaning before base lint delegation.
   - Preserve diagnostic mapping guarantees and line/column stability where feasible.

3. **Implement trimming in render path**
   - Apply same trim semantics during rendering output generation.
   - Verify parity between linter-cleaned text assumptions and rendered behavior.

4. **Compatibility and migration behavior**
   - Keep existing templates valid by default.
   - Ensure old behavior remains unless trim markers are used.

5. **Tests and docs**
   - Add tokenizer/parser tests for trim markers.
   - Add linter mapping tests and renderer golden tests for trim behavior.
   - Update README/architecture/docs with examples and migration guidance.

## Deliverables

- Tokenizer/parser support for whitespace-trim delimiters.
- Shared whitespace-trim behavior across linter cleaning and renderer.
- Test coverage for trim semantics and diagnostic mapping outcomes.
- Documentation for author-facing whitespace controls.

## Acceptance Criteria

- [x] `{{- ... -}}`, `{%- ... -%}`, and `{#- ... -#}` parse and execute with defined semantics.
- [x] Lint cleaning and rendering apply matching trim behavior.
- [x] Existing templates without trim markers preserve current behavior.
- [x] Diagnostic mapping remains stable and test-covered under trim cases.
- [x] Markdown-specific heuristic logic is reduced or isolated behind compatibility fallback.
