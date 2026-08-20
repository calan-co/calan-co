---
title: "Implement base-lint strategy resolver and capability registry"
id: 74
status: completed
state_reason: success
priority: critical
complexity: high
estimated_hours: 14
actual_hours: 5
completed_date: 2026-02-14
related_commit:
  - 4fffbab  # feat(vscode): add strategy resolver and generated temple grammars
test_results: |
  VS Code extension validation:
  - npm run compile (passes)
  - npm run test:integration (passes)
  Coverage highlights:
  - strategy resolver precedence tests (auto/embedded/vscode)
  - markdown mirror-file fallback strategy test
  - no regression in end-to-end diagnostics/completion smoke checks
dependencies:
  - "[[archive/73_lock_base_lint_strategy_and_publish_adr_005.md]]"
related_backlog:
  - "archive/67_fix_lsp_base_diagnostics_transport.md"
related_spike: []
notes: |
  Introduce a single strategy resolver for base linting: embedded, virtual,
  mirror-file. Include mode setting and capability registry extension points.
  Started implementation planning on 2026-02-14 after completion of item 73.
  First implementation slice: resolver contract + mode precedence tests.
  Completed on 2026-02-14:
  - Added `baseLintStrategyMode`, `embeddedBaseLintFormats`, and `baseLintLogLevel` settings.
  - Implemented strategy resolver + capability registry with auto precedence and fallback reasoning.
  - Routed base diagnostics request flow through resolver-selected strategy.
  - Added integration tests for resolver behavior and extension-host startup checks.
  - Added generated syntax grammar pipeline from a shared source script.
---

## Goal

Add a deterministic strategy resolver that selects `embedded`, `virtual`, or `mirror-file` based on configuration and discovered capabilities, with `auto` as default.

## Background

Current behavior is fragmented across extension/linter boundaries and does not consistently represent how a base linter should be invoked for each file type or host extension capability.

## Tasks

1. **Add mode and resolver contracts**
   - Add settings for strategy mode (`auto|embedded|vscode`) and diagnostics logging level.
   - Add resolver contract and tests for precedence and fallbacks.

2. **Add capability registry**
   - Define adapter capability metadata and registration points.
   - Support explicit capability declaration first, runtime probing only as fallback.

3. **Wire resolver through extension and linter boundaries**
   - Route base lint requests through resolver-selected strategy.
   - Emit structured trace events for chosen strategy and fallback reason.

4. **Regression tests**
   - Unit tests for resolver decisions and mode behavior.
   - Integration tests for strategy selection across at least markdown/json fixtures.

## Deliverables

- Strategy resolver implementation in extension + linter path.
- Capability registry abstraction and tests.
- New settings documented in extension README.

## Acceptance Criteria

- [x] `auto` mode selects the highest available strategy by precedence.
- [x] Explicit mode honors user selection with clear fallback diagnostics when unsupported.
- [x] Strategy decision is test-covered and observable in logs.
- [x] No regressions in existing Temple diagnostics pipeline.
