---
title: "Disable auto reassociation and lock template language identity"
id: 86
status: completed
state_reason: success
priority: high
complexity: medium
estimated_hours: 6
actual_hours: 1.5
completed_date: 2026-02-16
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
test_results: |
  Validation on 2026-02-16:
  - Static verification: no remaining `setTextDocumentLanguage` reassociation
    path in `vscode-temple-linter/src/extension.ts`.
  - npm --prefix vscode-temple-linter run compile (pass)
  - npm --prefix vscode-temple-linter run lint (pass)
dependencies:
  - "[[archive/85_centralize_temple_default_delimiters_and_extensions_across_layers.md]]"
related_backlog:
  - "archive/74_implement_base_lint_strategy_resolver_and_capability_registry.md"
  - "archive/77_add_base_lint_queueing_adaptive_debounce_and_observability.md"
related_spike: []
notes: |
  2026-02-16: Implementation completed and moved to testing.
  - Removed runtime reassociation helpers and calls from extension activation flow.
  - Preserved Temple lint activation and base-lint request bridge behavior.
  - Preserved startup default-resolution request fix (`sendRequest(..., {})`).
  2026-02-16: Re-validated and marked completed.
  - Reconfirmed no runtime reassociation path remains.
  - Compile/lint checks remain green in current workspace.
---

## Goal

Remove runtime language forcing and preserve Temple ownership of template documents.

## Background

Auto-reassociating templated files to base languages causes raw-linter diagnostics
on template source and makes diagnostics ownership ambiguous.

## Tasks

1. **Done**: Removed reassociation helpers/calls in `vscode-temple-linter/src/extension.ts`.
2. **Done**: Preserved filename-based Temple linting path.
3. **Done**: Kept base-lint bridge behavior unchanged.

## Deliverables

- Simplified extension language-mode flow.
- Updated extension logging behavior without reassociation messages.

## Acceptance Criteria

- [x] No calls to `setTextDocumentLanguage` for Temple templates.
- [x] Opening templated files no longer flips language away from `templ-any`.
