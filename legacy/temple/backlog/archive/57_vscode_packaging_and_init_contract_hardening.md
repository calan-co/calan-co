---
title: VS Code Packaging and LSP Init Contract Hardening
id: 57
status: completed
state_reason: success
related_commit:
  - 3f17a66  # ci(workflows): add vscode package validation to static analysis
  - 8bb34ef  # feat(vscode): harden LSP init contract and packaging checks
  - 35a540d  # chore(vscode): add extension publisher metadata
dependencies:
  - "[[45_implement_lsp_language_features.md]]"
  - "[[46_integration_and_performance_tests.md]]"
estimated_hours: 6
actual_hours: 6
completed_date: 2026-02-13
priority: high
test_results: "2026-02-13: ./scripts/pre-commit/validate-vscode-package.sh passes; extension package manifest now includes publisher + canonical monorepo repository URL."
---

## Test Results

- Local: `uv run --with pytest --with-editable ./temple --with-editable ./temple-linter python -m pytest temple-linter/tests/test_lsp_mvp_smoke.py -q`
- Local: `./scripts/pre-commit/validate-vscode-package.sh`

## Goal

Harden the VS Code extension packaging and initialization contract so extension artifacts are publishable and semantic settings are reliably passed to the LSP server.

## Deliverables

- Valid extension manifest for packaging (`activationEvents`, package file list)
- CI check that validates extension packaging metadata (`vsce ls`)
- Extension settings and initialization options for:
  - `temple.semanticSchemaPath`
  - `temple.semanticContext`
- LSP server support for canonical `semanticSchemaPath` initialization option
- Smoke test coverage validating initialization + language-feature path

## Acceptance Criteria

- `npm run package:check` passes locally and in CI
- Extension settings are documented and wired through to LSP initialization
- LSP server loads schema from path option and preserves raw schema for hover docs
- Smoke tests cover completion, hover, definition, references, and rename
