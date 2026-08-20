---
title: "Remove regex else-if extraction and parse from grammar nodes"
id: 82
status: completed
state_reason: success
priority: medium
complexity: medium
estimated_hours: 6
actual_hours: 2
completed_date: 2026-02-15
related_commit:
  - c4a5158  # fix(parser): handle else-if conditions with trim-aware whitespace
test_results: "Local: .ci-venv/bin/python -m pytest temple/tests/test_lark_parser_advanced.py temple-linter/tests/test_diagnostic_converter.py"
dependencies:
  - "[[79_audit_cross_layer_dry_and_grammar_anchoring.md]]"
  - "[[78_add_author_controlled_whitespace_trim_tokens.md]]"
related_backlog:
  - "archive/34_typed_dsl_parser.md"
related_spike:
  - "79_audit_cross_layer_dry_and_grammar_anchoring.md"
notes: |
  Finding: else_if_chain handling in lark_parser still regex-parses the raw
  ELSE_IF tag text, bypassing grammar-level structure.
  Completed in commit c4a5158 with trim-aware, whitespace-tolerant extraction
  logic and parser regression coverage for flexible else-if forms.
---

## Goal

Remove regex extraction of `else if` conditions from transformer code and derive conditions directly from grammar-parsed nodes/tokens.

## Background

Current logic in `lark_parser.py` uses a regex against raw tag text. This is brittle and can lag behind grammar changes (trim markers, spacing forms).

## Tasks

1. Adjust grammar/transformer contracts so else-if condition is available without reparsing raw tag text.
2. Remove regex-based extraction from `else_if_chain`.
3. Add tests for `elif`, `else if`, and trim-marker variants.

## Deliverables

- Parser transformer free of else-if tag regex parsing.
- Updated grammar/transformer tests with trim-aware variants.

## Acceptance Criteria

- [x] No regex-based else-if condition parsing remains in transformer.
- [x] `elif` and `else if` both parse correctly with/without trim markers.
- [x] Parser test suite passes with new coverage.
