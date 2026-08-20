---
title: Parity Tests & CI for Native vs Adapter
id: 52
status: completed
state_reason: success
related_commit:
  - 6d8c044  # docs(adr): clarify market role and adapter architecture (ADR-003); add adapter spec; archive backlog/48_jinja_integration.md
  - 1008bbc  # chore(ci): update workflows and contributing with shared CI scripts (backlog/40_ci_integration_and_docs.md, backlog/52_parity_tests_and_ci.md)
  - 067a1ac  # chore: update workspace settings and backlog documentation
  - 5c4bcad  # test(parity): add native-vs-adapter parity suite
test_results: "2026-02-13: uv run --with pytest --with pytest-benchmark --with jinja2 --with-editable ./temple python -m pytest temple/tests/parity/test_native_vs_jinja2_parity.py -q (4 passed)."
dependencies:
  - "[[54_complete_temple_native.md]]"
  - "[[56_jinja2_adapter_prototype.md]]"
estimated_hours: 16
actual_hours: 6
completed_date: 2026-02-13
priority: medium
---

## Goal

Create a suite of parity tests and CI checks that validate that Temple-native behavior and adapter behavior (Jinja2 adapter) produce consistent diagnostics for a shared set of template fixtures.

## Deliverables

- `tests/parity/` fixtures and test harness
- CI workflow that runs parity suite on PRs
- Triage checklist for resolving parity mismatches

## Acceptance Criteria

- CI runs parity tests; mismatches report clear diffs
- Parity suite included in repository and documented

## Progress Notes

- 2026-02-13: Added parity fixtures + harness at `temple/tests/parity/` comparing relevant semantic diagnostic codes between native Temple parsing and the Jinja2 adapter.
- 2026-02-13: Added parity execution to CI (`.github/workflows/tests.yml`) and local pre-push validation (`scripts/pre-commit/test-temple-parity.sh`, `.pre-commit-config.yaml`).
