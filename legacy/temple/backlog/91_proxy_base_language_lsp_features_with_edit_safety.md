---
title: "Proxy base-language LSP features through shadow docs with edit safety"
id: 91
status: testing
state_reason: null
priority: critical
complexity: high
estimated_hours: 24
actual_hours: 7.0
completed_date: null
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
test_results: |
  Current validation on 2026-02-16:
  - npm --prefix vscode-temple-linter run compile (pass)
  - npm --prefix vscode-temple-linter run lint (pass)
dependencies:
  - "[[archive/89_implement_projection_snapshots_for_shadow_bridge.md]]"
  - "[[90_implement_shadow_document_lifecycle_and_diagnostic_ownership.md]]"
related_backlog:
  - "archive/67_fix_lsp_base_diagnostics_transport.md"
related_spike: []
notes: |
  2026-02-16: Created as the feature-parity core slice for command/provider
  proxying from templated documents into base-language shadow documents.
  2026-02-16: Started implementation.
  - Registered proxy providers for completion/hover/definition/references.
  - Added proxy plumbing for code actions, symbols, rename, and formatting.
  - Added URI remap helpers for definition/location and workspace edits.
  - Remaining: semantic tokens parity and strict unsafe-edit overlap guardrails.
  2026-02-16: Completed proxy/remap implementation and moved to testing.
  - Provider inputs now map source->shadow via projection snapshots.
  - Provider outputs map shadow->source for hover/definition/references/symbols.
  - Added guarded workspace-edit remap with Temple-token overlap blocking.
  - Added semantic token proxying (document + range) with projection remap.
---

## Goal

Deliver full base-language LSP feature parity for templated files by proxying
provider calls to shadow documents and mapping results back safely.

## Background

Templated language IDs preserve diagnostic ownership but remove default
base-language LSP affordances. A provider bridge is required for completion,
navigation, refactoring, formatting, and semantic tokens on templated docs.

## Target Extension Baseline

Parity for this item is explicitly required against:

- `vscode.markdown-language-features`
- `DavidAnson.vscode-markdownlint`
- `vscode.json-language-features`
- `redhat.vscode-yaml`
- `vscode.html-language-features`
- `redhat.vscode-xml`
- `tamasfe.even-better-toml`

## Tasks

1. **Provider registration for templ-* languages**
   - Register proxy providers for completion, hover, definition, references,
     code actions, document symbols, rename, semantic tokens, and formatting
     (document/range/on-type).

2. **Result remap and workspace edit translation**
   - Map provider ranges/locations/edits from shadow URIs back to source URIs
     via projection snapshots.
   - Preserve multi-file edits only when source mapping is deterministic.

3. **Unsafe edit guardrails**
   - Reject or downgrade edits overlapping Temple token spans.
   - Emit structured trace logs for rejected edits with reason classification.

4. **Fallback behavior**
   - If a provider is unavailable for a target extension, degrade gracefully and
     log once per capability/provider combination.

## Deliverables

- Proxy provider implementation in `vscode-temple-linter/src/extension.ts`.
- Edit-safety overlap checks driven by projection metadata.
- Integration tests covering proxy result remap and unsafe edit rejection.

## Acceptance Criteria

- [x] All listed LSP feature classes are proxied for templ-* language IDs.
- [x] Returned ranges/edits map to source templates without mirror URI leakage.
- [x] Unsafe overlapping edits are blocked with clear diagnostics/logging.
- [ ] Integration tests cover positive and degraded/fallback paths.
