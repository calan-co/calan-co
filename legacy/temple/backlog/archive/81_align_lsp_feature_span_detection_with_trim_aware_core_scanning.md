---
title: "Align LSP feature span detection with trim-aware core scanning"
id: 81
status: completed
state_reason: success
priority: high
complexity: medium
estimated_hours: 8
actual_hours: 2.5
completed_date: 2026-02-15
related_commit:
  - 40e4dbb  # refactor(lsp): align feature spans with core metadata
test_results: "Local: .ci-venv/bin/python -m pytest temple-linter/tests/test_lsp_features.py"
dependencies:
  - "[[79_audit_cross_layer_dry_and_grammar_anchoring.md]]"
  - "[[78_add_author_controlled_whitespace_trim_tokens.md]]"
related_backlog:
  - "archive/45_implement_lsp_language_features.md"
related_spike:
  - "79_audit_cross_layer_dry_and_grammar_anchoring.md"
notes: |
  Finding: lsp_features relies on delimiter regexes that are not trim-marker
  aware and can diverge from grammar behavior.
  Completed in commit 40e4dbb by replacing feature scanning with core
  template metadata/unclosed-span utilities and adding trim-aware coverage.
---

## Goal

Make LSP feature span detection use shared core scanning/token utilities so completion/hover/definition behavior matches parser/tokenizer semantics.

## Background

`lsp_features.py` currently uses raw regex patterns for expressions/statements/includes. This can drift from grammar updates and trim-marker support.

## Tasks

1. Introduce or reuse core span scanning APIs for expression and statement regions.
2. Replace `_EXPR_RE` / `_STMT_RE` dependent logic in `lsp_features.py`.
3. Ensure include discovery handles trim forms and partial/unclosed tags consistently.
4. Add/extend LSP feature tests for trim and incomplete-token scenarios.

## Deliverables

- LSP feature scanning aligned to core behavior.
- Reduced regex duplication in `lsp_features.py`.
- Test coverage for trim-aware and unclosed-tag flows.

## Acceptance Criteria

- [x] LSP feature logic no longer depends on trim-unaware raw delimiter regexes.
- [x] Features behave consistently for `{%- ... -%}` and `{{~ ... ~}}`.
- [x] Existing LSP feature tests pass with new coverage added.
