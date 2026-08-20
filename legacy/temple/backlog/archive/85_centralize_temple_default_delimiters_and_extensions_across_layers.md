---
title: "Centralize temple default delimiters and extensions across layers"
id: 85
status: completed
state_reason: success
priority: medium
complexity: medium
estimated_hours: 7
actual_hours: 5
completed_date: 2026-02-15
related_commit:
  - 02fe4d8  # feat(defaults): add generated defaults sync and drift checks
test_results: "Local: .ci-venv/bin/python -m pytest temple-linter/tests/test_lsp_mvp_smoke.py && npm --prefix vscode-temple-linter run lint && npm --prefix vscode-temple-linter run compile && node vscode-temple-linter/scripts/generate-defaults.js --check"
dependencies:
  - "[[79_audit_cross_layer_dry_and_grammar_anchoring.md]]"
related_backlog:
  - "archive/22_configurable_temple_extensions.md"
related_spike:
  - "79_audit_cross_layer_dry_and_grammar_anchoring.md"
notes: |
  Finding: default delimiters and temple extension defaults are duplicated
  across core, linter, and VS Code extension layers.
  Completed in commit 02fe4d8 by introducing shared defaults source + generated
  Python/TypeScript defaults, LSP defaults endpoint/fallback, and drift checks
  in pre-commit and CI.
---

## Goal

Create a single source of truth for default temple delimiters and extension values, with explicit override flow across extension/linter/core.

## Background

Multiple default declarations increase drift risk and complicate maintenance when supported suffixes or delimiter behavior evolves.

## Tasks

1. Inventory default delimiter/extension declarations and choose canonical owner(s).
2. Implement shared config export/import path (or generated artifact) for each runtime.
3. Update linter server and extension initialization to consume centralized defaults.
4. Add tests that verify parity across layers.

## Deliverables

- Centralized defaults contract for delimiters and temple extensions.
- Refactored consumers in core/linter/extension.
- Cross-layer parity tests.

## Acceptance Criteria

- [x] Default delimiters are not hard-coded in multiple runtime modules.
- [x] Temple extension defaults are centrally defined and consumed consistently.
- [x] Override behavior remains supported and test-covered.
