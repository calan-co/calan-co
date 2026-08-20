---
title: "Implement shadow document lifecycle and source-only diagnostic ownership"
id: 90
status: testing
state_reason: null
priority: critical
complexity: high
estimated_hours: 16
actual_hours: 5.0
completed_date: null
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
test_results: |
  Current validation on 2026-02-16:
  - npm --prefix vscode-temple-linter run compile (pass)
  - npm --prefix vscode-temple-linter run lint (pass)
  - npm --prefix vscode-temple-linter run test:integration
    (fails in sandbox with VS Code host SIGABRT)
dependencies:
  - "[[archive/89_implement_projection_snapshots_for_shadow_bridge.md]]"
related_backlog:
  - "archive/75_implement_collocated_mirror_ghost_files_and_diagnostic_remap.md"
related_spike: []
notes: |
  2026-02-16: Created to isolate extension-side shadow URI/file lifecycle from
  provider proxy logic so diagnostics ownership is fixed before feature parity.
  2026-02-16: Started implementation.
  - Beginning with persistent shadow handle lifecycle and mirror URI hygiene.
  2026-02-16: Implemented first lifecycle slice.
  - Added `ShadowDocHandle` tracking and source<->base URI linkage.
  - Removed per-request mirror cleanup from base diagnostics path.
  - Added close/change document hooks to refresh and cleanup shadow docs.
  - Added trace logging around shadow ensure flow.
  2026-02-16: Lifecycle and ownership hardening completed; moved to testing.
  - Shadow docs now hydrate from linter projection snapshots instead of raw template text.
  - Mirror-file fallback now uses extension storage cache paths instead of
    workspace-collocated `.temple-base-lint` siblings.
  - Source<->shadow handle updates preserve projection metadata across
    diagnostics requests to avoid remap regressions.
  - Remaining verification blocker: VS Code integration host SIGABRT in sandbox.
---

## Goal

Manage one shadow document per open template with deterministic lifecycle and
ensure diagnostics are visible only on source template URIs.

## Background

Per-request mirror file create/delete causes stale diagnostics and noisy
Problems entries. A persistent shadow-document model is required for stable base
feature proxying and clear diagnostic ownership.

## Target Extension Baseline

The parity baseline for this item is the following explicit provider set:

- `vscode.markdown-language-features`
- `DavidAnson.vscode-markdownlint`
- `vscode.json-language-features`
- `redhat.vscode-yaml`
- `vscode.html-language-features`
- `redhat.vscode-xml`
- `tamasfe.even-better-toml`

## Tasks

1. **Introduce shadow handles**
   - Add `ShadowDocHandle` state keyed by source URI in extension runtime.
   - Track strategy (`virtual` vs `mirror-file`), version, and target URI.

2. **Lifecycle hooks**
   - Create/update shadow docs on open/change/save for templated files.
   - Cleanup shadow docs on close/deactivate instead of per request.

3. **Diagnostics ownership hygiene**
   - Remap and publish diagnostics on source URI only.
   - Suppress/clear diagnostics for mirror URIs in `.temple-base-lint`.

4. **Observability**
   - Add trace logs for shadow lifecycle and source publish mapping.

## Deliverables

- Shadow lifecycle manager in `vscode-temple-linter/src/extension.ts`.
- Deterministic mirror cleanup behavior tied to document lifecycle.
- Diagnostic suppression/remap safeguards for mirror URIs.

## Acceptance Criteria

- [x] Mirror/shadow artifacts persist while source doc is open, then cleanup on close.
- [ ] Problems pane never shows diagnostics owned by `.temple-base-lint/*`.
- [x] Base diagnostics continue publishing on source template URI.
- [ ] Integration coverage added for open/change/close mirror lifecycle.
