---
title: Narrow Python Lint Scope for CI
id: 60
status: completed
related_commit:
  - 8e4ff9c  # MISSING-COMMIT
dependencies:
  - "[[57_fix_ci_workflow_wiring.md]]"
estimated_hours: 2
priority: high
test_results: "ruff check scripts/ci tests passed in CI venv."
completed_date: 2026-02-12
---

## Goal

Implement the near-term lint strategy by narrowing CI Python linting to stable paths while broader Ruff cleanup is deferred.

## Deliverables

- Static Analysis lint-python step runs against a constrained target set.
- Scope reflects current enforcement policy and avoids legacy noise.

## Acceptance Criteria

- CI lint gate no longer scans the entire repository by default.
- Lint scope aligns with near-term maintainable paths.

## Notes

This item tracks step `4` ("narrow scope") from the workspace review follow-up.

Completed changes:

- Static Analysis lint-python step now targets `scripts/ci` and `tests` only.
- Scope is intentionally narrowed to stable CI-owned Python paths.
