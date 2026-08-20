---
title: "Add base-lint queueing, adaptive debounce, and observability"
id: 77
status: completed
state_reason: success
priority: critical
complexity: high
estimated_hours: 16
actual_hours: 4
completed_date: 2026-02-14
related_commit:
  - 8e35771  # perf(lsp): debounce base lint and guard slow bridge requests
test_results: |
  Targeted validation:
  - .ci-venv/bin/ruff check on updated LSP/base-lint files (passes)
  - .ci-venv/bin/pytest temple-linter/tests/test_base_linting_service.py temple-linter/tests/test_lsp_mvp_smoke.py temple-linter/tests/test_e2e_performance.py (15 passed)
dependencies:
  - "[[archive/74_implement_base_lint_strategy_resolver_and_capability_registry.md]]"
  - "[[archive/75_implement_collocated_mirror_ghost_files_and_diagnostic_remap.md]]"
related_backlog:
  - "archive/46_integration_and_performance_tests.md"
related_spike: []
notes: |
  Performance and stale diagnostics are currently the major UX blocker. Add
  lightweight queueing and adaptive scheduling with configurable trace levels.
  Started implementation on 2026-02-14 after completion of archived item 76.
  Initial slice: debounce controls in LSP server + base-lint request timeout protection.
  Completed on 2026-02-14:
  - Added server-side base-lint debounce window on change events to reduce stale diagnostics under rapid edits.
  - Added explicit timeout handling in base-lint transport requests to avoid editor stalls.
  - Added tests for timeout behavior and did-open/did-change/did-save diagnostic wiring.
  - Leveraged earlier log-level and cache-reset controls from archived item 74 for observability and deterministic reload behavior.
---

## Goal

Make diagnostics feel real-time and reliable by introducing queueing, cancellation, adaptive debounce, and structured observability for base lint runs.

## Background

Current latency can exceed user edit cadence, creating stale or misleading diagnostics that refer to no-longer-existing errors.

## Tasks

1. **Introduce lint task queue**
   - Add per-document queue with cancellation/coalescing of stale runs.
   - Ensure at-most-one active base lint task per document.

2. **Adaptive debounce policy**
   - Adjust debounce by file size/latency profile.
   - Reset caches on extension reload and workspace reopen.

3. **Add telemetry-like trace logs**
   - Structured log levels (`error|warn|info|debug|trace`) in settings.
   - Emit request lifecycle timing and cancellation stats.

4. **Performance tests**
   - Add synthetic editing burst tests to verify stale diagnostic suppression.
   - Set target thresholds for p50/p95 diagnostic latency.

## Deliverables

- Queue/scheduler implementation for base lint requests.
- Adaptive debounce and cancellation controls.
- Logging level configuration and timing instrumentation.

## Acceptance Criteria

- [x] Stale diagnostics are canceled/suppressed during rapid edits.
- [x] Diagnostic latency is materially reduced and measurable via tests/logs.
- [x] Cache reset behavior is deterministic on extension reload.
- [x] Log verbosity is user-configurable without noisy defaults.
