---
title: "Implement projection snapshots for cleaned shadow bridge mapping"
id: 89
status: completed
state_reason: success
priority: critical
complexity: high
estimated_hours: 18
actual_hours: 6.0
completed_date: 2026-02-16
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
  - 67d4374  # merge(PR #11): shadow-bridge parity core merged to main
test_results: |
  Initial validation on 2026-02-16:
  - PYTHONPATH=temple-linter/src:temple/src .ci-venv/bin/pytest
    temple-linter/tests/test_projection_snapshot.py
    temple-linter/tests/test_base_linting_service.py
    temple-linter/tests/test_lsp_mvp_smoke.py
    temple-linter/tests/test_lsp_transport_wiring.py
    temple-linter/tests/test_integration.py
    (53 passed)
  - PYTHONPATH=temple-linter/src:temple/src .ci-venv/bin/python -m compileall
    temple-linter/src/temple_linter/services
    temple-linter/src/temple_linter/lsp_server.py (pass)
  Additional validation on 2026-02-16:
  - PYTHONPATH=temple-linter/src:temple/src .ci-venv/bin/pytest
    temple-linter/tests/test_projection_snapshot.py
    temple-linter/tests/test_base_linting_service.py
    temple-linter/tests/test_lsp_mvp_smoke.py
    (19 passed)
dependencies:
  - "[[archive/86_disable_auto_reassociation_and_lock_template_language_identity.md]]"
related_backlog:
  - "archive/75_implement_collocated_mirror_ghost_files_and_diagnostic_remap.md"
  - "archive/77_add_base_lint_queueing_adaptive_debounce_and_observability.md"
related_spike: []
notes: |
  2026-02-16: Created to establish a single projection/mapping contract used by
  diagnostics remap and extension shadow-document feature proxying.
  2026-02-16: Started implementation.
  - Added ProjectionSnapshot model with bidirectional position mapping.
  - Routed orchestrator diagnostic remap through projection snapshots.
  - Fixed markdown cleanup regression that leaked trailing whitespace under trim markers.
  - Added adaptive timeout policy in base diagnostics bridge.
  - Added no-op watched-files handler to suppress unknown-method noise.
  2026-02-16: Additional projection hardening.
  - Preserved trim-marker semantics for non-markdown while keeping markdown line stability.
  - Verified projection/mapping regression tests remain green.
  2026-02-16: Moved to testing.
  - Added `temple/getBaseProjection` server request for extension shadow bridge use.
  - Added smoke coverage for projection request payload and token span export.
  - Projection snapshot remains canonical mapping source for diagnostics and bridge remap.
  2026-02-16: Finalized after merge.
  - Confirmed merged in PR #11 (merge commit `67d4374`).
  - Acceptance criteria and test evidence verified; archived as completed.
---

## Goal

Create a canonical projection engine that emits cleaned base-language text plus
explicit source<->shadow mapping artifacts for every templated document.

## Background

Current base diagnostics rely on implicit offset stability and break when
markdown trim-marker behavior rewrites line structure. Full shadow-bridge LSP
parity requires deterministic mapping for diagnostics and edit/range remap.

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

1. **Define projection contracts**
   - Add `ProjectionSnapshot` and supporting mapping/value types in
     `temple-linter` services.
   - Include cleaned text, format hint, offset/position mapping, and token-span
     metadata for overlap safety checks.

2. **Refactor token cleaning to build mappings**
   - Update `TokenCleaningService` to emit projection snapshots.
   - Preserve line-ending behavior while fixing markdown trim-marker line-count
     mismatch regression.

3. **Route diagnostics through projection mapping**
   - Update orchestrator and diagnostic mapping service to consume
     projection snapshots instead of implicit stable-spacing assumptions.

4. **Regression tests**
   - Add tests for trim-marker markdown templates with trailing newline.
   - Add mixed-line mapping correctness tests (both directions).

## Deliverables

- Projection snapshot implementation in `temple-linter/src/temple_linter/services/`.
- Updated diagnostics mapping flow using explicit mapping metadata.
- New/updated unit tests covering projection and markdown regression.

## Acceptance Criteria

- [x] `ProjectionSnapshot` is the source of truth for cleaned text + mapping.
- [x] Markdown trim-marker cleanup no longer bails out on line-count mismatch.
- [x] Base diagnostics remap correctly on mixed template/base lines.
- [x] Added tests pass for projection/mapping regressions.
