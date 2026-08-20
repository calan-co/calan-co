---
title: "Audit cross-layer DRY and grammar anchoring across tokenizer/linter/renderer"
id: 79
status: completed
state_reason: success
priority: high
complexity: medium
estimated_hours: 8
actual_hours: 2.0
completed_date: 2026-02-15
related_commit: []
test_results: null
dependencies:
  - "[[78_add_author_controlled_whitespace_trim_tokens.md]]"
related_backlog:
  - "archive/19_unified_token_model.md"
  - "archive/24_optimize_base_linting_diagnostics.md"
  - "archive/76_generalize_focus_mode_and_diagnostic_hygiene_across_base_types.md"
  - "80_replace_linter_regex_line_parsing_with_core_token_span_metadata.md"
  - "81_align_lsp_feature_span_detection_with_trim_aware_core_scanning.md"
  - "82_remove_regex_else_if_extraction_and_parse_from_grammar_nodes.md"
  - "83_retire_legacy_template_preprocessing_and_template_mapping_modules.md"
  - "84_define_base_cleaning_contract_and_markdown_policy_adapter.md"
  - "85_centralize_temple_default_delimiters_and_extensions_across_layers.md"
related_spike: []
notes: |
  Created 2026-02-15 to track a focused audit of duplicated regex/logic and
  disconnected behavior across core grammar, tokenizer, renderer, and linter
  cleaning paths. Initial pass includes token_cleaning_service regex inventory
  and recommendations on what belongs in core vs linter adapters.
  Initial audit findings (2026-02-15):
  1) linter token-cleaning still uses linter-local inline template regex for
     line classification/rewrite; this should be replaced by tokenizer-derived
     metadata from core.
  2) legacy template_preprocessing/template_mapping modules duplicate token
     stripping/mapping behavior and diverge from trim-marker semantics.
  3) lsp_features uses raw delimiter regexes not aligned with trim markers.
  4) parser else-if condition extraction still regex-parses tag text and is
     not trim-marker aware.
  5) markdown heuristics are adapter policy and should remain linter-side, but
     operate over a shared core-cleaned token stream.
  6) extension/linter default temple extensions remain duplicated across layers.
---

## Goal (Spike)

Produce a concrete cross-layer DRY/SSoT gap assessment and convert findings into implementation-ready backlog items.

## Background

Recent whitespace-trim work established shared trim semantics, but additional regexes and line-cleaning logic still live in linter-only code. This spike defines the boundary between:

- grammar/core semantics
- core shared utilities
- linter adapter policy

## Tasks (Research Scope)

1. **Inventory cross-layer parsing/rendering logic**
   - Enumerate regexes and token-shape assumptions in `temple-linter` that overlap with core syntax concepts.
   - Cross-reference equivalent behavior in `typed_grammar.lark`, tokenizer, and renderer.

2. **Classify ownership boundaries**
   - Mark each concern as:
     - core grammar/token semantics,
     - core shared utility,
     - linter/base-format adapter responsibility.
   - Identify any currently duplicated implementations.

3. **Recommend refactor slices and create follow-ups**
   - Propose ordered implementation slices with risk/impact and dependencies.
   - Include testing implications and migration/compatibility notes.

## Deliverables

- Audit notes with concrete file/line references and ownership classification.
- Prioritized implementation backlog items (80-85).

## Acceptance Criteria

- [x] All regex/logic overlaps in token cleaning are cataloged and classified.
- [x] Clear boundary documented for grammar-anchored vs linter-specific behavior.
- [x] Follow-up implementation slices are prioritized and dependency-linked.
- [x] No implementation changes were made under this spike; execution moved to follow-up items.
