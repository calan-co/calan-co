---
title: "Harden transport timeout policy and watched-files notification noise"
id: 93
status: completed
state_reason: success
priority: high
complexity: medium
estimated_hours: 8
actual_hours: 2.5
completed_date: 2026-02-16
related_commit:
  - 3c11886  # feat(shadow-bridge): add projection-backed base LSP bridge
  - b03fa90  # chore(backlog): update shadow-bridge status and PR traceability
  - 67d4374  # merge(PR #11): shadow-bridge parity core merged to main
test_results: |
  Validation on 2026-02-16:
  - PYTHONPATH=temple-linter/src:temple/src .ci-venv/bin/pytest
    temple-linter/tests/test_base_linting_service.py
    temple-linter/tests/test_lsp_mvp_smoke.py
    temple-linter/tests/test_lsp_transport_wiring.py
    temple-linter/tests/test_integration.py
    temple-linter/tests/test_projection_snapshot.py
    (53 passed in aggregate run)
  - PYTHONPATH=temple-linter/src:temple/src .ci-venv/bin/python -m compileall
    temple-linter/src/temple_linter/services
    temple-linter/src/temple_linter/lsp_server.py (pass)
dependencies:
  - "[[archive/89_implement_projection_snapshots_for_shadow_bridge.md]]"
related_backlog:
  - "archive/77_add_base_lint_queueing_adaptive_debounce_and_observability.md"
related_spike: []
notes: |
  2026-02-16: Created to eliminate repeated timeout spam and pygls unknown-method
  noise observed during mirror/bridge diagnostics runs.
  2026-02-16: Implementation completed and moved to testing.
  - Replaced fixed timeout with adaptive timeout budgeting by format/content size.
  - Added deduped timeout logging with URI/format/timeout context.
  - Added no-op `workspace/didChangeWatchedFiles` handler in LSP server.
  - Added/updated tests for timeout policy and watched-files handler path.
  2026-02-16: Revalidated in testing.
  - Targeted smoke includes watched-files handler and adaptive timeout tests.
  - No regressions in transport wiring/integration Python test suite.
  2026-02-16: Finalized after merge.
  - Confirmed merged in PR #11 (merge commit `67d4374`).
  - Acceptance criteria and test evidence verified; archived as completed.
---

## Goal

Eliminate noisy transport failures and unknown-method warnings while preserving
responsive diagnostics under mixed-provider latency.

## Background

Current fixed 0.5s timeout causes dropped diagnostics and repeated warnings.
Missing watched-files handler logs `"Ignoring notification for unknown method
'workspace/didChangeWatchedFiles'"`, obscuring actionable logs.

## Target Extension Baseline

Timeout and notification handling must be validated with:

- `vscode.markdown-language-features`
- `DavidAnson.vscode-markdownlint`
- `vscode.json-language-features`
- `redhat.vscode-yaml`
- `vscode.html-language-features`
- `redhat.vscode-xml`
- `tamasfe.even-better-toml`

## Tasks

1. **Adaptive timeout policy**
   - Replace fixed timeout in `BaseLintingService` with format/content-aware
     budgeting and bounded caps.

2. **No-op watched-files feature**
   - Add explicit `workspace/didChangeWatchedFiles` handler in
     `temple_linter.lsp_server` to suppress unknown-method warnings.

3. **Log hygiene**
   - Deduplicate repeated timeout logs for same URI/format window.
   - Include structured context (format, payload size, timeout budget).

4. **Tests**
   - Add timeout behavior tests (fast/slow/recovery) and watched-files handler
     smoke tests.

## Deliverables

- Updated timeout handling in `temple-linter/src/temple_linter/services/base_linting_service.py`.
- Added watched-files handler in `temple-linter/src/temple_linter/lsp_server.py`.
- Extended test coverage for timeout and notification behavior.

## Acceptance Criteria

- [x] Timeout policy adapts per format/content and reduces dropped diagnostics.
- [x] No unknown-method warning for `workspace/didChangeWatchedFiles`.
- [x] Logs are informative without repeating spam for identical failure windows.
- [x] New timeout/handler tests pass.
