---
title: "Repair VS Code Extension Build and Integration"
id: 68
status: completed
state_reason: success
priority: medium
complexity: medium
estimated_hours: 10
actual_hours: 4
completed_date: 2026-02-13
related_commit:
  - 8927722  # fix(vscode): simplify extension integration wiring
test_results: "vscode-temple-linter: npm run compile passes, npm run lint passes."
dependencies:
  - "[[67_fix_lsp_base_diagnostics_transport.md]]"
related_backlog:
  - "45_implement_lsp_language_features.md"
related_spike: []
notes: |
  Focuses on TypeScript compile stability and removing dead/duplicated request paths.
  Replaced duplicate connection wiring with a single LanguageClient-based integration path.
  Hardened request/notification payload handling with runtime guards.
  Normalized diagnostic code conversion to satisfy strict TypeScript typing.
---

## Goal

Make `vscode-temple-linter` compile cleanly and interoperate predictably with the Python LSP server by removing invalid/duplicated connection code and fixing current TypeScript errors.

## Background

The extension currently fails strict TypeScript compile and contains mixed connection patterns that increase runtime ambiguity.

## Tasks

1. **Fix compile-time TypeScript errors**
   - Resolve `LspDiagnostic['code']` typing issue and any dependent errors

2. **Remove dead or duplicate connection wiring**
   - Keep a single authoritative request/notification path for extension-server interactions

3. **Harden request handlers and diagnostics mapping**
   - Validate payload shapes and maintain stable conversion behavior

4. **Add extension-level validation checks**
   - Add minimal smoke checks for compile + lint + request handler behavior

## Deliverables

- Updated `vscode-temple-linter/src/extension.ts`
- Supporting TypeScript config/package script adjustments if needed
- Added/updated checks for extension build stability

## Acceptance Criteria

- [x] `npm run compile` succeeds without TypeScript errors
- [x] `npm run lint` passes
- [x] Base diagnostics request handler remains functional
- [x] Extension code no longer contains duplicate connection setup paths
